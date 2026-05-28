import {
  PrivyClient,
  type VerifyAccessTokenResponse,
  type Wallet,
} from "@privy-io/node";
import {
  assertPrivyEnv,
  config,
  type PrivyEnv,
  type RequiredPrivyEnv,
} from "../../core/config.ts";
import type { CassieStore } from "../../core/db/store.ts";
import type { UserSettings } from "../../core/schemas/index.ts";

export type PrivyAuthClaims = VerifyAccessTokenResponse;

export interface PrivyWalletGateway {
  verifyAccessToken(accessToken: string): Promise<PrivyAuthClaims>;
  getWallet(walletId: string): Promise<Wallet>;
  getWalletByAddress(address: string): Promise<Wallet>;
  getUsdcBalanceUsd(walletId: string): Promise<number>;
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

  async getUsdcBalanceUsd(walletId: string): Promise<number> {
    const response = await this.client.wallets().balance.get(walletId, {
      asset: this.env.spendAsset,
      chain: this.env.spendChain,
      include_currency: "usd",
    });
    const balance = response.balances.find((candidate) =>
      candidate.asset === this.env.spendAsset && candidate.chain === this.env.spendChain
    );
    return Number(balance?.display_values.usd ?? 0);
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
  defaultTradeSizeUsd?: number;
}): Promise<UserSettings> {
  return input.store.syncPrivyUser({
    privyUserId: input.privyUserId,
    privyWalletId: input.privyWalletId,
    walletAddress: input.walletAddress,
    defaultTradeSizeUsd: input.defaultTradeSizeUsd,
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  return type?.toLowerCase() === "bearer" && token ? token : null;
}
