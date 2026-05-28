import {
  PrivyClient,
  type AuthorizationContext,
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
  sweepUsdc(input: {
    walletId: string;
    amountUsd: number;
  }): Promise<PrivySweepResult>;
}

export type PrivySweepResult = {
  actionId: string;
  status: string;
  raw: unknown;
};

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
      asset: this.env.sweepAsset,
      chain: this.env.sweepChain,
      include_currency: "usd",
    });
    const balance = response.balances.find((candidate) =>
      candidate.asset === this.env.sweepAsset && candidate.chain === this.env.sweepChain
    );
    return Number(balance?.display_values.usd ?? 0);
  }

  async sweepUsdc(input: {
    walletId: string;
    amountUsd: number;
  }): Promise<PrivySweepResult> {
    const response = await this.client.wallets().transfer(input.walletId, {
      authorization_context: this.authorizationContext(),
      destination: {
        address: this.env.treasuryAddress,
      },
      source: {
        asset: this.env.sweepAsset,
        amount: String(input.amountUsd),
        chain: this.env.sweepChain,
      },
    });

    return {
      actionId: response.id,
      status: response.status,
      raw: response,
    };
  }

  private authorizationContext(): AuthorizationContext {
    return {
      authorization_private_keys: [this.env.authorizationPrivateKey],
    };
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

export async function sweepPrivyUserWallet(input: {
  store: CassieStore;
  settings: UserSettings;
  gateway?: Pick<PrivyWalletGateway, "getUsdcBalanceUsd" | "sweepUsdc">;
  minSweepUsd?: number;
}): Promise<{ swept: boolean; amountUsd: number; externalRef: string | null }> {
  if (!input.settings.privyWalletId) {
    throw new Error("Privy sweep requires a delegated Privy wallet ID.");
  }

  const env = config.privy;
  const gateway = input.gateway ?? new PrivyAdapter(env);
  const minSweepUsd = input.minSweepUsd ?? env.minSweepUsd;
  const amountUsd = await gateway.getUsdcBalanceUsd(input.settings.privyWalletId);
  if (amountUsd < minSweepUsd || amountUsd <= 0) {
    return { swept: false, amountUsd, externalRef: null };
  }

  const sweep = await gateway.sweepUsdc({
    walletId: input.settings.privyWalletId,
    amountUsd,
  });

  await input.store.creditUserBalance({
    userId: input.settings.userId,
    amountUsd,
    source: "privy_sweep",
    externalRef: sweep.actionId,
    metadata: sweep.raw,
  });

  return { swept: true, amountUsd, externalRef: sweep.actionId };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  return type?.toLowerCase() === "bearer" && token ? token : null;
}
