import { SignatureTypeV2, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { MissingConnectorConfigError } from "./connector-errors.ts";

export type EnvSource = Record<string, string | undefined>;

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

export function normalizePrivateKey(privateKey: string): `0x${string}` {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("POLYMARKET_PRIVATE_KEY must be a 32-byte hex private key.");
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
