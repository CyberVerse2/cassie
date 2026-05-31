import { describe, expect, it, vi } from "vitest";
import { HyperliquidAccountStateProvider } from "../packages/adapters/hyperliquid/account-state.ts";
import type { UserSettings } from "../packages/core/schemas/index.ts";

const agentAddress = "0x1111111111111111111111111111111111111111";
const masterAddress = "0x2222222222222222222222222222222222222222";

const settings: UserSettings = {
  userId: "user_1",
  privyUserId: "did:privy:user_1",
  privyWalletId: "wallet_1",
  walletAddress: agentAddress,
  defaultTradeSizeUsd: 25,
};

describe("HyperliquidAccountStateProvider", () => {
  it("uses spot USDC as usable collateral for unified agent accounts", async () => {
    const info = {
      userRole: vi.fn().mockResolvedValue({
        role: "agent",
        data: { user: masterAddress },
      }),
      userAbstraction: vi.fn().mockResolvedValue("unifiedAccount"),
      clearinghouseState: vi.fn().mockResolvedValue({
        marginSummary: {
          accountValue: "0.0",
          totalNtlPos: "125.5",
        },
        assetPositions: [
          { position: { unrealizedPnl: "-3.25" } },
          { position: { unrealizedPnl: "1.00" } },
        ],
      }),
      spotClearinghouseState: vi.fn().mockResolvedValue({
        balances: [
          { coin: "USDC", token: 0, total: "6.0", hold: "1.25", entryNtl: "0.0" },
        ],
      }),
    };

    const state = await new HyperliquidAccountStateProvider(info as never).getAccountState(settings);

    expect(info.userRole).toHaveBeenCalledWith({ user: agentAddress });
    expect(info.userAbstraction).toHaveBeenCalledWith({ user: masterAddress });
    expect(info.clearinghouseState).toHaveBeenCalledWith({ user: masterAddress });
    expect(info.spotClearinghouseState).toHaveBeenCalledWith({ user: masterAddress });
    expect(state).toEqual({
      userId: "user_1",
      availableBalanceUsd: 4.75,
      openExposureUsd: 125.5,
      dailyLossUsd: 3.25,
      openOrdersUsd: 0,
    });
  });

  it("keeps standard accounts on perps account value", async () => {
    const info = {
      userRole: vi.fn().mockResolvedValue({ role: "user" }),
      userAbstraction: vi.fn().mockResolvedValue("disabled"),
      clearinghouseState: vi.fn().mockResolvedValue({
        marginSummary: {
          accountValue: "42.5",
          totalNtlPos: "0.0",
        },
        assetPositions: [],
      }),
      spotClearinghouseState: vi.fn(),
    };

    const state = await new HyperliquidAccountStateProvider(info as never).getAccountState(settings);

    expect(info.userRole).toHaveBeenCalledWith({ user: agentAddress });
    expect(info.userAbstraction).toHaveBeenCalledWith({ user: agentAddress });
    expect(info.clearinghouseState).toHaveBeenCalledWith({ user: agentAddress });
    expect(info.spotClearinghouseState).not.toHaveBeenCalled();
    expect(state.availableBalanceUsd).toBe(42.5);
  });
});
