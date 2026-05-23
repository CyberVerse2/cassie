import { SignatureTypeV2, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { MissingConnectorConfigError } from "./connector-errors.ts";

export type EnvSource = Record<string, string | undefined>;

export type NumberEnvOptions = {
  integer?: boolean;
  min?: number;
};

export function currentEnv(): EnvSource {
  return process.env;
}

export function optionalEnv(name: string, env: EnvSource = process.env): string | undefined {
  return firstConfigured(env[name]);
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
  const value = Number(optionalEnv(name, env) ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  const normalized = options.integer ? Math.floor(value) : value;
  if (options.min != null && normalized < options.min) return fallback;
  return normalized;
}

export function googleApiKey(env: EnvSource = process.env): string | undefined {
  return firstConfigured(env.GEMINI_API_KEY, env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function deepSeekApiKey(env: EnvSource = process.env): string | undefined {
  return optionalEnv("DEEPSEEK_API_KEY", env);
}

export function xAiApiKey(env: EnvSource = process.env): string | undefined {
  return optionalEnv("XAI_API_KEY", env);
}

export function cassieCheapModel(fallback: string, env: EnvSource = process.env): string {
  return firstConfigured(env.CASSIE_CHEAP_MODEL, env.DEEPSEEK_MODEL) ?? fallback;
}

export function cassieImportantModel(fallback: string, env: EnvSource = process.env): string {
  return firstConfigured(env.CASSIE_IMPORTANT_MODEL, env.CASSIE_EXPENSIVE_MODEL, env.CASSIE_MODEL) ?? fallback;
}

export function cassieWebSearchModel(fallback: string, env: EnvSource = process.env): string {
  return firstConfigured(env.CASSIE_WEB_SEARCH_MODEL, env.GEMINI_WEB_SEARCH_MODEL) ?? fallback;
}

export function grokXSearchModel(env: EnvSource = process.env, fallback = "grok-4.3"): string {
  return optionalEnv("GROK_X_SEARCH_MODEL", env) ?? fallback;
}

export function databaseUrl(env: EnvSource = process.env): string | undefined {
  return optionalEnv("DATABASE_URL", env);
}

export function executionWebhookUrl(env: EnvSource = process.env): string | undefined {
  return optionalEnv("EXECUTION_WEBHOOK_URL", env);
}

export function graphileExecutionMaxAttempts(env: EnvSource = process.env): number {
  return numberEnv("GRAPHILE_EXECUTION_MAX_ATTEMPTS", 5, env, { integer: true, min: 1 });
}

export function graphileSupervisorMaxAttempts(env: EnvSource = process.env): number {
  return numberEnv("GRAPHILE_SUPERVISOR_MAX_ATTEMPTS", 3, env, { integer: true, min: 1 });
}

export function graphileWorkerConcurrency(env: EnvSource = process.env): number {
  return numberEnv("GRAPHILE_WORKER_CONCURRENCY", 1, env, { integer: true, min: 1 });
}

export function graphileWorkerPollIntervalMs(env: EnvSource = process.env): number {
  return numberEnv("GRAPHILE_WORKER_POLL_INTERVAL_MS", 2_000, env, { integer: true, min: 1 });
}

export function cassieApiToken(env: EnvSource = process.env): string | undefined {
  return optionalEnv("CASSIE_API_TOKEN", env);
}

export function cassieRateLimitMax(env: EnvSource = process.env): number {
  return numberEnv("CASSIE_RATE_LIMIT_MAX", 60, env, { integer: true, min: 1 });
}

export function cassieRateLimitWindowMs(env: EnvSource = process.env): number {
  return numberEnv("CASSIE_RATE_LIMIT_WINDOW_MS", 60_000, env, { integer: true, min: 1 });
}

export function serverPort(env: EnvSource = process.env): number {
  return numberEnv("PORT", 3000, env, { integer: true, min: 1 });
}

export function cassieMaxBodyBytes(env: EnvSource = process.env): number {
  return numberEnv("CASSIE_MAX_BODY_BYTES", 256_000, env, { integer: true, min: 1 });
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

export function xPollingEnv(env: EnvSource = process.env): {
  bearerToken?: string;
  cassieHandle?: string;
  maxResults: number;
} {
  return {
    bearerToken: optionalEnv("X_BEARER_TOKEN", env),
    cassieHandle: optionalEnv("CASSIE_X_HANDLE", env),
    maxResults: numberEnv("X_POLL_MAX_RESULTS", 25, env, { integer: true, min: 10 }),
  };
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
  const privateKey = firstConfigured(options.privateKey, env.HYPERLIQUID_PRIVATE_KEY);

  return {
    privateKey: privateKey ? normalizePrivateKey(privateKey, "HYPERLIQUID_PRIVATE_KEY") : undefined,
    slippageBps: options.slippageBps ?? numberEnv("HYPERLIQUID_EXECUTION_SLIPPAGE_BPS", 100, env, { min: 0 }),
    priceDecimals: options.priceDecimals ?? numberEnv("HYPERLIQUID_PRICE_DECIMALS", 5, env, { integer: true, min: 0 }),
  };
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
  const privateKey = firstConfigured(options.privateKey, env.POLYMARKET_PRIVATE_KEY);
  const apiKey = firstConfigured(options.apiKey, env.POLYMARKET_CLOB_API_KEY);
  const apiSecret = firstConfigured(options.apiSecret, env.POLYMARKET_CLOB_SECRET);
  const apiPassphrase = firstConfigured(options.apiPassphrase, env.POLYMARKET_CLOB_PASS_PHRASE);

  return {
    privateKey: privateKey ? normalizePrivateKey(privateKey) : undefined,
    creds: apiKey && apiSecret && apiPassphrase
      ? { key: apiKey, secret: apiSecret, passphrase: apiPassphrase }
      : undefined,
    host: firstConfigured(options.host, env.POLYMARKET_CLOB_HOST) ?? "https://clob.polymarket.com",
    rpcUrl: firstConfigured(options.rpcUrl, env.POLYMARKET_RPC_URL) ?? "https://polygon-rpc.com",
    signatureType: options.signatureType ?? parsePolymarketSignatureType(env.POLYMARKET_SIGNATURE_TYPE),
    funderAddress: firstConfigured(options.funderAddress, env.POLYMARKET_FUNDER_ADDRESS),
    builderCode: firstConfigured(options.builderCode, env.POLYMARKET_BUILDER_CODE),
  };
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
  return firstConfigured(env.POLYMARKET_GAMMA_MARKETS_URL) ?? "https://gamma-api.polymarket.com/markets";
}

export function normalizePrivateKey(privateKey: string, variable = "POLYMARKET_PRIVATE_KEY"): `0x${string}` {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${variable} must be a 32-byte hex private key.`);
  }
  return normalized as `0x${string}`;
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

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim() !== "");
}
