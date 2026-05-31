import { describe, expect, it } from "vitest";
import {
  assertRuntimeConfig,
  assertPolymarketExecutionEnv,
  assertPrivySettlementEnv,
  readAiProviderEnv,
  readCassieConfig,
  readGraphileWorkerEnv,
  assertHyperliquidExecutionEnv,
  normalizePrivateKey,
  numberEnv,
  readHyperliquidExecutionEnv,
  readPolymarketExecutionEnv,
  readTelegramEnv,
  requiredConnectorEnv,
} from "../packages/core/config.ts";
import { MissingConnectorConfigError } from "../packages/core/helpers/connector-errors.ts";

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
      POLYMARKET_RELAYER_API_KEY: "relayer-key",
      POLYMARKET_RELAYER_API_KEY_ADDRESS: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
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
      signatureType: 2,
      funderAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
      builderCode: `0x${"a".repeat(64)}`,
      relayerApiKey: "relayer-key",
      relayerApiKeyAddress: "0x193c2109089dD260811f1852C9B1521D6CCF1c6B",
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

  it("centralizes generic required connector env validation", () => {
    expect(() => requiredConnectorEnv("DeepSeek", "DEEPSEEK_API_KEY", {}))
      .toThrow(MissingConnectorConfigError);
    expect(requiredConnectorEnv("DeepSeek", "DEEPSEEK_API_KEY", {
      DEEPSEEK_API_KEY: "key",
    })).toBe("key");
  });

  it("validates Privy treasury settlement config", () => {
    expect(() => assertPrivySettlementEnv(readCassieConfig({
      NEXT_PUBLIC_PRIVY_APP_ID: "app",
      PRIVY_APP_SECRET: "secret",
    }).privy)).toThrow("PRIVY_AUTHORIZATION_PRIVATE_KEY, CASSIE_TREASURY_WALLET_ID, CASSIE_TREASURY_WALLET_ADDRESS");

    expect(assertPrivySettlementEnv(readCassieConfig({
      NEXT_PUBLIC_PRIVY_APP_ID: "app",
      PRIVY_APP_SECRET: "secret",
      PRIVY_AUTHORIZATION_PRIVATE_KEY: "private-key",
      CASSIE_TREASURY_WALLET_ID: "treasury-wallet",
      CASSIE_TREASURY_WALLET_ADDRESS: "0x2222222222222222222222222222222222222222",
    }).privy)).toMatchObject({
      appId: "app",
      appSecret: "secret",
      authorizationPrivateKey: "private-key",
      treasuryWalletId: "treasury-wallet",
      treasuryWalletAddress: "0x2222222222222222222222222222222222222222",
    });
  });

  it("fails startup validation when the cheap AI dependency is missing", () => {
    expect(() => assertRuntimeConfig({
      DATABASE_URL: "postgres://cassie",
      GEMINI_API_KEY: "gemini",
      OPENAI_API_KEY: "openai",
      XAI_API_KEY: "xai",
    })).toThrow("DEEPSEEK_API_KEY");
  });

  it("treats blank runtime config values as missing", () => {
    expect(() => assertRuntimeConfig({
      DATABASE_URL: " ",
      GEMINI_API_KEY: "gemini",
      DEEPSEEK_API_KEY: "deepseek",
      OPENAI_API_KEY: "openai",
      XAI_API_KEY: "xai",
    })).toThrow("DATABASE_URL");
  });

  it("centralizes numeric env defaults", () => {
    expect(numberEnv("COUNT", 3, { COUNT: "4.8" }, { integer: true, min: 1 })).toBe(4);
    expect(numberEnv("COUNT", 3, {})).toBe(3);
    expect(numberEnv("COUNT", 3, { COUNT: "" })).toBe(3);
    expect(() => numberEnv("COUNT", 3, { COUNT: "nope" }))
      .toThrow("COUNT must be a number.");
    expect(() => numberEnv("COUNT", 3, { COUNT: "-1" }, { min: 1 }))
      .toThrow("COUNT must be at least 1.");
    expect(() => readCassieConfig({ CASSIE_STRUCTURED_MAX_RETRIES: "0" }))
      .toThrow("CASSIE_STRUCTURED_MAX_RETRIES must be at least 1.");
  });

  it("reads grouped AI provider and Graphile worker config", () => {
    const env = {
      GEMINI_API_KEY: "gemini",
      GOOGLE_GENERATIVE_AI_API_KEY: "google",
      DEEPSEEK_API_KEY: "deepseek",
      OPENAI_API_KEY: "openai",
      XAI_API_KEY: "xai",
      CASSIE_CHEAP_MODEL: "cheap",
      CASSIE_IMPORTANT_MODEL: "important",
      CASSIE_WEB_SEARCH_MODEL: "web-search",
      GROK_X_SEARCH_MODEL: "grok-search",
      CASSIE_STRUCTURED_MAX_RETRIES: "4",
      GRAPHILE_EXECUTION_MAX_ATTEMPTS: "7",
      GRAPHILE_SUPERVISOR_MAX_ATTEMPTS: "4",
      GRAPHILE_WORKER_CONCURRENCY: "3",
      GRAPHILE_WORKER_POLL_INTERVAL_MS: "2500",
    };

    expect(readAiProviderEnv(env, {
      cheapModel: "cheap-default",
      importantModel: "important-default",
      webSearchModel: "web-default",
      grokXSearchModel: "grok-default",
    })).toEqual({
      googleApiKey: "gemini",
      deepSeekApiKey: "deepseek",
      openAiApiKey: "openai",
      xAiApiKey: "xai",
      cheapModel: "cheap",
      importantModel: "important",
      webSearchModel: "web-search",
      grokXSearchModel: "grok-search",
    });
    expect(readGraphileWorkerEnv(env)).toEqual({
      executionMaxAttempts: 7,
      supervisorMaxAttempts: 4,
      concurrency: 3,
      pollIntervalMs: 2500,
    });
  });

  it("builds one validated runtime config object", () => {
    const privateKey = "3".repeat(64);
    const config = readCassieConfig({
      DATABASE_URL: "postgres://cassie",
      GEMINI_API_KEY: "gemini",
      DEEPSEEK_API_KEY: "deepseek",
      OPENAI_API_KEY: "openai",
      XAI_API_KEY: "xai",
      X_BEARER_TOKEN: "bearer",
      X_CONSUMER_SECRET: "secret",
      CASSIE_X_HANDLE: "cassiedottrade",
      X_OAUTH2_CLIENT_ID: "client-id",
      X_OAUTH2_CLIENT_SECRET: "client-secret",
      X_USER_ACCESS_TOKEN: "user-access",
      X_USER_REFRESH_TOKEN: "user-refresh",
      X_ACCOUNT_ACTIVITY_WEBHOOK_ID: "webhook-id",
      X_WEBHOOK_USER_ID: "123",
      EXECUTION_WEBHOOK_URL: "https://execution.example.com",
      HYPERLIQUID_PRIVATE_KEY: privateKey,
      POLYMARKET_PRIVATE_KEY: privateKey,
      POLYMARKET_CLOB_API_KEY: "poly-key",
      POLYMARKET_CLOB_SECRET: "poly-secret",
      POLYMARKET_CLOB_PASS_PHRASE: "poly-passphrase",
      CASSIE_STRUCTURED_MAX_RETRIES: "4",
      CASSIE_CONNECTOR_CALL_TIMEOUT_MS: "120000",
      CASSIE_SUPERVISOR_TIMEOUT_MS: "240000",
      CASSIE_SUPERVISOR_STEP_TIMEOUT_MS: "60000",
    });

    expect(config).toMatchObject({
      ai: {
        googleApiKey: "gemini",
        deepSeekApiKey: "deepseek",
        openAiApiKey: "openai",
        xAiApiKey: "xai",
      },
      database: {
        url: "postgres://cassie",
      },
      structuredAi: {
        maxRetries: 4,
      },
      x: {
        accountActivityWebhookId: "webhook-id",
        bearerToken: "bearer",
        cassieHandle: "cassiedottrade",
        consumerSecret: "secret",
        oauth2ClientId: "client-id",
        oauth2ClientSecret: "client-secret",
        userAccessToken: "user-access",
        userRefreshToken: "user-refresh",
        webhookUserId: "123",
      },
      supervisor: {
        timeoutMs: 240000,
        stepTimeoutMs: 60000,
      },
      execution: {
        webhookUrl: "https://execution.example.com",
        hyperliquid: {
          privateKey: `0x${privateKey}`,
        },
        polymarket: {
          privateKey: `0x${privateKey}`,
          creds: {
            key: "poly-key",
            secret: "poly-secret",
            passphrase: "poly-passphrase",
          },
        },
      },
      telegram: {
        connectTtlMs: 600000,
        pollIntervalMs: 2000,
        longPollTimeoutSeconds: 30,
      },
    });
  });

  it("reads Telegram bot config and normalizes the public username", () => {
    expect(readTelegramEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_BOT_USERNAME: "@cassie_bot",
      TELEGRAM_CONNECT_TTL_MS: "120000",
      TELEGRAM_POLL_INTERVAL_MS: "2500",
      TELEGRAM_LONG_POLL_TIMEOUT_SECONDS: "45",
    })).toEqual({
      botToken: "token",
      botUsername: "cassie_bot",
      connectTtlMs: 120000,
      pollIntervalMs: 2500,
      longPollTimeoutSeconds: 45,
    });
  });
});
