import { describe, expect, it } from "vitest";
import { buildCliUserSettings } from "../src/cli-settings.ts";

describe("CLI settings", () => {
  it("generates a wallet when no wallet is provided and keeps venues/assets defaulted", () => {
    const result = buildCliUserSettings({});

    expect(result.settings.userId).toBe("local-user");
    expect(result.settings.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.settings.allowedVenues).toEqual(["hyperliquid", "polymarket"]);
    expect(result.settings.allowedAssets).toEqual(["SOL"]);
    expect(result.generatedWallet).toMatchObject({
      address: result.settings.walletAddress,
    });
    expect(result.generatedWallet?.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("uses the provided wallet and does not generate a private key", () => {
    const result = buildCliUserSettings({
      user: "alice",
      wallet: "0x0000000000000000000000000000000000000001",
      assets: "SOL,BTC",
    });

    expect(result.settings.userId).toBe("alice");
    expect(result.settings.walletAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(result.settings.allowedAssets).toEqual(["SOL", "BTC"]);
    expect(result.generatedWallet).toBeNull();
  });
});
