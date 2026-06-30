import { describe, expect, it } from "vitest";
import { buildCliUserSettings } from "../src/cli-settings.ts";

describe("CLI settings", () => {
  it("generates a wallet when no wallet is provided", () => {
    const result = buildCliUserSettings(
      {},
      { defaultUserId: "2060718466630406149" },
    );

    expect(result.settings.userId).toBe("2060718466630406149");
    expect(result.settings.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.settings.defaultTradeSizeUsd).toBe(50);
    expect(result.settings).not.toHaveProperty("allowedVenues");
    expect(result.settings).not.toHaveProperty("maxTradeSizeUsd");
    expect(result.settings).not.toHaveProperty("allowedAssets");
    expect(result.generatedWallet).toMatchObject({
      address: result.settings.walletAddress,
    });
    expect(result.generatedWallet?.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("uses the provided wallet and does not generate a private key", () => {
    const result = buildCliUserSettings(
      {
        user: "alice",
        wallet: "0x0000000000000000000000000000000000000001",
      },
      { defaultUserId: "2060718466630406149" },
    );

    expect(result.settings.userId).toBe("alice");
    expect(result.settings.walletAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(result.generatedWallet).toBeNull();
  });

  it("preserves existing user settings unless a field is explicitly overridden", () => {
    const result = buildCliUserSettings(
      { size: "75" },
      {
        defaultUserId: "did:privy:user_1",
        existingSettings: {
          userId: "did:privy:user_1",
          privyUserId: "did:privy:user_1",
          privyWalletId: "wallet_1",
          walletAddress: "0x0000000000000000000000000000000000000002",
          profile: { name: "Existing", handle: "@existing", avatarUrl: null },
          defaultTradeSizeUsd: 50,
          x: { userId: "x_1", username: "existing" },
          telegram: null,
        },
      },
    );

    expect(result.settings).toMatchObject({
      userId: "did:privy:user_1",
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x0000000000000000000000000000000000000002",
      profile: { name: "Existing", handle: "@existing", avatarUrl: null },
      defaultTradeSizeUsd: 75,
      x: { userId: "x_1", username: "existing" },
      telegram: null,
    });
    expect(result.generatedWallet).toBeNull();
  });
});
