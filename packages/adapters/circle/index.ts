import {
  initiateDeveloperControlledWalletsClient,
  type Blockchain,
  type CircleDeveloperControlledWalletsClient,
  type Transaction,
} from "@circle-fin/developer-controlled-wallets";
import {
  assertCircleEnv,
  assertCircleSettlementEnv,
  config,
  type CircleEnv,
  type RequiredCircleEnv,
} from "../../core/config.ts";
import type { Chain } from "../../core/schemas/index.ts";
import type {
  TreasuryRefundInput,
  TreasuryTransferInput,
  UsdcTransfer,
  WalletGateway,
} from "../wallet/gateway.ts";

const MAINNET_BLOCKCHAINS: Record<Chain, Blockchain> = {
  arc: "ARC",
  base: "BASE",
  arbitrum: "ARB",
  ethereum: "ETH",
  optimism: "OP",
  polygon: "MATIC",
  avalanche: "AVAX",
};

const TESTNET_BLOCKCHAINS: Record<Chain, Blockchain> = {
  arc: "ARC-TESTNET",
  base: "BASE-SEPOLIA",
  arbitrum: "ARB-SEPOLIA",
  ethereum: "ETH-SEPOLIA",
  optimism: "OP-SEPOLIA",
  polygon: "MATIC-AMOY",
  avalanche: "AVAX-FUJI",
};

export type CircleIncomingTransfer = {
  transferId: string;
  chain: Chain | null;
  blockchain: string;
  sourceAddress: string | null;
  destinationAddress: string;
  amountUsd: number;
  txHash: string | null;
  tokenId: string | null;
  state: string;
  createDate: string;
};

export type DepositWalletProvision = {
  circleWalletId: string;
  walletSetId: string;
  evmAddress: string;
};

export class CircleWalletAdapter implements WalletGateway {
  private readonly env: RequiredCircleEnv;
  private readonly client: CircleDeveloperControlledWalletsClient;
  private readonly usdcTokenIds = new Set<string>();
  // EVM wallets are meta-wallets: balances and transactions run against a
  // derived, chain-specific wallet id (same address). Derivations are
  // idempotent, so cache them.
  private readonly derivedWalletIds = new Map<string, Promise<string>>();

  constructor(
    env: CircleEnv = config.circle,
    client?: CircleDeveloperControlledWalletsClient,
  ) {
    this.env = assertCircleEnv(env);
    this.client = client ?? initiateDeveloperControlledWalletsClient({
      apiKey: this.env.apiKey,
      entitySecret: this.env.entitySecret,
    });
  }

  blockchainFor(chain: Chain): Blockchain {
    return this.env.testnet
      ? TESTNET_BLOCKCHAINS[chain]
      : MAINNET_BLOCKCHAINS[chain];
  }

  chainFor(blockchain: string): Chain | null {
    const table = this.env.testnet ? TESTNET_BLOCKCHAINS : MAINNET_BLOCKCHAINS;
    const match = Object.entries(table).find(([, value]) => value === blockchain);
    return (match?.[0] as Chain | undefined) ?? null;
  }

  async provisionDepositAddress(userId: string): Promise<DepositWalletProvision> {
    const settlementEnv = assertCircleSettlementEnv(this.env);
    const response = await this.client.createWallets({
      walletSetId: settlementEnv.depositsWalletSetId,
      blockchains: [this.env.testnet ? "EVM-TESTNET" : "EVM"],
      count: 1,
      metadata: [{ name: `deposit:${userId}`, refId: userId }],
    });
    const wallet = response.data?.wallets?.[0];
    if (!wallet) {
      throw new Error("Circle wallet creation returned no wallet.");
    }
    return {
      circleWalletId: wallet.id,
      walletSetId: settlementEnv.depositsWalletSetId,
      evmAddress: wallet.address,
    };
  }

  async getUsdcBalanceUsd(input: { walletId: string; chains?: Chain[] }): Promise<number> {
    // Scanning every supported chain costs two Circle calls per chain; callers
    // that know where funds can live (e.g. chains with deposit history) pass
    // them explicitly.
    const chains = input.chains?.length
      ? input.chains
      : Object.keys(MAINNET_BLOCKCHAINS) as Chain[];
    const balances = await Promise.all(chains.map((chain) =>
      this.getUsdcBalanceOnChain({ walletId: input.walletId, chain })
        .catch(() => 0)
    ));
    return balances.reduce((total, balance) => total + balance, 0);
  }

  async getUsdcBalanceOnChain(input: { walletId: string; chain: Chain }): Promise<number> {
    const chainWalletId = await this.chainWalletId(input.walletId, input.chain);
    const response = await this.client.getWalletTokenBalance({
      id: chainWalletId,
      includeAll: true,
    });
    const balances = response.data?.tokenBalances ?? [];
    // On Arc, USDC is the native gas token AND an ERC-20 view of the same
    // funds — Circle reports both. Take the largest USDC entry instead of
    // summing so the balance is not double-counted.
    return balances.reduce((max, balance) => {
      if (balance.token.symbol !== "USDC") return max;
      return Math.max(max, Number(balance.amount));
    }, 0);
  }

  getTreasuryWalletId(): string {
    return assertCircleSettlementEnv(this.env).treasuryWalletId;
  }

  getTreasuryWalletAddress(chain: Chain): string {
    void chain; // one EVM treasury address is valid on every supported chain
    return assertCircleSettlementEnv(this.env).treasuryWalletAddress;
  }

  async transferUserUsdcToTreasury(input: TreasuryTransferInput): Promise<UsdcTransfer> {
    const settlementEnv = assertCircleSettlementEnv(this.env);
    return this.transferUsdc({
      fromWalletId: input.userWalletId,
      toAddress: settlementEnv.treasuryWalletAddress,
      amountUsd: input.amountUsd,
      referenceId: input.referenceId,
      chain: input.chain,
    });
  }

  async refundUserUsdcFromTreasury(input: TreasuryRefundInput): Promise<UsdcTransfer> {
    const settlementEnv = assertCircleSettlementEnv(this.env);
    return this.transferUsdc({
      fromWalletId: settlementEnv.treasuryWalletId,
      toAddress: input.userWalletAddress,
      amountUsd: input.amountUsd,
      referenceId: input.referenceId,
      chain: input.chain,
    });
  }

  async listIncomingUsdcTransfers(input: {
    from?: string;
    pageSize?: number;
  }): Promise<CircleIncomingTransfer[]> {
    const response = await this.client.listTransactions({
      txType: "INBOUND",
      state: "COMPLETE",
      from: input.from,
      pageSize: input.pageSize ?? 50,
    });
    const transactions = response.data?.transactions ?? [];
    const transfers: CircleIncomingTransfer[] = [];
    for (const transaction of transactions) {
      if (!transaction.destinationAddress || !transaction.tokenId) continue;
      if (!(await this.isUsdcToken(transaction.tokenId))) continue;
      transfers.push({
        transferId: transaction.id,
        chain: this.chainFor(transaction.blockchain),
        blockchain: transaction.blockchain,
        sourceAddress: transaction.sourceAddress ?? null,
        destinationAddress: transaction.destinationAddress,
        amountUsd: transactionAmountUsd(transaction),
        txHash: transaction.txHash ?? null,
        tokenId: transaction.tokenId,
        state: transaction.state,
        createDate: transaction.createDate,
      });
    }
    return transfers;
  }

  private async isUsdcToken(tokenId: string): Promise<boolean> {
    if (this.usdcTokenIds.has(tokenId)) return true;
    const response = await this.client.getToken({ id: tokenId });
    const symbol = response.data?.token?.symbol;
    if (symbol === "USDC") {
      this.usdcTokenIds.add(tokenId);
      return true;
    }
    return false;
  }

  private async transferUsdc(input: {
    fromWalletId: string;
    toAddress: string;
    amountUsd: number;
    referenceId: string;
    chain: Chain;
  }): Promise<UsdcTransfer> {
    const chainWalletId = await this.chainWalletId(input.fromWalletId, input.chain);
    const tokenId = await this.usdcTokenIdForWallet(chainWalletId, input.chain);
    const created = await this.client.createTransaction({
      walletId: chainWalletId,
      tokenId,
      destinationAddress: input.toAddress,
      amount: [formatUsdAmount(input.amountUsd)],
      refId: input.referenceId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const transactionId = created.data?.id;
    if (!transactionId) {
      throw new Error("Circle transaction creation returned no transaction id.");
    }
    const transaction = await this.waitForTransaction(transactionId);
    const state = transaction?.state ?? created.data?.state ?? "INITIATED";

    if (state === "FAILED" || state === "DENIED" || state === "CANCELLED") {
      throw new Error(
        `Circle USDC transfer ${transactionId} ${state}: ${transaction?.errorReason ?? "no failure reason returned"}`,
      );
    }

    return {
      transferId: transactionId,
      referenceId: input.referenceId,
      status: state === "COMPLETE" || state === "CONFIRMED" ? "succeeded" : "pending",
      sourceWalletId: input.fromWalletId,
      destinationAddress: input.toAddress,
      amountUsd: input.amountUsd,
      asset: "usdc",
      chain: input.chain,
      createdAt: transaction?.createDate ?? new Date().toISOString(),
      raw: transaction ?? created.data,
    };
  }

  // Resolves the chain-specific wallet id for an EVM meta-wallet. Falls back
  // to the input id when the wallet is already chain-specific.
  private chainWalletId(walletId: string, chain: Chain): Promise<string> {
    const blockchain = this.blockchainFor(chain);
    const cacheKey = `${walletId}:${blockchain}`;
    const existing = this.derivedWalletIds.get(cacheKey);
    if (existing) return existing;
    const derived = this.client
      .deriveWallet({ id: walletId, blockchain: blockchain as never })
      .then((response) => response.data?.wallet?.id ?? walletId)
      .catch(() => walletId);
    this.derivedWalletIds.set(cacheKey, derived);
    return derived;
  }

  private async usdcTokenIdForWallet(chainWalletId: string, chain: Chain): Promise<string> {
    const response = await this.client.getWalletTokenBalance({
      id: chainWalletId,
      includeAll: true,
    });
    const balances = response.data?.tokenBalances ?? [];
    const usdcEntries = balances.filter((balance) => balance.token.symbol === "USDC");
    // Prefer the native representation (Arc) over the ERC-20 view.
    const usdc = usdcEntries.find((balance) => balance.token.isNative) ?? usdcEntries[0];
    if (!usdc) {
      throw new Error(`Wallet ${chainWalletId} holds no USDC to transfer on ${chain}.`);
    }
    return usdc.token.id;
  }

  private async waitForTransaction(transactionId: string): Promise<Transaction | undefined> {
    const deadline = Date.now() + this.env.transactionPollTimeoutMs;
    let transaction: Transaction | undefined;
    do {
      const response = await this.client.getTransaction({ id: transactionId });
      transaction = response.data?.transaction;
      const state = transaction?.state;
      if (
        state === "COMPLETE" || state === "CONFIRMED" || state === "FAILED"
        || state === "DENIED" || state === "CANCELLED"
      ) {
        return transaction;
      }
      await sleep(this.env.transactionPollIntervalMs);
    } while (Date.now() < deadline);
    return transaction;
  }
}

function transactionAmountUsd(transaction: Transaction): number {
  const amount = transaction.amounts?.[0];
  if (amount != null) return Number(amount);
  return Number(transaction.amountInUSD ?? 0);
}

function formatUsdAmount(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("USDC transfer amount must be a positive USD value.");
  }
  const microUsdc = BigInt(Math.round(amountUsd * 1_000_000));
  if (microUsdc <= BigInt(0)) {
    throw new Error("USDC transfer amount must be a positive USD value.");
  }
  const whole = microUsdc / BigInt(1_000_000);
  const fractional = microUsdc % BigInt(1_000_000);
  const fractionalText = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionalText ? `${whole}.${fractionalText}` : whole.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
