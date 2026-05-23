import { describe, expect, it } from "vitest";
import { SignatureTypeV2 } from "@polymarket/clob-client-v2";
import {
  assertPolymarketExecutionEnv,
  cassieCheapModel,
  cassieImportantModel,
  googleApiKey,
  assertHyperliquidExecutionEnv,
  cassieApiToken,
  normalizePrivateKey,
  numberEnv,
  polymarketGammaMarketsUrl,
  readHyperliquidExecutionEnv,
  readPolymarketExecutionEnv,
  requiredConnectorEnv,
  xPollingEnv,
} from "../packages/core/env.ts";
import { MissingConnectorConfigError } from "../packages/core/connector-errors.ts";

describe("Polymarket env", () => {
  it("reads and normalizes CLOB execution config from env", () => {
    const config = readPolymarketExecutionEnv({
      POLYMARKET_PRIVATE_KEY: "1".repeat(64),
      POLYMARKET_CLOB_API_KEY: "key",
      POLYMARKET_CLOB_SECRET: "secret",
      POLYMARKET_CLOB_PASS_PHRASE: "passphrase",
      POLYMARKET_CLOB_HOST: "https://example.com",
      POLYMARKET_RPC_URL: "https://rpc.example.com",
      POLYMARKET_SIGNATURE_TYPE: "2",
      POLYMARKET_FUNDER_ADDRESS: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      POLYMARKET_BUILDER_CODE: `0x${"a".repeat(64)}`,
    });

    expect(config).toEqual({
      privateKey: `0x${"1".repeat(64)}`,
      creds: {
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      },
      host: "https://example.com",
      rpcUrl: "https://rpc.example.com",
      signatureType: SignatureTypeV2.POLY_GNOSIS_SAFE,
      funderAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      builderCode: `0x${"a".repeat(64)}`,
    });
  });

  it("lets explicit options override process env values", () => {
    const config = readPolymarketExecutionEnv(
      {
        POLYMARKET_PRIVATE_KEY: "1".repeat(64),
        POLYMARKET_CLOB_API_KEY: "env-key",
        POLYMARKET_CLOB_SECRET: "env-secret",
        POLYMARKET_CLOB_PASS_PHRASE: "env-passphrase",
      },
      {
        privateKey: `0x${"2".repeat(64)}`,
        apiKey: "option-key",
        apiSecret: "option-secret",
        apiPassphrase: "option-passphrase",
      },
    );

    expect(config.privateKey).toBe(`0x${"2".repeat(64)}`);
    expect(config.creds).toEqual({
      key: "option-key",
      secret: "option-secret",
      passphrase: "option-passphrase",
    });
  });

  it("validates required Polymarket execution secrets centrally", () => {
    expect(() => assertPolymarketExecutionEnv(readPolymarketExecutionEnv({})))
      .toThrow(MissingConnectorConfigError);
    expect(() =>
      assertPolymarketExecutionEnv(readPolymarketExecutionEnv({
        POLYMARKET_PRIVATE_KEY: "1".repeat(64),
      }))
    ).toThrow("POLYMARKET_CLOB_API_KEY, POLYMARKET_CLOB_SECRET, POLYMARKET_CLOB_PASS_PHRASE");
  });

  it("reads and validates Hyperliquid execution config centrally", () => {
    const config = readHyperliquidExecutionEnv({
      HYPERLIQUID_PRIVATE_KEY: "2".repeat(64),
      HYPERLIQUID_EXECUTION_SLIPPAGE_BPS: "150",
      HYPERLIQUID_PRICE_DECIMALS: "4",
    });

    expect(config).toEqual({
      privateKey: `0x${"2".repeat(64)}`,
      slippageBps: 150,
      priceDecimals: 4,
    });
    expect(assertHyperliquidExecutionEnv(config).privateKey).toBe(`0x${"2".repeat(64)}`);
    expect(() => assertHyperliquidExecutionEnv(readHyperliquidExecutionEnv({})))
      .toThrow(MissingConnectorConfigError);
  });

  it("rejects invalid private keys and signature types", () => {
    expect(() => normalizePrivateKey("not-a-key")).toThrow("POLYMARKET_PRIVATE_KEY must be a 32-byte hex private key.");
    expect(() =>
      readPolymarketExecutionEnv({
        POLYMARKET_SIGNATURE_TYPE: "9",
      })
    ).toThrow("POLYMARKET_SIGNATURE_TYPE must be 0, 1, 2, or 3.");
  });

  it("centralizes the Gamma markets URL default", () => {
    expect(polymarketGammaMarketsUrl({})).toBe("https://gamma-api.polymarket.com/markets");
    expect(polymarketGammaMarketsUrl({
      POLYMARKET_GAMMA_MARKETS_URL: "https://gamma.example.com/markets",
    })).toBe("https://gamma.example.com/markets");
  });

  it("centralizes generic required connector env validation", () => {
    expect(() => requiredConnectorEnv("DeepSeek", "DEEPSEEK_API_KEY", {}))
      .toThrow(MissingConnectorConfigError);
    expect(requiredConnectorEnv("DeepSeek", "DEEPSEEK_API_KEY", {
      DEEPSEEK_API_KEY: "key",
    })).toBe("key");
  });

  it("centralizes common model and provider env resolution", () => {
    expect(googleApiKey({ GOOGLE_GENERATIVE_AI_API_KEY: "google", GEMINI_API_KEY: "gemini" })).toBe("gemini");
    expect(cassieCheapModel("cheap-default", { DEEPSEEK_MODEL: "deepseek-model" })).toBe("deepseek-model");
    expect(cassieImportantModel("important-default", { CASSIE_MODEL: "cassie-model" })).toBe("cassie-model");
  });

  it("centralizes numeric env defaults", () => {
    expect(numberEnv("COUNT", 3, { COUNT: "4.8" }, { integer: true, min: 1 })).toBe(4);
    expect(numberEnv("COUNT", 3, { COUNT: "nope" })).toBe(3);
    expect(numberEnv("COUNT", 3, { COUNT: "-1" }, { min: 1 })).toBe(3);
  });

  it("centralizes app-level env values", () => {
    expect(cassieApiToken({ CASSIE_API_TOKEN: "token" })).toBe("token");
    expect(xPollingEnv({
      X_BEARER_TOKEN: "bearer",
      CASSIE_X_HANDLE: "cassie",
      X_POLL_MAX_RESULTS: "30",
    })).toEqual({
      bearerToken: "bearer",
      cassieHandle: "cassie",
      maxResults: 30,
    });
  });
});
