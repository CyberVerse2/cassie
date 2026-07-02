import { createPublicKey, createVerify } from "node:crypto";
import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import type { CassieStore } from "../core/db/store.ts";
import { creditIncomingUsdcTransfer, type CreditDepositResult } from "./deposit-watcher.ts";

const publicKeyCache = new Map<string, string>();

export type CircleWebhookResult =
  | { kind: "confirmation" }
  | { kind: "ignored"; reason: string }
  | ({ kind: "transaction" } & CreditDepositResult);

// Verifies Circle's ECDSA signature over the raw notification body. The public
// key is fetched (and cached) from Circle using the X-Circle-Key-Id header.
export async function verifyCircleSignature(input: {
  rawBody: string;
  signature: string | null;
  keyId: string | null;
  circle?: CircleWalletAdapter;
}): Promise<boolean> {
  if (!input.signature || !input.keyId) return false;
  const circle = input.circle ?? new CircleWalletAdapter();
  let publicKeyBase64 = publicKeyCache.get(input.keyId);
  if (!publicKeyBase64) {
    const key = await circle.notificationPublicKey(input.keyId);
    publicKeyBase64 = key.publicKey;
    publicKeyCache.set(input.keyId, publicKeyBase64);
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const verifier = createVerify("SHA256");
    verifier.update(input.rawBody);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(input.signature, "base64"));
  } catch {
    return false;
  }
}

// Processes a verified Circle notification. Subscription confirmations
// (sent when the webhook is registered) are acknowledged; inbound USDC
// transactions are credited via the shared deposit path.
export async function processCircleNotification(input: {
  store: CassieStore;
  payload: unknown;
  circle?: CircleWalletAdapter;
}): Promise<CircleWebhookResult> {
  const payload = input.payload as {
    notificationType?: string;
    notification?: Record<string, unknown>;
  } | null;
  if (!payload || typeof payload !== "object") {
    return { kind: "ignored", reason: "empty payload" };
  }

  const type = payload.notificationType ?? "";
  if (type.includes("subscription") || type === "webhooks.ping") {
    return { kind: "confirmation" };
  }
  if (!type.startsWith("transactions")) {
    return { kind: "ignored", reason: `unhandled type ${type || "unknown"}` };
  }

  const transaction = payload.notification;
  if (!transaction) return { kind: "ignored", reason: "no notification body" };

  const circle = input.circle ?? new CircleWalletAdapter();
  const transfer = await circle.toIncomingUsdcTransfer(transaction);
  if (!transfer) return { kind: "ignored", reason: "not an inbound USDC transfer" };
  // Only credit settled transfers; earlier states arrive as separate events.
  if (transfer.state !== "COMPLETE" && transfer.state !== "CONFIRMED") {
    return { kind: "ignored", reason: `state ${transfer.state}` };
  }

  const credited = await creditIncomingUsdcTransfer({ store: input.store, transfer });
  return { kind: "transaction", ...credited };
}
