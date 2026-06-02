import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(appDir, "../..");

dotenv.config({ path: path.join(workspaceDir, ".env") });

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
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    NEXT_PUBLIC_PRIVY_SIGNER_ID: process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ?? process.env.PRIVY_AUTHORIZATION_KEY_ID,
    NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS: process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_IDS,
  },
  turbopack: {
    root: workspaceDir,
  },
};

export default nextConfig;
