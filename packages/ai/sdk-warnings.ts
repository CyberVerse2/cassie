import type { LogWarningsFunction, Warning } from "ai";

const configuredFlag = Symbol.for("cassie.aiSdkWarningsConfigured");

export function configureAiSdkWarningLogging(): void {
  const globalRecord = globalThis as typeof globalThis & { [configuredFlag]?: boolean };
  if (globalRecord[configuredFlag]) {
    return;
  }
  globalRecord[configuredFlag] = true;

  const existingLogger = globalThis.AI_SDK_LOG_WARNINGS;
  globalThis.AI_SDK_LOG_WARNINGS = (options) => {
    const warnings = options.warnings.filter((warning) => !isExpectedDeepSeekJsonSchemaCompatibilityWarning({
      warning,
      provider: options.provider,
      model: options.model,
    }));

    if (warnings.length === 0 || existingLogger === false) {
      return;
    }

    if (typeof existingLogger === "function") {
      existingLogger({ ...options, warnings });
      return;
    }

    for (const warning of warnings) {
      console.warn(formatAiSdkWarning({ warning, provider: options.provider, model: options.model }));
    }
  };
}

export function isExpectedDeepSeekJsonSchemaCompatibilityWarning(input: {
  warning: Warning;
  provider: string;
  model: string;
}): boolean {
  return input.provider === "deepseek.chat" &&
    input.model.includes("deepseek-v4") &&
    input.warning.type === "compatibility" &&
    input.warning.feature === "responseFormat JSON schema" &&
    input.warning.details === "JSON response schema is injected into the system message.";
}

function formatAiSdkWarning(input: {
  warning: Warning;
  provider: string;
  model: string;
}): string {
  const prefix = `AI SDK Warning (${input.provider} / ${input.model}):`;
  if (input.warning.type === "unsupported") {
    return `${prefix} The feature "${input.warning.feature}" is not supported.${input.warning.details ? ` ${input.warning.details}` : ""}`;
  }
  if (input.warning.type === "compatibility") {
    return `${prefix} The feature "${input.warning.feature}" is used in a compatibility mode.${input.warning.details ? ` ${input.warning.details}` : ""}`;
  }
  return `${prefix} ${input.warning.message}`;
}
