import { SignatureTypeV2, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { z } from "zod";
import { MissingConnectorConfigError } from "./connector-errors.ts";

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
  apiToken?: string;
  maxBodyBytes: number;
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
};

export type XPollingEnv = {
  bearerToken?: string;
  cassieHandle?: string;
  maxResults: number;
};

const configuredStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().optional());

const privateKeySchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
);

const aiProviderEnvSchema = z.object({
  GEMINI_API_KEY: configuredStringSchema,
  GOOGLE_GENERATIVE_AI_API_KEY: configuredStringSchema,
  DEEPSEEK_API_KEY: configuredStringSchema,
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

export function currentEnv(): EnvSource {
  return process.env;
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
  fallback: number,
  env: EnvSource = process.env,
  options: NumberEnvOptions = {},
): number {
  return parseNumberEnv(env[name], fallback, options);
}

export function readAiProviderEnv(
  env: EnvSource = process.env,
  defaults: AiProviderEnvDefaults,
): AiProviderEnv {
  return aiProviderEnvSchema.transform((values) => ({
    googleApiKey: firstConfigured(values.GEMINI_API_KEY, values.GOOGLE_GENERATIVE_AI_API_KEY),
    deepSeekApiKey: values.DEEPSEEK_API_KEY,
    xAiApiKey: values.XAI_API_KEY,
    cheapModel: firstConfigured(values.CASSIE_CHEAP_MODEL, values.DEEPSEEK_MODEL) ?? defaults.cheapModel,
    importantModel: firstConfigured(values.CASSIE_IMPORTANT_MODEL, values.CASSIE_EXPENSIVE_MODEL, values.CASSIE_MODEL)
      ?? defaults.importantModel,
    webSearchModel: firstConfigured(values.CASSIE_WEB_SEARCH_MODEL, values.GEMINI_WEB_SEARCH_MODEL)
      ?? defaults.webSearchModel,
    grokXSearchModel: values.GROK_X_SEARCH_MODEL ?? defaults.grokXSearchModel ?? "grok-4.3",
  })).parse(env);
}

export function googleApiKey(env: EnvSource = process.env): string | undefined {
  return readAiProviderEnv(env, aiProviderEnvDefaults()).googleApiKey;
}

export function deepSeekApiKey(env: EnvSource = process.env): string | undefined {
  return readAiProviderEnv(env, aiProviderEnvDefaults()).deepSeekApiKey;
}

export function xAiApiKey(env: EnvSource = process.env): string | undefined {
  return readAiProviderEnv(env, aiProviderEnvDefaults()).xAiApiKey;
}

export function cassieCheapModel(fallback: string, env: EnvSource = process.env): string {
  return readAiProviderEnv(env, aiProviderEnvDefaults({ cheapModel: fallback })).cheapModel;
}

export function cassieImportantModel(fallback: string, env: EnvSource = process.env): string {
  return readAiProviderEnv(env, aiProviderEnvDefaults({ importantModel: fallback })).importantModel;
}

export function cassieWebSearchModel(fallback: string, env: EnvSource = process.env): string {
  return readAiProviderEnv(env, aiProviderEnvDefaults({ webSearchModel: fallback })).webSearchModel;
}

export function grokXSearchModel(env: EnvSource = process.env, fallback = "grok-4.3"): string {
  return readAiProviderEnv(env, aiProviderEnvDefaults({ grokXSearchModel: fallback })).grokXSearchModel;
}

export function databaseUrl(env: EnvSource = process.env): string | undefined {
  return optionalEnv("DATABASE_URL", env);
}

export function executionWebhookUrl(env: EnvSource = process.env): string | undefined {
  return optionalEnv("EXECUTION_WEBHOOK_URL", env);
}

export function readGraphileWorkerEnv(env: EnvSource = process.env): GraphileWorkerEnv {
  return z.object({
    GRAPHILE_EXECUTION_MAX_ATTEMPTS: numberSchema(5, { integer: true, min: 1 }),
    GRAPHILE_SUPERVISOR_MAX_ATTEMPTS: numberSchema(3, { integer: true, min: 1 }),
    GRAPHILE_WORKER_CONCURRENCY: numberSchema(1, { integer: true, min: 1 }),
    GRAPHILE_WORKER_POLL_INTERVAL_MS: numberSchema(2_000, { integer: true, min: 1 }),
  }).transform((values) => ({
    executionMaxAttempts: values.GRAPHILE_EXECUTION_MAX_ATTEMPTS,
    supervisorMaxAttempts: values.GRAPHILE_SUPERVISOR_MAX_ATTEMPTS,
    concurrency: values.GRAPHILE_WORKER_CONCURRENCY,
    pollIntervalMs: values.GRAPHILE_WORKER_POLL_INTERVAL_MS,
  })).parse(env);
}

export function graphileExecutionMaxAttempts(env: EnvSource = process.env): number {
  return readGraphileWorkerEnv(env).executionMaxAttempts;
}

export function graphileSupervisorMaxAttempts(env: EnvSource = process.env): number {
  return readGraphileWorkerEnv(env).supervisorMaxAttempts;
}

export function graphileWorkerConcurrency(env: EnvSource = process.env): number {
  return readGraphileWorkerEnv(env).concurrency;
}

export function graphileWorkerPollIntervalMs(env: EnvSource = process.env): number {
  return readGraphileWorkerEnv(env).pollIntervalMs;
}

export function readHttpRuntimeEnv(env: EnvSource = process.env): HttpRuntimeEnv {
  return z.object({
    CASSIE_API_TOKEN: configuredStringSchema,
    CASSIE_MAX_BODY_BYTES: numberSchema(256_000, { integer: true, min: 1 }),
    PORT: numberSchema(3000, { integer: true, min: 1 }),
    CASSIE_RATE_LIMIT_MAX: numberSchema(60, { integer: true, min: 1 }),
    CASSIE_RATE_LIMIT_WINDOW_MS: numberSchema(60_000, { integer: true, min: 1 }),
  }).transform((values) => ({
    apiToken: values.CASSIE_API_TOKEN,
    maxBodyBytes: values.CASSIE_MAX_BODY_BYTES,
    port: values.PORT,
    rateLimitMax: values.CASSIE_RATE_LIMIT_MAX,
    rateLimitWindowMs: values.CASSIE_RATE_LIMIT_WINDOW_MS,
  })).parse(env);
}

export function cassieApiToken(env: EnvSource = process.env): string | undefined {
  return readHttpRuntimeEnv(env).apiToken;
}

export function cassieRateLimitMax(env: EnvSource = process.env): number {
  return readHttpRuntimeEnv(env).rateLimitMax;
}

export function cassieRateLimitWindowMs(env: EnvSource = process.env): number {
  return readHttpRuntimeEnv(env).rateLimitWindowMs;
}

export function serverPort(env: EnvSource = process.env): number {
  return readHttpRuntimeEnv(env).port;
}

export function cassieMaxBodyBytes(env: EnvSource = process.env): number {
  return readHttpRuntimeEnv(env).maxBodyBytes;
}

export function debugEnabled(env: EnvSource = process.env): boolean {
  return optionalEnv("DEBUG", env) != null;
}

export function noColor(env: EnvSource = process.env): boolean {
  return optionalEnv("NO_COLOR", env) != null;
}

export function xPollingUserId(env: EnvSource = process.env): string | undefined {
  return optionalEnv("X_POLL_USER_ID", env);
}

export function xPollingIntervalMs(env: EnvSource = process.env): number {
  return numberEnv("X_POLL_INTERVAL_MS", 120_000, env, { integer: true, min: 1 });
}

export function xPollingEnv(env: EnvSource = process.env): XPollingEnv {
  return z.object({
    X_BEARER_TOKEN: configuredStringSchema,
    CASSIE_X_HANDLE: configuredStringSchema,
    X_POLL_MAX_RESULTS: numberSchema(25, { integer: true, min: 10 }),
  }).transform((values) => ({
    bearerToken: values.X_BEARER_TOKEN,
    cassieHandle: values.CASSIE_X_HANDLE,
    maxResults: values.X_POLL_MAX_RESULTS,
  })).parse(env);
}

export function xConsumerSecret(env: EnvSource = process.env): string | undefined {
  return optionalEnv("X_CONSUMER_SECRET", env);
}

export type PolymarketExecutionEnvOptions = {
  privateKey?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  host?: string;
  rpcUrl?: string;
  signatureType?: SignatureTypeV2;
  funderAddress?: string;
  builderCode?: string;
};

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
    HYPERLIQUID_EXECUTION_SLIPPAGE_BPS: numberSchema(100, { min: 0 }),
    HYPERLIQUID_PRICE_DECIMALS: numberSchema(5, { integer: true, min: 0 }),
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
  signatureType?: SignatureTypeV2;
  funderAddress?: string;
  builderCode?: string;
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
  }).transform((values) => {
    const privateKey = firstConfigured(options.privateKey, values.POLYMARKET_PRIVATE_KEY);
    const apiKey = firstConfigured(options.apiKey, values.POLYMARKET_CLOB_API_KEY);
    const apiSecret = firstConfigured(options.apiSecret, values.POLYMARKET_CLOB_SECRET);
    const apiPassphrase = firstConfigured(options.apiPassphrase, values.POLYMARKET_CLOB_PASS_PHRASE);

    return {
      privateKey: privateKey ? normalizePrivateKey(privateKey) : undefined,
      creds: apiKey && apiSecret && apiPassphrase
        ? { key: apiKey, secret: apiSecret, passphrase: apiPassphrase }
        : undefined,
      host: firstConfigured(options.host, values.POLYMARKET_CLOB_HOST) ?? "https://clob.polymarket.com",
      rpcUrl: firstConfigured(options.rpcUrl, values.POLYMARKET_RPC_URL) ?? "https://polygon-rpc.com",
      signatureType: options.signatureType ?? parsePolymarketSignatureType(values.POLYMARKET_SIGNATURE_TYPE),
      funderAddress: firstConfigured(options.funderAddress, values.POLYMARKET_FUNDER_ADDRESS),
      builderCode: firstConfigured(options.builderCode, values.POLYMARKET_BUILDER_CODE),
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

export function polymarketGammaMarketsUrl(env: EnvSource = process.env): string {
  return optionalEnv("POLYMARKET_GAMMA_MARKETS_URL", env) ?? "https://gamma-api.polymarket.com/markets";
}

export function normalizePrivateKey(privateKey: string, variable = "POLYMARKET_PRIVATE_KEY"): `0x${string}` {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const parsed = privateKeySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`${variable} must be a 32-byte hex private key.`);
  }
  return parsed.data;
}

export function parsePolymarketSignatureType(value: string | undefined): SignatureTypeV2 | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (
    parsed === SignatureTypeV2.EOA ||
    parsed === SignatureTypeV2.POLY_PROXY ||
    parsed === SignatureTypeV2.POLY_GNOSIS_SAFE ||
    parsed === SignatureTypeV2.POLY_1271
  ) {
    return parsed;
  }
  throw new Error("POLYMARKET_SIGNATURE_TYPE must be 0, 1, 2, or 3.");
}

function aiProviderEnvDefaults(overrides: Partial<AiProviderEnvDefaults> = {}): AiProviderEnvDefaults {
  return {
    cheapModel: overrides.cheapModel ?? "deepseek-v4-flash",
    importantModel: overrides.importantModel ?? "gemini-3.5-flash",
    webSearchModel: overrides.webSearchModel ?? "gemini-3.5-flash",
    grokXSearchModel: "grok-4.3",
    ...overrides,
  };
}

function numberSchema(fallback: number, options: NumberEnvOptions = {}): z.ZodType<number> {
  return z.preprocess((value) => {
    const configured = configuredStringSchema.parse(value);
    if (configured == null) return fallback;

    const parsed = Number(configured);
    if (!Number.isFinite(parsed)) return fallback;

    const normalized = options.integer ? Math.floor(parsed) : parsed;
    if (options.min != null && normalized < options.min) return fallback;
    return normalized;
  }, z.number());
}

function parseNumberEnv(
  value: string | undefined,
  fallback: number,
  options: NumberEnvOptions,
): number {
  return numberSchema(fallback, options).parse(value);
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim() !== "");
}
