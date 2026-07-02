import { Buffer } from "node:buffer";
import {
  PrivyClient,
  type VerifyAccessTokenResponse,
  type Wallet,
} from "@privy-io/node";
import {
  assertPrivySettlementEnv,
  assertPrivyEnv,
  config,
  type PrivyEnv,
  type RequiredPrivyEnv,
  type RequiredPrivySettlementEnv,
} from "../../core/config.ts";
import type { CassieStore } from "../../core/db/store.ts";
import { readJsonResponse } from "../../core/helpers/connector-errors.ts";
import type { UserSettings } from "../../core/schemas/index.ts";

import type {
  Chain,
  TreasuryRefundInput,
  TreasuryTransferInput,
  UsdcTransfer,
  WalletGateway,
} from "../wallet/gateway.ts";

type TransferActionResponse = Awaited<ReturnType<ReturnType<PrivyClient["wallets"]>["transfer"]>>;

export type PrivyAuthClaims = VerifyAccessTokenResponse;

export interface PrivyWalletGateway extends WalletGateway {
  verifyAccessToken(accessToken: string): Promise<PrivyAuthClaims>;
  getWallet(walletId: string): Promise<Wallet>;
  getWalletByAddress(address: string): Promise<Wallet>;
}

export class PrivyAdapter implements PrivyWalletGateway {
  private readonly env: RequiredPrivyEnv;
  private readonly client: PrivyClient;

  constructor(env: PrivyEnv = config.privy, client?: PrivyClient) {
    this.env = assertPrivyEnv(env);
    this.client = client ?? new PrivyClient({
      appId: this.env.appId,
      appSecret: this.env.appSecret,
    });
  }

  async verifyAccessToken(accessToken: string): Promise<PrivyAuthClaims> {
    return this.client.utils().auth().verifyAccessToken(accessToken);
  }

  async getWallet(walletId: string): Promise<Wallet> {
    return this.client.wallets().get(walletId);
  }

  async getWalletByAddress(address: string): Promise<Wallet> {
    return this.client.wallets().getWalletByAddress({ address });
  }

  async getUsdcBalanceUsd(input: { walletId: string }): Promise<number> {
    const response = await this.client.wallets().balance.get(input.walletId, {
      asset: this.env.spendAsset,
      chain: this.env.spendChain,
      include_currency: "usd",
    });
    const balance = response.balances.find((candidate) =>
      candidate.asset === this.env.spendAsset && candidate.chain === this.env.spendChain
    );
    return Number(balance?.display_values.usd ?? 0);
  }

  getTreasuryWalletAddress(chain: Chain): string {
    assertPrivySupportedChain(chain);
    return assertPrivySettlementEnv(this.env).treasuryWalletAddress;
  }

  async transferUserUsdcToTreasury(input: TreasuryTransferInput): Promise<UsdcTransfer> {
    assertPrivySupportedChain(input.chain);
    const settlementEnv = assertPrivySettlementEnv(this.env);
    return this.transferUsdc({
      fromWalletId: input.userWalletId,
      toAddress: settlementEnv.treasuryWalletAddress,
      amountUsd: input.amountUsd,
      referenceId: input.referenceId,
      chain: input.chain,
      settlementEnv,
    });
  }

  // Sends USDC from a delegated user wallet to an arbitrary address, using
  // the server-side authorization key (no client Privy session required).
  async transferUserUsdc(input: {
    userWalletId: string;
    toAddress: string;
    amountUsd: number;
    referenceId: string;
  }): Promise<UsdcTransfer> {
    assertPrivySettlementEnv(this.env);
    return this.transferUsdc({
      fromWalletId: input.userWalletId,
      toAddress: input.toAddress,
      amountUsd: input.amountUsd,
      referenceId: input.referenceId,
      chain: "base",
      settlementEnv: assertPrivySettlementEnv(this.env),
    });
  }

  async refundUserUsdcFromTreasury(input: TreasuryRefundInput): Promise<UsdcTransfer> {
    assertPrivySupportedChain(input.chain);
    const settlementEnv = assertPrivySettlementEnv(this.env);
    return this.transferUsdc({
      fromWalletId: settlementEnv.treasuryWalletId,
      toAddress: input.userWalletAddress,
      amountUsd: input.amountUsd,
      referenceId: input.referenceId,
      chain: input.chain,
      settlementEnv,
    });
  }

  private async transferUsdc(input: {
    fromWalletId: string;
    toAddress: string;
    amountUsd: number;
    referenceId: string;
    chain: Chain;
    settlementEnv: RequiredPrivySettlementEnv;
  }): Promise<UsdcTransfer> {
    const initial = await this.client.wallets().transfer(input.fromWalletId, {
      destination: { address: input.toAddress },
      source: {
        asset: this.env.spendAsset,
        chain: this.env.spendChain,
        amount: formatUsdAmount(input.amountUsd),
      },
      authorization_context: {
        authorization_private_keys: [input.settlementEnv.authorizationPrivateKey],
      },
    });
    const response = await this.waitForWalletAction(input.fromWalletId, initial);

    if (response.status === "failed" || response.status === "rejected") {
      throw new Error(`Privy USDC transfer ${response.id} ${response.status}: ${response.failure_reason?.message ?? "no failure reason returned"}`);
    }

    return {
      transferId: response.id,
      referenceId: input.referenceId,
      status: response.status,
      sourceWalletId: input.fromWalletId,
      destinationAddress: response.destination_address,
      amountUsd: Number(response.source_amount),
      asset: "usdc",
      chain: input.chain,
      createdAt: response.created_at,
      raw: response,
    };
  }

  private async waitForWalletAction(
    walletId: string,
    action: TransferActionResponse,
  ): Promise<TransferActionResponse> {
    let current = action;
    const deadline = Date.now() + this.env.walletActionPollTimeoutMs;
    while (current.status === "pending" && Date.now() < deadline) {
      await sleep(this.env.walletActionPollIntervalMs);
      current = await this.getWalletAction(walletId, action.id);
    }
    return current;
  }

  private async getWalletAction(walletId: string, actionId: string): Promise<TransferActionResponse> {
    const response = await fetch(
      `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/actions/${encodeURIComponent(actionId)}?include=steps`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.env.appId}:${this.env.appSecret}`).toString("base64")}`,
          "privy-app-id": this.env.appId,
        },
      },
    );
    return readJsonResponse<TransferActionResponse>("Privy wallet action status", response);
  }
}

export async function authenticatePrivyRequest(
  request: Request,
  gateway: Pick<PrivyWalletGateway, "verifyAccessToken"> = new PrivyAdapter(),
): Promise<PrivyAuthClaims> {
  const accessToken = bearerToken(request);
  if (!accessToken) {
    throw new Error("Missing Privy access token.");
  }
  return gateway.verifyAccessToken(accessToken);
}

export async function syncPrivyAccount(input: {
  store: CassieStore;
  privyUserId: string;
  walletAddress: string | null;
  privyWalletId: string | null;
  profile: UserSettings["profile"];
  defaultTradeSizeUsd?: number;
}): Promise<UserSettings> {
  return input.store.syncPrivyUser({
    privyUserId: input.privyUserId,
    privyWalletId: input.privyWalletId,
    walletAddress: input.walletAddress,
    profile: input.profile,
    defaultTradeSizeUsd: input.defaultTradeSizeUsd,
  });
}

function assertPrivySupportedChain(chain: Chain): void {
  if (chain !== "base") {
    throw new Error(`Privy settlement only supports the base chain, received ${chain}.`);
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  return type?.toLowerCase() === "bearer" && token ? token : null;
}

function formatUsdAmount(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("USDC transfer amount must be a positive USD value.");
  }
  const microUsdcPerUsd = BigInt(1_000_000);
  const microUsdc = BigInt(Math.round(amountUsd * 1_000_000));
  if (microUsdc <= BigInt(0)) {
    throw new Error("USDC transfer amount must be a positive USD value.");
  }
  const whole = microUsdc / microUsdcPerUsd;
  const fractional = microUsdc % microUsdcPerUsd;
  const fractionalText = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionalText ? `${whole}.${fractionalText}` : whole.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
