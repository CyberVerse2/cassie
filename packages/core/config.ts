import type { ApiKeyCreds, SignatureType } from "@polymarket/client";
import { z } from "zod";
import { MissingConnectorConfigError } from "./helpers/connector-errors.ts";

export type EnvSource = Record<string, string | undefined>;

export type NumberEnvOptions = {
  integer?: boolean;
  min?: number;
};

export type AiProviderEnvDefaults = {
  cheapModel: string;
  importantModel: string;
  webSearchModel: string;
  grokXSearchModel?: string;
};

export type AiProviderEnv = {
  googleApiKey?: string;
  deepSeekApiKey?: string;
  openAiApiKey?: string;
  xAiApiKey?: string;
  cheapModel: string;
  importantModel: string;
  webSearchModel: string;
  grokXSearchModel: string;
};

export type GraphileWorkerEnv = {
  executionMaxAttempts: number;
  supervisorMaxAttempts: number;
  concurrency: number;
  pollIntervalMs: number;
};

export type HttpRuntimeEnv = {
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
};

export type XPollingEnv = {
  bearerToken?: string;
  cassieHandle?: string;
  maxResults: number;
};

export type CassieRuntimeConfig = {
  ai: AiProviderEnv;
  structuredAi: {
    maxRetries: number;
  };
  database: {
    url?: string;
  };
  graphileWorker: GraphileWorkerEnv;
  http: HttpRuntimeEnv;
  xPolling: XPollingEnv;
  x: {
    pollUserId?: string;
    pollIntervalMs: number;
    consumerSecret?: string;
  };
  supervisor: {
    timeoutMs: number;
    stepTimeoutMs: number;
  };
  execution: {
    webhookUrl?: string;
    hyperliquid: HyperliquidExecutionEnv;
    polymarket: PolymarketExecutionEnv;
  };
  privy: PrivyEnv;
  terminal: {
    debug: boolean;
    noColor: boolean;
  };
};

function normalizedConfiguredString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const configuredStringSchema = z.preprocess(normalizedConfiguredString, z.string().optional());
const requiredConfiguredStringSchema = (min = 1) =>
  z.preprocess(normalizedConfiguredString, z.string().min(min));

const privateKeySchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
);

const aiProviderEnvSchema = z.object({
  GEMINI_API_KEY: configuredStringSchema,
  GOOGLE_GENERATIVE_AI_API_KEY: configuredStringSchema,
  DEEPSEEK_API_KEY: configuredStringSchema,
  OPENAI_API_KEY: configuredStringSchema,
  XAI_API_KEY: configuredStringSchema,
  CASSIE_CHEAP_MODEL: configuredStringSchema,
  DEEPSEEK_MODEL: configuredStringSchema,
  CASSIE_IMPORTANT_MODEL: configuredStringSchema,
  CASSIE_EXPENSIVE_MODEL: configuredStringSchema,
  CASSIE_MODEL: configuredStringSchema,
  CASSIE_WEB_SEARCH_MODEL: configuredStringSchema,
  GEMINI_WEB_SEARCH_MODEL: configuredStringSchema,
  GROK_X_SEARCH_MODEL: configuredStringSchema,
});

export const RuntimeConfigSchema = z.object({
  DATABASE_URL: requiredConfiguredStringSchema(),
  GEMINI_API_KEY: requiredConfiguredStringSchema(),
  DEEPSEEK_API_KEY: requiredConfiguredStringSchema(),
  OPENAI_API_KEY: requiredConfiguredStringSchema(),
  XAI_API_KEY: requiredConfiguredStringSchema(),
});

export function currentEnv(): EnvSource {
  return process.env;
}

export function assertRuntimeConfig(env: EnvSource = currentEnv()): void {
  const result = RuntimeConfigSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`Cassie runtime config is incomplete: ${missing}`);
  }
}

export function optionalEnv(name: string, env: EnvSource = process.env): string | undefined {
  return configuredStringSchema.parse(env[name]);
}

export function requiredConnectorEnv(
  connectorName: string,
  variable: string,
  env: EnvSource = process.env,
): string {
  const value = optionalEnv(variable, env);
  if (!value) {
    throw new MissingConnectorConfigError(connectorName, variable);
  }
  return value;
}

export function numberEnv(
  name: string,
  defaultValue: number,
  env: EnvSource = process.env,
  options: NumberEnvOptions = {},
): number {
  return parseNumberEnv(name, env, defaultValue, options);
}

export function readCassieConfig(
  env: EnvSource = process.env,
  aiDefaults: AiProviderEnvDefaults = aiProviderEnvDefaults(),
): CassieRuntimeConfig {
  return {
    ai: readAiProviderEnv(env, aiDefaults),
    structuredAi: {
      maxRetries: numberEnv("CASSIE_STRUCTURED_MAX_RETRIES", 2, env, { integer: true, min: 1 }),
    },
    database: {
      url: optionalEnv("DATABASE_URL", env),
    },
    graphileWorker: readGraphileWorkerEnv(env),
    http: readHttpRuntimeEnv(env),
    xPolling: xPollingEnv(env),
    x: {
      pollUserId: optionalEnv("X_POLL_USER_ID", env),
      pollIntervalMs: numberEnv("X_POLL_INTERVAL_MS", 120_000, env, { integer: true, min: 1 }),
      consumerSecret: optionalEnv("X_CONSUMER_SECRET", env),
    },
    supervisor: {
      timeoutMs: numberEnv("CASSIE_SUPERVISOR_TIMEOUT_MS", 1_800_000, env, { integer: true, min: 1 }),
      stepTimeoutMs: numberEnv("CASSIE_SUPERVISOR_STEP_TIMEOUT_MS", 900_000, env, { integer: true, min: 1 }),
    },
    execution: {
      webhookUrl: optionalEnv("EXECUTION_WEBHOOK_URL", env),
      hyperliquid: readHyperliquidExecutionEnv(env),
      polymarket: readPolymarketExecutionEnv(env),
    },
    privy: readPrivyEnv(env),
    terminal: {
      debug: optionalEnv("DEBUG", env) != null,
      noColor: optionalEnv("NO_COLOR", env) != null,
    },
  };
}

export const config = readCassieConfig();

export function readAiProviderEnv(
  env: EnvSource = process.env,
  defaults: AiProviderEnvDefaults,
): AiProviderEnv {
  return aiProviderEnvSchema.transform((values) => ({
    googleApiKey: firstConfigured(values.GEMINI_API_KEY, values.GOOGLE_GENERATIVE_AI_API_KEY),
    deepSeekApiKey: values.DEEPSEEK_API_KEY,
    openAiApiKey: values.OPENAI_API_KEY,
    xAiApiKey: values.XAI_API_KEY,
    cheapModel: firstConfigured(values.CASSIE_CHEAP_MODEL, values.DEEPSEEK_MODEL) ?? defaults.cheapModel,
    importantModel: firstConfigured(values.CASSIE_IMPORTANT_MODEL, values.CASSIE_EXPENSIVE_MODEL, values.CASSIE_MODEL)
      ?? defaults.importantModel,
    webSearchModel: firstConfigured(values.CASSIE_WEB_SEARCH_MODEL, values.GEMINI_WEB_SEARCH_MODEL)
      ?? defaults.webSearchModel,
    grokXSearchModel: values.GROK_X_SEARCH_MODEL ?? defaults.grokXSearchModel ?? "grok-4.3",
  })).parse(env);
}

export function readGraphileWorkerEnv(env: EnvSource = process.env): GraphileWorkerEnv {
  return z.object({
    GRAPHILE_EXECUTION_MAX_ATTEMPTS: numberSchema("GRAPHILE_EXECUTION_MAX_ATTEMPTS", 5, { integer: true, min: 1 }),
    GRAPHILE_SUPERVISOR_MAX_ATTEMPTS: numberSchema("GRAPHILE_SUPERVISOR_MAX_ATTEMPTS", 3, { integer: true, min: 1 }),
    GRAPHILE_WORKER_CONCURRENCY: numberSchema("GRAPHILE_WORKER_CONCURRENCY", 1, { integer: true, min: 1 }),
    GRAPHILE_WORKER_POLL_INTERVAL_MS: numberSchema("GRAPHILE_WORKER_POLL_INTERVAL_MS", 2_000, { integer: true, min: 1 }),
  }).transform((values) => ({
    executionMaxAttempts: values.GRAPHILE_EXECUTION_MAX_ATTEMPTS,
    supervisorMaxAttempts: values.GRAPHILE_SUPERVISOR_MAX_ATTEMPTS,
    concurrency: values.GRAPHILE_WORKER_CONCURRENCY,
    pollIntervalMs: values.GRAPHILE_WORKER_POLL_INTERVAL_MS,
  })).parse(env);
}

export function readHttpRuntimeEnv(env: EnvSource = process.env): HttpRuntimeEnv {
  return z.object({
    PORT: numberSchema("PORT", 3000, { integer: true, min: 1 }),
    CASSIE_RATE_LIMIT_MAX: numberSchema("CASSIE_RATE_LIMIT_MAX", 60, { integer: true, min: 1 }),
    CASSIE_RATE_LIMIT_WINDOW_MS: numberSchema("CASSIE_RATE_LIMIT_WINDOW_MS", 60_000, { integer: true, min: 1 }),
  }).transform((values) => ({
    port: values.PORT,
    rateLimitMax: values.CASSIE_RATE_LIMIT_MAX,
    rateLimitWindowMs: values.CASSIE_RATE_LIMIT_WINDOW_MS,
  })).parse(env);
}

export function xPollingEnv(env: EnvSource = process.env): XPollingEnv {
  return z.object({
    X_BEARER_TOKEN: configuredStringSchema,
    CASSIE_X_HANDLE: configuredStringSchema,
    X_POLL_MAX_RESULTS: numberSchema("X_POLL_MAX_RESULTS", 25, { integer: true, min: 10 }),
  }).transform((values) => ({
    bearerToken: values.X_BEARER_TOKEN,
    cassieHandle: values.CASSIE_X_HANDLE,
    maxResults: values.X_POLL_MAX_RESULTS,
  })).parse(env);
}

export type PolymarketExecutionEnvOptions = {
  privateKey?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  host?: string;
  rpcUrl?: string;
  signatureType?: SignatureType;
  funderAddress?: string;
  builderCode?: string;
  relayerApiKey?: string;
  relayerApiKeyAddress?: string;
};

export type PrivyEnv = {
  appId?: string;
  appSecret?: string;
  verificationKey?: string;
  authorizationPrivateKey?: string;
  spendChain: "base";
  spendAsset: "usdc";
};

export type RequiredPrivyEnv = PrivyEnv & {
  appId: string;
  appSecret: string;
};

export function readPrivyEnv(env: EnvSource = process.env): PrivyEnv {
  return z.object({
    PRIVY_APP_ID: configuredStringSchema,
    NEXT_PUBLIC_PRIVY_APP_ID: configuredStringSchema,
    PRIVY_APP_SECRET: configuredStringSchema,
    PRIVY_VERIFICATION_KEY: configuredStringSchema,
    PRIVY_AUTHORIZATION_PRIVATE_KEY: configuredStringSchema,
  }).transform((values) => ({
    appId: firstConfigured(values.PRIVY_APP_ID, values.NEXT_PUBLIC_PRIVY_APP_ID),
    appSecret: values.PRIVY_APP_SECRET,
    verificationKey: values.PRIVY_VERIFICATION_KEY,
    authorizationPrivateKey: values.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    spendChain: "base" as const,
    spendAsset: "usdc" as const,
  })).parse(env);
}

export function assertPrivyEnv(config: PrivyEnv): RequiredPrivyEnv {
  if (!config.appId) {
    throw new MissingConnectorConfigError("Privy", "PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID");
  }
  if (!config.appSecret) {
    throw new MissingConnectorConfigError("Privy", "PRIVY_APP_SECRET");
  }
  return config as RequiredPrivyEnv;
}

export type HyperliquidExecutionEnvOptions = {
  privateKey?: string;
  slippageBps?: number;
  priceDecimals?: number;
};

export type HyperliquidExecutionEnv = {
  privateKey?: `0x${string}`;
  slippageBps: number;
  priceDecimals: number;
};

export type RequiredHyperliquidExecutionEnv = HyperliquidExecutionEnv & {
  privateKey: `0x${string}`;
};

export function readHyperliquidExecutionEnv(
  env: EnvSource = process.env,
  options: HyperliquidExecutionEnvOptions = {},
): HyperliquidExecutionEnv {
  const schema = z.object({
    HYPERLIQUID_PRIVATE_KEY: configuredStringSchema,
    HYPERLIQUID_EXECUTION_SLIPPAGE_BPS: numberSchema("HYPERLIQUID_EXECUTION_SLIPPAGE_BPS", 100, { min: 0 }),
    HYPERLIQUID_PRICE_DECIMALS: numberSchema("HYPERLIQUID_PRICE_DECIMALS", 5, { integer: true, min: 0 }),
  }).transform((values) => {
    const privateKey = firstConfigured(options.privateKey, values.HYPERLIQUID_PRIVATE_KEY);

    return {
      privateKey: privateKey ? normalizePrivateKey(privateKey, "HYPERLIQUID_PRIVATE_KEY") : undefined,
      slippageBps: options.slippageBps ?? values.HYPERLIQUID_EXECUTION_SLIPPAGE_BPS,
      priceDecimals: options.priceDecimals ?? values.HYPERLIQUID_PRICE_DECIMALS,
    };
  });

  return schema.parse(env);
}

export function assertHyperliquidExecutionEnv(
  config: HyperliquidExecutionEnv,
): RequiredHyperliquidExecutionEnv {
  if (!config.privateKey) {
    throw new MissingConnectorConfigError("Hyperliquid execution", "HYPERLIQUID_PRIVATE_KEY");
  }
  return config as RequiredHyperliquidExecutionEnv;
}

export type PolymarketExecutionEnv = {
  privateKey?: `0x${string}`;
  creds?: ApiKeyCreds;
  host: string;
  rpcUrl: string;
  signatureType?: SignatureType;
  funderAddress?: string;
  builderCode?: string;
  relayerApiKey?: string;
  relayerApiKeyAddress?: string;
};

export type RequiredPolymarketExecutionEnv = PolymarketExecutionEnv & {
  privateKey: `0x${string}`;
  creds: ApiKeyCreds;
};

export function readPolymarketExecutionEnv(
  env: EnvSource = process.env,
  options: PolymarketExecutionEnvOptions = {},
): PolymarketExecutionEnv {
  const schema = z.object({
    POLYMARKET_PRIVATE_KEY: configuredStringSchema,
    POLYMARKET_CLOB_API_KEY: configuredStringSchema,
    POLYMARKET_CLOB_SECRET: configuredStringSchema,
    POLYMARKET_CLOB_PASS_PHRASE: configuredStringSchema,
    POLYMARKET_CLOB_HOST: configuredStringSchema,
    POLYMARKET_RPC_URL: configuredStringSchema,
    POLYMARKET_SIGNATURE_TYPE: configuredStringSchema,
    POLYMARKET_FUNDER_ADDRESS: configuredStringSchema,
    POLYMARKET_BUILDER_CODE: configuredStringSchema,
    POLYMARKET_RELAYER_API_KEY: configuredStringSchema,
    POLYMARKET_RELAYER_API_KEY_ADDRESS: configuredStringSchema,
  }).transform((values) => {
    const privateKey = firstConfigured(options.privateKey, values.POLYMARKET_PRIVATE_KEY);
    const apiKey = firstConfigured(options.apiKey, values.POLYMARKET_CLOB_API_KEY);
    const apiSecret = firstConfigured(options.apiSecret, values.POLYMARKET_CLOB_SECRET);
    const apiPassphrase = firstConfigured(options.apiPassphrase, values.POLYMARKET_CLOB_PASS_PHRASE);

    return {
      privateKey: privateKey ? normalizePrivateKey(privateKey) : undefined,
      creds: apiKey && apiSecret && apiPassphrase
        ? { key: apiKey as ApiKeyCreds["key"], secret: apiSecret, passphrase: apiPassphrase }
        : undefined,
      host: firstConfigured(options.host, values.POLYMARKET_CLOB_HOST) ?? "https://clob.polymarket.com",
      rpcUrl: firstConfigured(options.rpcUrl, values.POLYMARKET_RPC_URL) ?? "https://polygon-rpc.com",
      signatureType: options.signatureType ?? parsePolymarketSignatureType(values.POLYMARKET_SIGNATURE_TYPE),
      funderAddress: firstConfigured(options.funderAddress, values.POLYMARKET_FUNDER_ADDRESS),
      builderCode: firstConfigured(options.builderCode, values.POLYMARKET_BUILDER_CODE),
      relayerApiKey: firstConfigured(options.relayerApiKey, values.POLYMARKET_RELAYER_API_KEY),
      relayerApiKeyAddress: firstConfigured(options.relayerApiKeyAddress, values.POLYMARKET_RELAYER_API_KEY_ADDRESS),
    };
  });

  return schema.parse(env);
}

export function assertPolymarketExecutionEnv(
  config: PolymarketExecutionEnv,
): RequiredPolymarketExecutionEnv {
  if (!config.privateKey) {
    throw new MissingConnectorConfigError("Polymarket execution", "POLYMARKET_PRIVATE_KEY");
  }
  if (!config.creds) {
    throw new MissingConnectorConfigError("Polymarket execution", "POLYMARKET_CLOB_API_KEY, POLYMARKET_CLOB_SECRET, POLYMARKET_CLOB_PASS_PHRASE");
  }

  return config as RequiredPolymarketExecutionEnv;
}

export function normalizePrivateKey(privateKey: string, variable = "POLYMARKET_PRIVATE_KEY"): `0x${string}` {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const parsed = privateKeySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`${variable} must be a 32-byte hex private key.`);
  }
  return parsed.data;
}

export function parsePolymarketSignatureType(value: string | undefined): SignatureType | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) {
    return parsed as SignatureType;
  }
  throw new Error("POLYMARKET_SIGNATURE_TYPE must be 0, 1, 2, or 3.");
}

function aiProviderEnvDefaults(overrides: Partial<AiProviderEnvDefaults> = {}): AiProviderEnvDefaults {
  return {
    cheapModel: overrides.cheapModel ?? "deepseek-v4-flash",
    importantModel: overrides.importantModel ?? "gpt-5.4-mini",
    webSearchModel: overrides.webSearchModel ?? "gemini-3.1-flash-lite",
    grokXSearchModel: "grok-4.3",
    ...overrides,
  };
}

function numberSchema(name: string, defaultValue: number, options: NumberEnvOptions = {}): z.ZodType<number> {
  return z.preprocess((value) => {
    return parseConfiguredNumber(name, value, defaultValue, options);
  }, z.number());
}

function parseNumberEnv(
  name: string,
  env: EnvSource,
  defaultValue: number,
  options: NumberEnvOptions,
): number {
  return numberSchema(name, defaultValue, options).parse(env[name]);
}

function parseConfiguredNumber(
  name: string,
  value: unknown,
  defaultValue: number,
  options: NumberEnvOptions,
): number {
  const configured = configuredStringSchema.parse(value);
  if (configured == null) return defaultValue;

  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.min != null && normalized < options.min) {
    throw new Error(`${name} must be at least ${options.min}.`);
  }
  return normalized;
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim() !== "");
}
