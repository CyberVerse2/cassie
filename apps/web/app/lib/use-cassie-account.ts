"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  useExportWallet,
  usePrivy,
  useSigners,
  useWallets,
  type User,
  type Wallet,
} from "@privy-io/react-auth";
import type { CassieActivityItem } from "./activity";
import { authClient } from "./auth-client";

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
  depositAddress: string | null;
  profile: PersistedUserProfile;
  x: XAccount | null;
  defaultTradeSizeUsd: number;
  telegram: TelegramConnection | null;
  balance: WalletFundingBalance | null;
  introSeen: boolean;
  promoClaimed: boolean;
  testnet: boolean;
};

export type CassieDashboardPayload = {
  account: {
    userId: string;
    walletAddress: string | null;
    defaultTradeSizeUsd: number;
    balance: WalletFundingBalance | null;
  };
  portfolioBalance: {
    currentUsd: number;
    walletBalanceUsd: number;
    openPositionEquityUsd: number;
    unrealizedPnlUsd: number;
    history: Array<{
      at: string;
      label: string;
      valueUsd: number;
      walletBalanceUsd: number;
      unrealizedPnlUsd: number;
    }>;
  };
  openPositions: CassiePosition[];
  closedPositions: CassiePosition[];
  latestReviews: Record<string, CassiePositionReview | null>;
  activity: CassieActivityItem[];
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
  filledBaseSize: number | null;
  filledSizeUsd: number;
  entryPrice: number | null;
  currentMarkPrice: number | null;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  marginUsd: number;
  leverage: number | null;
  notionalValueUsd: number | null;
  positionEquityUsd: number;
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

type PersistedUserProfile = Omit<CassieUserProfile, "initial">;

type XAccount = {
  userId: string | null;
  username: string | null;
};

type SyncInput = {
  defaultTradeSizeUsd?: number;
  requireSigner?: boolean;
};

const cassieAccountQueryKey = ["cassie", "account"] as const;

export function useCassieAccount() {
  const privy = usePrivy();
  const router = useRouter();
  const cookieSession = authClient.useSession();
  const { exportWallet } = useExportWallet();
  const { wallets, ready: walletsReady } = useWallets();
  const { addSigners } = useSigners();
  const queryClient = useQueryClient();
  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  const signerPolicyIds = useMemo(
    () => parsePolicyIds(process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS),
    [],
  );
  const cookieAuthenticated = Boolean(cookieSession.data);
  const authenticated = privy.authenticated || cookieAuthenticated;
  const ready = privy.ready && walletsReady && !cookieSession.isPending;
  const clearExpiredSession = useCallback(async (response: Response) => {
    if (response.status !== 401) return;
    queryClient.setQueryData<CassieAccount | null>(cassieAccountQueryKey, null);
    await authClient.signOut().catch(() => undefined);
    await privy.logout();
  }, [privy, queryClient]);

  // Cookie sessions authenticate via same-origin cookies; Privy sessions via
  // Bearer token. Throws when neither session is present.
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (privy.authenticated) {
      const accessToken = await privy.getAccessToken();
      if (accessToken) {
        return { Authorization: `Bearer ${accessToken}` };
      }
    }
    if (cookieAuthenticated) return {};
    throw new Error("Log in before using account actions.");
  }, [cookieAuthenticated, privy]);

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

  const fetchAccount = useCallback(async () => {
    if (!authenticated) return null;
    let headers: Record<string, string>;
    try {
      headers = await authHeaders();
    } catch {
      return null;
    }
    const response = await fetch("/api/account", { headers });
    await clearExpiredSession(response);
    if (response.status === 404) return null;
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (!response.ok || !payload.account) {
      throw new Error(payload.error ?? "Cassie account refresh failed.");
    }
    return payload.account;
  }, [authHeaders, authenticated, clearExpiredSession]);

  const accountQuery = useQuery({
    queryKey: cassieAccountQueryKey,
    queryFn: fetchAccount,
    enabled: ready && authenticated,
    staleTime: 15_000,
  });

  const userProfile = useMemo(
    () => profileFromUser(privy.user) ?? profileFromAccount(accountQuery.data ?? null),
    [privy.user, accountQuery.data],
  );

  const syncAccountRequest = useCallback(async (input: SyncInput = {}) => {
    if (!ready) return null;
    if (!authenticated) {
      throw new Error("Log in with Twitter before continuing onboarding.");
    }
    if (!privy.authenticated) {
      // Cookie sessions are synced server-side during authentication; only
      // optional settings updates remain.
      if (input.defaultTradeSizeUsd != null) {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultTradeSizeUsd: input.defaultTradeSizeUsd }),
        });
        await clearExpiredSession(response);
        const payload = await response.json() as { account?: CassieAccount; error?: string };
        if (!response.ok || !payload.account) {
          throw new Error(payload.error ?? "Cassie account sync failed.");
        }
        return payload.account;
      }
      return await fetchAccount();
    }
    if (!userProfile) {
      throw new Error("Twitter profile was not available for this Cassie account.");
    }
    if (!embeddedWallet) return null;

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
        profile: {
          name: userProfile.name,
          handle: userProfile.handle,
          avatarUrl: userProfile.avatarUrl,
        },
        x: xAccountFromUser(privy.user),
        defaultTradeSizeUsd: input.defaultTradeSizeUsd,
      }),
    });
    await clearExpiredSession(response);
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (!response.ok || !payload.account) {
      throw new Error(payload.error ?? "Cassie account sync failed.");
    }
    return payload.account;
  }, [addSigners, authenticated, clearExpiredSession, embeddedWallet, fetchAccount, privy, ready, signerId, signerPolicyIds, userProfile]);

  const syncAccountMutation = useMutation({
    mutationFn: syncAccountRequest,
    onSuccess: (nextAccount) => {
      queryClient.setQueryData<CassieAccount | null>(cassieAccountQueryKey, nextAccount);
    },
  });

  const beginTelegramConnect = useCallback(async () => {
    if (!authenticated) {
      throw new Error("Log in before connecting Telegram.");
    }
    const response = await fetch("/api/telegram/connect", {
      method: "POST",
      headers: await authHeaders(),
    });
    await clearExpiredSession(response);
    const payload = await response.json() as { telegram?: TelegramConnectSession; error?: string };
    if (!response.ok || !payload.telegram) {
      throw new Error(payload.error ?? "Telegram connection could not be started.");
    }
    return payload.telegram;
  }, [authHeaders, authenticated, clearExpiredSession]);

  const updateDefaultTradeSizeRequest = useCallback(async (defaultTradeSizeUsd: number) => {
    if (!authenticated) {
      throw new Error("Log in before updating your default trade size.");
    }
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        ...await authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ defaultTradeSizeUsd }),
    });
    await clearExpiredSession(response);
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (!response.ok || !payload.account) {
      throw new Error(payload.error ?? "Default trade size update failed.");
    }
    return payload.account;
  }, [authHeaders, authenticated, clearExpiredSession]);

  const updateDefaultTradeSizeMutation = useMutation({
    mutationFn: updateDefaultTradeSizeRequest,
    onSuccess: (nextAccount) => {
      queryClient.setQueryData<CassieAccount | null>(cassieAccountQueryKey, nextAccount);
    },
  });
  const syncAccount = useCallback((input: SyncInput = {}) =>
    syncAccountMutation.mutateAsync(input), [syncAccountMutation]);

  const prepareAccount = useCallback(async (input: SyncInput = {}) => {
    try {
      return await syncAccountMutation.mutateAsync({ ...input, requireSigner: true });
    } catch {
      return null;
    }
  }, [syncAccountMutation]);

  const refreshAccount = useCallback(async () => {
    try {
      return await queryClient.fetchQuery({
        queryKey: cassieAccountQueryKey,
        queryFn: fetchAccount,
        staleTime: 0,
      });
    } catch {
      return null;
    }
  }, [fetchAccount, queryClient]);

  const updateDefaultTradeSize = useCallback((defaultTradeSizeUsd: number) =>
    updateDefaultTradeSizeMutation.mutateAsync(defaultTradeSizeUsd), [updateDefaultTradeSizeMutation]);

  const logout = useCallback(async () => {
    queryClient.setQueryData<CassieAccount | null>(cassieAccountQueryKey, null);
    await authClient.signOut().catch(() => undefined);
    await privy.logout();
    router.push("/");
  }, [privy, queryClient, router]);

  const exportKeys = useCallback(async () => {
    if (!privy.authenticated) {
      throw new Error("Log in before exporting wallet keys.");
    }
    if (!embeddedWallet?.address) {
      throw new Error("No Privy embedded wallet is available to export.");
    }
    await exportWallet({ address: embeddedWallet.address });
  }, [embeddedWallet?.address, exportWallet, privy.authenticated]);

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...await authHeaders(),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    await clearExpiredSession(response);
    return response;
  }, [authHeaders, clearExpiredSession]);

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

  const fetchDashboard = useCallback(async () => {
    const response = await authedFetch("/api/dashboard");
    const payload = await response.json() as {
      dashboard?: CassieDashboardPayload;
      error?: string;
    };
    if (!response.ok || !payload.dashboard) {
      throw new Error(payload.error ?? "Dashboard could not be loaded.");
    }
    return payload.dashboard;
  }, [authedFetch]);

  const fetchPositionMarks = useCallback(async (positionIds: string[]) => {
    if (positionIds.length === 0) return [];
    const response = await authedFetch("/api/positions/marks", {
      method: "POST",
      body: JSON.stringify({ positionIds }),
    });
    const payload = await response.json() as {
      positions?: CassiePosition[];
      error?: string;
    };
    if (!response.ok || !payload.positions) {
      throw new Error(payload.error ?? "Position marks could not be loaded.");
    }
    return payload.positions;
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

  // One-way, optimistic: the dashboard hides the intro immediately and the
  // server records it so it never re-opens on another browser or device.
  const markIntroSeen = useCallback(async () => {
    queryClient.setQueryData<CassieAccount | null>(
      cassieAccountQueryKey,
      (current) => (current ? { ...current, introSeen: true } : current),
    );
    const response = await authedFetch("/api/settings", {
      method: "POST",
      body: JSON.stringify({ introSeen: true }),
    });
    const payload = await response.json() as { account?: CassieAccount; error?: string };
    if (response.ok && payload.account) {
      queryClient.setQueryData<CassieAccount | null>(cassieAccountQueryKey, payload.account);
    }
  }, [authedFetch, queryClient]);

  const claimPromo = useCallback(async () => {
    const response = await authedFetch("/api/promo/claim", { method: "POST" });
    const payload = await response.json() as {
      grant?: { amountUsd: number; transferId: string | null };
      error?: string;
    };
    if (!response.ok || !payload.grant) {
      throw new Error(payload.error ?? "The starter USDC could not be sent.");
    }
    await refreshAccount();
    return payload.grant;
  }, [authedFetch, refreshAccount]);

  const fetchActivity = useCallback(async () => {
    const response = await authedFetch("/api/activity");
    const payload = await response.json() as { activity?: CassieActivityItem[]; error?: string };
    if (!response.ok || !payload.activity) {
      throw new Error(payload.error ?? "Activity could not be loaded.");
    }
    return payload.activity;
  }, [authedFetch]);

  const account = accountQuery.data ?? null;
  const actionError = syncAccountMutation.error
    ?? updateDefaultTradeSizeMutation.error
    ?? accountQuery.error;
  const status: "idle" | "loading" | "error" = syncAccountMutation.isPending || updateDefaultTradeSizeMutation.isPending
    ? "loading"
    : actionError
      ? "error"
      : "idle";
  const error = actionError instanceof Error ? actionError.message : null;

  const login = useCallback(() => {
    void authClient.signIn.social({ provider: "twitter", callbackURL: "/dashboard" });
  }, []);

  return {
    account,
    userProfile,
    authenticated,
    ready,
    status,
    error,
    walletAddress: embeddedWallet?.address ?? account?.walletAddress ?? null,
    depositAddress: account?.depositAddress ?? null,
    walletReadyForSpending: Boolean(embeddedWallet?.id && embeddedWallet.delegated),
    login,
    logout,
    exportKeys,
    prepareAccount,
    beginTelegramConnect,
    claimPromo,
    markIntroSeen,
    refreshAccount,
    syncAccount,
    updateDefaultTradeSize,
    fetchDashboard,
    fetchPositions,
    fetchPositionMarks,
    closePosition,
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

function profileFromAccount(account: CassieAccount | null): CassieUserProfile | null {
  if (!account) return null;
  const handle = account.profile.handle.startsWith("@")
    ? account.profile.handle
    : `@${account.profile.handle}`;
  const name = account.profile.name.trim() || handle;
  const initial = (name.replace(/^@/, "").trim()[0] ?? "C").toUpperCase();
  return {
    name,
    handle,
    avatarUrl: account.profile.avatarUrl,
    initial,
  };
}

function xAccountFromUser(user: User | null): XAccount | null {
  const twitter = user?.twitter
    ?? user?.linkedAccounts.find((account) => account.type === "twitter_oauth");
  if (!twitter) return null;
  return {
    userId: typeof twitter.subject === "string" ? twitter.subject : null,
    username: typeof twitter.username === "string" ? twitter.username.replace(/^@/, "") : null,
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
