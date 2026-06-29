import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(appDir, "../..");

dotenv.config({ path: path.join(workspaceDir, ".env") });

function configured(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/playwright-core/browsers.json",
      "../../node_modules/playwright-core/lib/**",
      "../../node_modules/playwright/lib/**",
    ],
  },
  env: {
    NEXT_PUBLIC_PRIVY_APP_ID: configured(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    NEXT_PUBLIC_PRIVY_SIGNER_ID: configured(process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID)
      ?? configured(process.env.PRIVY_AUTHORIZATION_KEY_ID),
    NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS: configured(process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS),
  },
  turbopack: {
    root: workspaceDir,
  },
};

export default nextConfig;
