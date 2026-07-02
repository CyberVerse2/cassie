import { describe, expect, it, vi } from "vitest";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { CircleWalletAdapter } from "../packages/adapters/circle/index.ts";
import type { CircleEnv } from "../packages/core/config.ts";

const env: CircleEnv = {
  apiKey: "TEST_API_KEY",
  entitySecret: "secret",
  depositsWalletSetId: "wallet_set_1",
  treasuryWalletId: "treasury_wallet",
  treasuryWalletAddress: "0x2222222222222222222222222222222222222222",
  testnet: false,
  defaultChain: "arc",
  transactionPollIntervalMs: 1,
  transactionPollTimeoutMs: 50,
};

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    createWallets: vi.fn().mockResolvedValue({
      data: { wallets: [{ id: "circle_wallet_1", address: "0xAAaA111111111111111111111111111111111111" }] },
    }),
    getWalletTokenBalance: vi.fn().mockResolvedValue({
      data: {
        tokenBalances: [
          { amount: "25.5", token: { id: "usdc_base", symbol: "USDC", blockchain: "BASE" } },
          { amount: "10", token: { id: "usdc_arb", symbol: "USDC", blockchain: "ARB" } },
          { amount: "99", token: { id: "weth", symbol: "WETH", blockchain: "BASE" } },
        ],
      },
    }),
    createTransaction: vi.fn().mockResolvedValue({
      data: { id: "tx_1", state: "INITIATED" },
    }),
    getTransaction: vi.fn().mockResolvedValue({
      data: {
        transaction: {
          id: "tx_1",
          state: "COMPLETE",
          createDate: "2026-07-01T00:00:00.000Z",
        },
      },
    }),
    getToken: vi.fn().mockResolvedValue({
      data: { token: { id: "usdc_base", symbol: "USDC" } },
    }),
    listTransactions: vi.fn().mockResolvedValue({ data: { transactions: [] } }),
    ...overrides,
  } as unknown as CircleDeveloperControlledWalletsClient;
}

describe("CircleWalletAdapter", () => {
  it("provisions one EVM deposit wallet in the deposits wallet set", async () => {
    const client = fakeClient();
    const adapter = new CircleWalletAdapter(env, client);

    const provisioned = await adapter.provisionDepositAddress("user_1");

    expect(provisioned).toEqual({
      circleWalletId: "circle_wallet_1",
      walletSetId: "wallet_set_1",
      evmAddress: "0xAAaA111111111111111111111111111111111111",
    });
    expect(client.createWallets).toHaveBeenCalledWith({
      walletSetId: "wallet_set_1",
      blockchains: ["EVM"],
      count: 1,
      metadata: [{ name: "deposit:user_1", refId: "user_1" }],
    });
  });

  it("sums only USDC balances across chains", async () => {
    const adapter = new CircleWalletAdapter(env, fakeClient());
    await expect(adapter.getUsdcBalanceUsd({ walletId: "w1" })).resolves.toBe(35.5);
  });

  it("transfers USDC to the treasury and reports the requested chain", async () => {
    const client = fakeClient();
    const adapter = new CircleWalletAdapter(env, client);

    const result = await adapter.transferUserUsdcToTreasury({
      userWalletId: "circle_wallet_1",
      amountUsd: 12.34,
      referenceId: "trade_prefund:job_1",
      chain: "arbitrum",
    });

    expect(result).toMatchObject({
      transferId: "tx_1",
      referenceId: "trade_prefund:job_1",
      status: "succeeded",
      destinationAddress: env.treasuryWalletAddress,
      amountUsd: 12.34,
      asset: "usdc",
      chain: "arbitrum",
    });
    expect(client.createTransaction).toHaveBeenCalledWith({
      walletId: "circle_wallet_1",
      tokenId: "usdc_arb",
      destinationAddress: env.treasuryWalletAddress,
      amount: ["12.34"],
      refId: "trade_prefund:job_1",
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
  });

  it("throws when the transfer ends in a terminal failure state", async () => {
    const client = fakeClient({
      getTransaction: vi.fn().mockResolvedValue({
        data: {
          transaction: { id: "tx_1", state: "FAILED", errorReason: "insufficient funds" },
        },
      }),
    });
    const adapter = new CircleWalletAdapter(env, client);

    await expect(
      adapter.refundUserUsdcFromTreasury({
        userWalletAddress: "0x1111111111111111111111111111111111111111",
        amountUsd: 5,
        referenceId: "trade_refund:job_1",
        chain: "base",
      }),
    ).rejects.toThrow("Circle USDC transfer tx_1 FAILED: insufficient funds");
  });

  it("maps testnet blockchains when CIRCLE_TESTNET is enabled", () => {
    const adapter = new CircleWalletAdapter({ ...env, testnet: true }, fakeClient());
    expect(adapter.blockchainFor("base")).toBe("BASE-SEPOLIA");
    expect(adapter.blockchainFor("arc")).toBe("ARC-TESTNET");
    expect(adapter.chainFor("ARB-SEPOLIA")).toBe("arbitrum");
    expect(adapter.chainFor("ARC-TESTNET")).toBe("arc");
  });

  it("maps arc on mainnet", () => {
    const adapter = new CircleWalletAdapter(env, fakeClient());
    expect(adapter.blockchainFor("arc")).toBe("ARC");
    expect(adapter.chainFor("ARC")).toBe("arc");
  });

  it("filters incoming transfers to USDC and maps chains", async () => {
    const client = fakeClient({
      listTransactions: vi.fn().mockResolvedValue({
        data: {
          transactions: [
            {
              id: "in_1",
              blockchain: "ARB",
              destinationAddress: "0xAAaA111111111111111111111111111111111111",
              amounts: ["40"],
              tokenId: "usdc_arb",
              state: "COMPLETE",
              txHash: "0xhash1",
              createDate: "2026-07-01T01:00:00.000Z",
            },
            {
              id: "in_2",
              blockchain: "BASE",
              destinationAddress: "0xAAaA111111111111111111111111111111111111",
              amounts: ["1"],
              tokenId: "weth_token",
              state: "COMPLETE",
              txHash: "0xhash2",
              createDate: "2026-07-01T01:01:00.000Z",
            },
          ],
        },
      }),
      getToken: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({
        data: { token: { id, symbol: id.startsWith("usdc") ? "USDC" : "WETH" } },
      })),
    });
    const adapter = new CircleWalletAdapter(env, client);

    const transfers = await adapter.listIncomingUsdcTransfers({});

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      transferId: "in_1",
      chain: "arbitrum",
      amountUsd: 40,
      txHash: "0xhash1",
    });
  });
});
