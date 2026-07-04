// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Cassie Trade Registry
/// @notice Cassie's public track record on Arc. The operator (Cassie's
/// worker) notarizes every call the moment its ticket fills and seals the
/// outcome when the position closes. Anyone can recompute the hashes from
/// the public source post URL and the ticket summary and verify that the
/// tape was never edited after the fact.
contract CassieTradeRegistry {
    struct Receipt {
        bytes32 sourceHash; // keccak256 of the source post URL
        bytes32 ticketHash; // keccak256 of the canonical ticket summary
        uint64 openedAt; // block timestamp when the call was recorded
        uint64 closedAt; // block timestamp when the outcome was sealed
        int64 pnlUsdMicros; // realized PnL in USDC micros, set on close
        bool exists;
    }

    address public owner;
    address public operator;
    uint256 public callCount;
    uint256 public closedCount;

    /// @dev key: keccak256(runId)
    mapping(bytes32 => Receipt) public receipts;

    event CallRecorded(
        bytes32 indexed callId,
        bytes32 sourceHash,
        bytes32 ticketHash,
        string venue,
        string instrument,
        string side,
        uint64 sizeUsdMicros
    );
    event CallClosed(bytes32 indexed callId, int64 pnlUsdMicros);
    event OperatorChanged(address indexed operator);

    error NotOwner();
    error NotOperator();
    error AlreadyRecorded();
    error UnknownCall();
    error AlreadyClosed();

    constructor(address initialOperator) {
        owner = msg.sender;
        operator = initialOperator == address(0) ? msg.sender : initialOperator;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address nextOperator) external {
        if (msg.sender != owner) revert NotOwner();
        operator = nextOperator;
        emit OperatorChanged(nextOperator);
    }

    /// @notice Notarize a filled call. One receipt per run, immutable once
    /// written.
    function recordCall(
        bytes32 callId,
        bytes32 sourceHash,
        bytes32 ticketHash,
        string calldata venue,
        string calldata instrument,
        string calldata side,
        uint64 sizeUsdMicros
    ) external onlyOperator {
        if (receipts[callId].exists) revert AlreadyRecorded();
        receipts[callId] = Receipt({
            sourceHash: sourceHash,
            ticketHash: ticketHash,
            openedAt: uint64(block.timestamp),
            closedAt: 0,
            pnlUsdMicros: 0,
            exists: true
        });
        callCount += 1;
        emit CallRecorded(
            callId,
            sourceHash,
            ticketHash,
            venue,
            instrument,
            side,
            sizeUsdMicros
        );
    }

    /// @notice Seal a call's outcome. Write-once: a recorded result can never
    /// be revised.
    function recordClose(bytes32 callId, int64 pnlUsdMicros)
        external
        onlyOperator
    {
        Receipt storage receipt = receipts[callId];
        if (!receipt.exists) revert UnknownCall();
        if (receipt.closedAt != 0) revert AlreadyClosed();
        receipt.closedAt = uint64(block.timestamp);
        receipt.pnlUsdMicros = pnlUsdMicros;
        closedCount += 1;
        emit CallClosed(callId, pnlUsdMicros);
    }
}