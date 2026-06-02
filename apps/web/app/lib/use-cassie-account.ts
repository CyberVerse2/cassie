"use client";

import { useCallback, useMemo, useState } from "react";
import {
  usePrivy,
  useSigners,
  useWallets,
  type User,
  type Wallet,
} from "@privy-io/react-auth";
import type { CassieActivityItem } from "./activity";

type WalletFundingBalance = {
  walletBalanceUsd: number;
  reservedUsd: number;
  spendableUsd: number;
};

type TelegramConnection = {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  connectedAt: string;
  lastMessageAt: string;
};

type CassieAccount = {
  userId: string;
  privyUserId: string | null;
  privyWalletId: string | null;
  walletAddress: string | null;
  defaultTradeSizeUsd: number;
  telegram: TelegramConnection | null;
  balance: WalletFundingBalance | null;
  withdrawableUsd: number | null;
};

export type CassiePosition = {
  positionId: string;
  userId: string;
  ticketId: string;
  executionJobId: string;
  venue: string;
  instrument: string;
  symbol: string | null;
  side: string;
  status: "open" | "closing" | "closed" | "close_failed";
  entrySizeUsd: number;
  filledSizeUsd: number;
  entryPrice: number | null;
  currentMarkPrice: number | null;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  exitPlan: {
    takeProfitPct: number;
    stopLossPct: number;
    maxHoldDays: number;
    reviewCadence: "daily";
    thesis: string;
    invalidationSignals: string[];
  };
  openedAt: string;
  updatedAt: string;
  lastMarkedAt: string | null;
  closedAt: string | null;
  closeExecutionJobId: string | null;
  failureReason: string | null;
};

export type CassiePositionReview = {
  reviewId: string;
  positionId: string;
  userId: string;
  reviewedAt: string;
  status: "succeeded" | "failed";
  markPrice: number | null;
  currentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  exitSignal: "none" | "take_profit" | "stop_loss" | "max_hold" | "thesis_invalidated";
  summary: string;
  failureReason: string | null;
};

export type CassieWithdrawal = {
  withdrawalId: string;
  userId: string;
  amountUsd: number;
  destinationAddress: string;
  status: "queued" | "running" | "succeeded" | "failed";
  transferId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type TelegramConnectSession = {
  connectUrl: string;
  expiresAt: string;
};

type CassieUserProfile = {
  name: string;
  handle: string;
  avatarUrl: string | null;
  initial: string;
};

type SyncInput = {
  defaultTradeSizeUsd?: number;
  requireSigner?: boolean;
};

export function useCassieAccount() {
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { addSigners } = useSigners();
  const [account, setAccount] = useState<CassieAccount | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  const signerPolicyIds = useMemo(
    () => parsePolicyIds(process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS),
    [],
  );
  const userProfile = useMemo(() => profileFromUser(privy.user), [privy.user]);

  const embeddedWallet = useMemo(() => {
    const primary = privy.user?.wallet;
    if (isPrivyEthereumWallet(primary)) return primary;
    const connected = wallets.find((wallet) =>
      wallet.type === "ethereum" && isPrivyWalletClient(wallet.walletClientType)
    );
    return connected
      ? {
        id: null,
        address: connected.address,
        chainType: "ethereum" as const,
        walletClientType: connected.walletClientType,
        delegated: false,
      }
      : null;
  }, [privy.user?.wallet, wallets]);

  const syncAccount = useCallback(async (input: SyncInput = {}) => {
    if (!privy.ready || !walletsReady) return null;
    if (!privy.authenticated) {
      throw new Error("Log in with Twitter before continuing onboarding.");
    }
    if (!embeddedWallet) return null;

    setStatus("loading");
    setError(null);
    let walletForSync = embeddedWallet;
    if (input.requireSigner && !embeddedWallet.delegated) {
      if (!signerId) {
        throw new Error("Privy signer ID is not configured.");
      }
      const { user } = await addSigners({
        address: embeddedWallet.address,
        signers: [{
          signerId,
          policyIds: signerPolicyIds,
        }],
      });
      const updatedWallet = getUserEmbeddedWallet(user);
      if (updatedWallet) {
        walletForSync = updatedWallet;
      }
    }

    const accessToken = await privy.getAccessToken();
    if (!accessToken) {
      throw new Error("Privy access token was not available.");
    }

    const response = await fetch("/api/session/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        walletAddress: walletForSync.address,
        privyWalletId: walletForSync.id ?? null,
        defaultTradeSizeUsd: input.defaultTradeSizeUsd,
      }),
    });
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (!response.ok || !payload.account) {
      throw new Error(payload.error ?? "Cassie account sync failed.");
    }
    setAccount(payload.account);
    setStatus("idle");
    return payload.account;
  }, [addSigners, embeddedWallet, privy, signerId, signerPolicyIds, walletsReady]);

  const prepareAccount = useCallback(async (input: SyncInput = {}) => {
    try {
      return await syncAccount({ ...input, requireSigner: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("error");
      return null;
    }
  }, [syncAccount]);

  const refreshAccount = useCallback(async () => {
    try {
      if (!privy.authenticated) return null;
      const accessToken = await privy.getAccessToken();
      if (!accessToken) return null;
      const response = await fetch("/api/account", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.status === 404) return null;
      const payload = await response.json() as { account?: CassieAccount; error?: string };
      if (!response.ok || !payload.account) {
        throw new Error(payload.error ?? "Cassie account refresh failed.");
      }
      setAccount(payload.account);
      return payload.account;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("error");
      return null;
    }
  }, [privy]);

  const beginTelegramConnect = useCallback(async () => {
    if (!privy.authenticated) {
      throw new Error("Log in before connecting Telegram.");
    }
    const accessToken = await privy.getAccessToken();
    if (!accessToken) {
      throw new Error("Privy access token was not available.");
    }
    const response = await fetch("/api/telegram/connect", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json() as { telegram?: TelegramConnectSession; error?: string };
    if (!response.ok || !payload.telegram) {
      throw new Error(payload.error ?? "Telegram connection could not be started.");
    }
    return payload.telegram;
  }, [privy]);

  const updateDefaultTradeSize = useCallback(async (defaultTradeSizeUsd: number) => {
    if (!privy.authenticated) {
      throw new Error("Log in before updating your default trade size.");
    }
    const accessToken = await privy.getAccessToken();
    if (!accessToken) {
      throw new Error("Privy access token was not available.");
    }
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ defaultTradeSizeUsd }),
    });
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (!response.ok || !payload.account) {
      throw new Error(payload.error ?? "Default trade size update failed.");
    }
    setAccount(payload.account);
    return payload.account;
  }, [privy]);

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!privy.authenticated) {
      throw new Error("Log in before using account actions.");
    }
    const accessToken = await privy.getAccessToken();
    if (!accessToken) {
      throw new Error("Privy access token was not available.");
    }
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }, [privy]);

  const fetchPositions = useCallback(async () => {
    const response = await authedFetch("/api/positions");
    const payload = await response.json() as {
      positions?: CassiePosition[];
      latestReviews?: Record<string, CassiePositionReview | null>;
      error?: string;
    };
    if (!response.ok || !payload.positions || !payload.latestReviews) {
      throw new Error(payload.error ?? "Positions could not be loaded.");
    }
    return {
      positions: payload.positions,
      latestReviews: payload.latestReviews,
    };
  }, [authedFetch]);

  const closePosition = useCallback(async (positionId: string) => {
    const response = await authedFetch(`/api/positions/${encodeURIComponent(positionId)}/close`, {
      method: "POST",
    });
    const payload = await response.json() as { position?: CassiePosition; error?: string };
    if (!response.ok || !payload.position) {
      throw new Error(payload.error ?? "Position close could not be queued.");
    }
    return payload.position;
  }, [authedFetch]);

  const fetchWithdrawals = useCallback(async () => {
    const response = await authedFetch("/api/withdrawals");
    const payload = await response.json() as { withdrawals?: CassieWithdrawal[]; error?: string };
    if (!response.ok || !payload.withdrawals) {
      throw new Error(payload.error ?? "Withdrawals could not be loaded.");
    }
    return payload.withdrawals;
  }, [authedFetch]);

  const createWithdrawal = useCallback(async (input: { amountUsd: number; destinationAddress: string }) => {
    const response = await authedFetch("/api/withdrawals", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const payload = await response.json() as { withdrawal?: CassieWithdrawal; error?: string };
    if (!response.ok || !payload.withdrawal) {
      throw new Error(payload.error ?? "Withdrawal could not be queued.");
    }
    return payload.withdrawal;
  }, [authedFetch]);

  const fetchActivity = useCallback(async () => {
    const response = await authedFetch("/api/activity");
    const payload = await response.json() as { activity?: CassieActivityItem[]; error?: string };
    if (!response.ok || !payload.activity) {
      throw new Error(payload.error ?? "Activity could not be loaded.");
    }
    return payload.activity;
  }, [authedFetch]);

  return {
    account,
    userProfile,
    authenticated: privy.authenticated,
    ready: privy.ready && walletsReady,
    status,
    error,
    walletAddress: embeddedWallet?.address ?? account?.walletAddress ?? null,
    walletReadyForSpending: Boolean(embeddedWallet?.id && embeddedWallet.delegated),
    login: privy.login,
    logout: privy.logout,
    prepareAccount,
    beginTelegramConnect,
    refreshAccount,
    syncAccount,
    updateDefaultTradeSize,
    fetchPositions,
    closePosition,
    fetchWithdrawals,
    createWithdrawal,
    fetchActivity,
  };
}

function profileFromUser(user: User | null): CassieUserProfile | null {
  const twitter = user?.twitter
    ?? user?.linkedAccounts.find((account) => account.type === "twitter_oauth");
  if (!twitter) return null;

  const handle = twitter.username ? `@${twitter.username.replace(/^@/, "")}` : "@connected";
  const name = twitter.name?.trim() || handle;
  const initial = (name.replace(/^@/, "").trim()[0] ?? "C").toUpperCase();

  return {
    name,
    handle,
    avatarUrl: twitter.profilePictureUrl,
    initial,
  };
}

function isPrivyEthereumWallet(wallet: Wallet | undefined): wallet is Wallet & {
  address: string;
  chainType: "ethereum";
  walletClientType: string;
  delegated: boolean;
} {
  return Boolean(
    wallet
      && wallet.chainType === "ethereum"
      && isPrivyWalletClient(wallet.walletClientType)
      && wallet.address,
  );
}

function isPrivyWalletClient(walletClientType: string | undefined): boolean {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

function parsePolicyIds(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((policyId) => policyId.trim()).filter(Boolean);
}

function getUserEmbeddedWallet(user: User): (Wallet & {
  address: string;
  chainType: "ethereum";
  walletClientType: string;
  delegated: boolean;
}) | null {
  return isPrivyEthereumWallet(user.wallet) ? user.wallet : null;
}
