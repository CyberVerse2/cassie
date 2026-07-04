import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Arc testnet: Circle's L1 with USDC as the native gas token (6 decimals,
// not 18) and sub-second deterministic finality.
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_DEFAULT_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_EXPLORER_TX_URL = "https://testnet.arcscan.app/tx/";

export function arcTestnet(rpcUrl: string) {
  return defineChain({
    id: ARC_TESTNET_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
    },
  });
}

export const cassieTradeRegistryAbi = [
  {
    type: "function",
    name: "recordCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "bytes32" },
      { name: "sourceHash", type: "bytes32" },
      { name: "ticketHash", type: "bytes32" },
      { name: "venue", type: "string" },
      { name: "instrument", type: "string" },
      { name: "side", type: "string" },
      { name: "sizeUsdMicros", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordClose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "bytes32" },
      { name: "pnlUsdMicros", type: "int64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "receipts",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "sourceHash", type: "bytes32" },
      { name: "ticketHash", type: "bytes32" },
      { name: "openedAt", type: "uint64" },
      { name: "closedAt", type: "uint64" },
      { name: "pnlUsdMicros", type: "int64" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "callCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type ArcRegistryEnv = {
  rpcUrl: string;
  operatorKey: `0x${string}`;
  registryAddress: `0x${string}`;
};

// Registry writes are strictly optional infrastructure: when the operator
// key or contract address is absent, callers no-op instead of failing runs.
export function readArcRegistryEnv(
  env: NodeJS.ProcessEnv = process.env,
): ArcRegistryEnv | null {
  const operatorKey = env.CASSIE_ARC_OPERATOR_KEY;
  const registryAddress = env.CASSIE_ARC_REGISTRY_ADDRESS;
  if (!operatorKey || !registryAddress) return null;
  return {
    rpcUrl: env.CASSIE_ARC_RPC_URL ?? ARC_TESTNET_DEFAULT_RPC_URL,
    operatorKey: operatorKey as `0x${string}`,
    registryAddress: registryAddress as `0x${string}`,
  };
}

/// The on-chain key for a run's receipt: keccak256 of the runId.
export function arcCallId(runId: string): `0x${string}` {
  return keccak256(stringToBytes(runId));
}

export class ArcTradeRegistry {
  private readonly env: ArcRegistryEnv;

  constructor(env: ArcRegistryEnv | null = readArcRegistryEnv()) {
    if (!env) {
      throw new Error(
        "Arc registry is not configured (CASSIE_ARC_OPERATOR_KEY / CASSIE_ARC_REGISTRY_ADDRESS).",
      );
    }
    this.env = env;
  }

  async recordCall(input: {
    runId: string;
    sourceUrl: string;
    ticketSummary: string;
    venue: string;
    instrument: string;
    side: string;
    sizeUsd: number;
  }): Promise<`0x${string}`> {
    return this.write("recordCall", [
      arcCallId(input.runId),
      keccak256(stringToBytes(input.sourceUrl)),
      keccak256(stringToBytes(input.ticketSummary)),
      input.venue,
      input.instrument,
      input.side,
      BigInt(Math.round(input.sizeUsd * 1_000_000)),
    ]);
  }

  async recordClose(input: {
    runId: string;
    pnlUsd: number;
  }): Promise<`0x${string}`> {
    return this.write("recordClose", [
      arcCallId(input.runId),
      BigInt(Math.round(input.pnlUsd * 1_000_000)),
    ]);
  }

  private async write(
    functionName: "recordCall" | "recordClose",
    args: readonly unknown[],
  ): Promise<`0x${string}`> {
    const chain = arcTestnet(this.env.rpcUrl);
    const account = privateKeyToAccount(this.env.operatorKey);
    const wallet = createWalletClient({
      account,
      chain,
      transport: http(this.env.rpcUrl),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(this.env.rpcUrl),
    });
    const hash = await wallet.writeContract({
      address: this.env.registryAddress,
      abi: cassieTradeRegistryAbi,
      functionName,
      args: args as never,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Arc registry ${functionName} reverted (${hash}).`);
    }
    return hash;
  }
}
