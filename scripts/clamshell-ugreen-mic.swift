#!/usr/bin/env swift

import CoreAudio
import CoreGraphics
import Foundation
import IOKit

let targetDeviceName = "UGREEN Camera 4K"

enum MicError: Error, CustomStringConvertible {
  case coreAudio(OSStatus, String)
  case missingTarget(String)
  case noDefaultInputDevice
  case missingPowerRoot
  case missingClamshellState

  var description: String {
    switch self {
    case let .coreAudio(status, operation):
      return "\(operation) failed with CoreAudio status \(status)"
    case let .missingTarget(name):
      return "Input device named \"\(name)\" is not available"
    case .noDefaultInputDevice:
      return "No default input device is available"
    case .missingPowerRoot:
      return "Could not read IOPMrootDomain"
    case .missingClamshellState:
      return "Could not read AppleClamshellState"
    }
  }
}

struct AudioDevice {
  let id: AudioDeviceID
  let name: String
  let inputChannels: UInt32
}

func check(_ status: OSStatus, _ operation: String) throws {
  guard status == noErr else {
    throw MicError.coreAudio(status, operation)
  }
}

func stringProperty(_ objectID: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)

  try check(
    AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value),
    "Read string property \(selector)"
  )

  return (value?.takeRetainedValue() as String?) ?? ""
}

func inputChannelCount(_ deviceID: AudioDeviceID) -> UInt32 {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyStreamConfiguration,
    mScope: kAudioDevicePropertyScopeInput,
    mElement: kAudioObjectPropertyElementMain
  )
  var size: UInt32 = 0

  guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr, size > 0 else {
    return 0
  }

  let pointer = UnsafeMutableRawPointer.allocate(
    byteCount: Int(size),
    alignment: MemoryLayout<AudioBufferList>.alignment
  )
  defer { pointer.deallocate() }

  guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer) == noErr else {
    return 0
  }

  let audioBufferList = pointer.assumingMemoryBound(to: AudioBufferList.self)
  return UnsafeMutableAudioBufferListPointer(audioBufferList).reduce(UInt32(0)) {
    $0 + $1.mNumberChannels
  }
}

func audioDevices() throws -> [AudioDevice] {
  let system = AudioObjectID(kAudioObjectSystemObject)
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var size: UInt32 = 0

  try check(
    AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size),
    "Read audio device list size"
  )

  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  try check(
    AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids),
    "Read audio device list"
  )

  return try ids.map { id in
    AudioDevice(id: id, name: try stringProperty(id, kAudioObjectPropertyName), inputChannels: inputChannelCount(id))
  }
}

func defaultInputDeviceID() throws -> AudioDeviceID {
  let system = AudioObjectID(kAudioObjectSystemObject)
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)

  try check(
    AudioObjectGetPropertyData(system, &address, 0, nil, &size, &id),
    "Read default input device"
  )

  guard id != 0 else {
    throw MicError.noDefaultInputDevice
  }

  return id
}

func setDefaultInputDevice(_ deviceID: AudioDeviceID) throws {
  let system = AudioObjectID(kAudioObjectSystemObject)
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var mutableDeviceID = deviceID
  let size = UInt32(MemoryLayout<AudioDeviceID>.size)

  try check(
    AudioObjectSetPropertyData(system, &address, 0, nil, size, &mutableDeviceID),
    "Set default input device"
  )
}

func isLidClosed() throws -> Bool {
  let root = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
  guard root != 0 else {
    throw MicError.missingPowerRoot
  }
  defer { IOObjectRelease(root) }

  guard let value = IORegistryEntryCreateCFProperty(
    root,
    "AppleClamshellState" as CFString,
    kCFAllocatorDefault,
    0
  )?.takeRetainedValue() else {
    throw MicError.missingClamshellState
  }

  return CFBooleanGetValue((value as! CFBoolean))
}

func hasExternalDisplay() -> Bool {
  var count: UInt32 = 0
  guard CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 else {
    return false
  }

  var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
  guard CGGetOnlineDisplayList(count, &displays, &count) == .success else {
    return false
  }

  return displays.prefix(Int(count)).contains { display in
    CGDisplayIsBuiltin(display) == 0
  }
}

func printStatus(_ message: String) {
  let timestamp = ISO8601DateFormatter().string(from: Date())
  print("\(timestamp) \(message)")
}

func run() throws {
  let lidClosed = try isLidClosed()
  let externalDisplay = hasExternalDisplay()
  let devices = try audioDevices()
  let defaultID = try defaultInputDeviceID()

  guard lidClosed, externalDisplay else {
    let current = devices.first { $0.id == defaultID }?.name ?? "unknown"
    printStatus("unchanged current=\"\(current)\" lidClosed=\(lidClosed) externalDisplay=\(externalDisplay)")
    return
  }

  guard let target = devices.first(where: { $0.name == targetDeviceName && $0.inputChannels > 0 }) else {
    throw MicError.missingTarget(targetDeviceName)
  }

  if defaultID == target.id {
    printStatus("ready current=\"\(target.name)\" lidClosed=true externalDisplay=true")
    return
  }

  try setDefaultInputDevice(target.id)
  printStatus("set current=\"\(target.name)\" lidClosed=true externalDisplay=true")
}

do {
  try run()
} catch {
  fputs("clamshell-ugreen-mic: \(error)\n", stderr)
  exit(1)
}
