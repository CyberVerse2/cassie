"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useDelegatedActions,
  usePrivy,
  useWallets,
  type Wallet,
} from "@privy-io/react-auth";

type WalletFundingBalance = {
  walletBalanceUsd: number;
  reservedUsd: number;
  spendableUsd: number;
};

type CassieAccount = {
  userId: string;
  privyUserId: string | null;
  privyWalletId: string | null;
  walletAddress: string | null;
  defaultTradeSizeUsd: number;
  balance: WalletFundingBalance | null;
};

type SyncInput = {
  defaultTradeSizeUsd?: number;
  requireDelegation?: boolean;
};

export function useCassieAccount() {
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { delegateWallet } = useDelegatedActions();
  const [account, setAccount] = useState<CassieAccount | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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
    if (input.requireDelegation && !embeddedWallet.delegated) {
      await delegateWallet({
        address: embeddedWallet.address,
        chainType: "ethereum",
      });
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
        walletAddress: embeddedWallet.address,
        privyWalletId: embeddedWallet.id ?? null,
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
  }, [delegateWallet, embeddedWallet, privy, walletsReady]);

  const prepareAccount = useCallback(async (input: SyncInput = {}) => {
    try {
      return await syncAccount({ ...input, requireDelegation: true });
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

  return {
    account,
    authenticated: privy.authenticated,
    ready: privy.ready && walletsReady,
    status,
    error,
    walletAddress: embeddedWallet?.address ?? account?.walletAddress ?? null,
    walletReadyForSpending: Boolean(embeddedWallet?.delegated && embeddedWallet.id),
    login: privy.login,
    logout: privy.logout,
    prepareAccount,
    refreshAccount,
    syncAccount,
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
