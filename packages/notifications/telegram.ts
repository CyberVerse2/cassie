import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  assertTelegramBotEnv,
  assertTelegramConnectEnv,
  readTelegramEnv,
  type TelegramEnv,
} from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import type { TelegramConnection, UserSettings } from "../core/schemas/index.ts";

const CONNECT_SESSION_PREFIX = "telegram.connect.";

const TelegramConnectSessionSchema = z.object({
  userId: z.string().min(1),
  privyUserId: z.string().min(1).optional(),
  expiresAt: z.string(),
  usedAt: z.string().optional(),
});

const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  date: z.number(),
  chat: z.object({
    id: z.number(),
    type: z.string(),
  }),
  from: TelegramUserSchema.optional(),
  text: z.string().optional(),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
});

export type TelegramGateway = {
  sendMessage(input: {
    chatId: string;
    text: string;
    disableNotification?: boolean;
  }): Promise<void>;
};

export type TelegramConnectSession = {
  connectUrl: string;
  expiresAt: string;
};

export type TelegramConnectResult =
  | { status: "connected"; connection: TelegramConnection }
  | { status: "ignored" };

export class TelegramBotApi implements TelegramGateway {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async sendMessage(input: {
    chatId: string;
    text: string;
    disableNotification?: boolean;
  }): Promise<void> {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        disable_notification: input.disableNotification ?? false,
      }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.description ?? `Telegram sendMessage failed with HTTP ${response.status}.`);
    }
  }

}

export async function createTelegramConnectSession(input: {
  userId: string;
  store: CassieStore;
  env?: TelegramEnv;
}): Promise<TelegramConnectSession> {
  const env = assertTelegramConnectEnv(input.env ?? readTelegramEnv());
  const settings = await input.store.getUserSettings(input.userId);
  if (!settings) {
    throw new Error("Create a Cassie account before connecting Telegram.");
  }

  const token = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + env.connectTtlMs).toISOString();
  await input.store.setRuntimeState(connectSessionKey(token), {
    userId: settings.userId,
    expiresAt,
  });

  return {
    connectUrl: `https://t.me/${env.botUsername}?start=${token}`,
    expiresAt,
  };
}

export async function connectTelegramFromUpdate(input: {
  update: unknown;
  store: CassieStore;
  gateway?: TelegramGateway;
}): Promise<TelegramConnectResult> {
  const update = TelegramUpdateSchema.parse(input.update);
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") {
    return { status: "ignored" };
  }

  const token = startToken(message.text);
  if (!token) {
    await input.gateway?.sendMessage({
      chatId: String(message.chat.id),
      text: "Open Telegram from Cassie onboarding to connect notifications.",
    });
    return { status: "ignored" };
  }

  const sessionPayload = await input.store.getRuntimeState(connectSessionKey(token));
  const parsedSession = TelegramConnectSessionSchema.safeParse(sessionPayload);
  if (!parsedSession.success) {
    await input.gateway?.sendMessage({
      chatId: String(message.chat.id),
      text: "Telegram connection link was not found. Create a fresh link from Cassie onboarding.",
    });
    return { status: "ignored" };
  }
  const session = parsedSession.data;
  if (session.usedAt) {
    await input.gateway?.sendMessage({
      chatId: String(message.chat.id),
      text: "Telegram connection link has already been used. Create a fresh link from Cassie onboarding.",
    });
    return { status: "ignored" };
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await input.gateway?.sendMessage({
      chatId: String(message.chat.id),
      text: "Telegram connection link has expired. Create a fresh link from Cassie onboarding.",
    });
    return { status: "ignored" };
  }

  const settings = await input.store.getUserSettings(session.userId);
  if (!settings) {
    await input.gateway?.sendMessage({
      chatId: String(message.chat.id),
      text: "Telegram connection session no longer matches a Cassie account. Create a fresh link from Cassie onboarding.",
    });
    return { status: "ignored" };
  }

  const now = new Date().toISOString();
  const connection: TelegramConnection = {
    chatId: String(message.chat.id),
    username: message.from?.username ?? null,
    firstName: message.from?.first_name ?? null,
    lastName: message.from?.last_name ?? null,
    connectedAt: settings.telegram?.connectedAt ?? now,
    lastMessageAt: now,
  };

  await input.store.upsertUserSettings({
    ...settings,
    telegram: connection,
  });
  await input.store.setRuntimeState(connectSessionKey(token), {
    ...session,
    usedAt: now,
  });
  await input.gateway?.sendMessage({
    chatId: connection.chatId,
    text: "Telegram is connected. Cassie will send trade fills, watch moves, and counter triggers here.",
  });

  return { status: "connected", connection };
}

export async function sendTelegramNotification(input: {
  settings: UserSettings;
  text: string;
  disableNotification?: boolean;
  env?: TelegramEnv;
  gateway?: TelegramGateway;
}): Promise<void> {
  if (!input.settings.telegram) {
    throw new Error("User has not connected Telegram notifications.");
  }
  const gateway = input.gateway ?? new TelegramBotApi(assertTelegramBotEnv(input.env ?? readTelegramEnv()).botToken);
  await gateway.sendMessage({
    chatId: input.settings.telegram.chatId,
    text: input.text,
    disableNotification: input.disableNotification,
  });
}

export async function processTelegramWebhookUpdate(input: {
  store: CassieStore;
  update: unknown;
  gateway?: TelegramGateway;
}): Promise<{
  connected: number;
  ignored: number;
  updateId: number;
}> {
  const parsed = TelegramUpdateSchema.safeParse(input.update);
  if (!parsed.success) {
    throw new Error("Telegram webhook update payload did not match the expected message schema.");
  }
  const result = await connectTelegramFromUpdate({
    update: parsed.data,
    store: input.store,
    gateway: input.gateway,
  });

  return {
    connected: result.status === "connected" ? 1 : 0,
    ignored: result.status === "ignored" ? 1 : 0,
    updateId: parsed.data.update_id,
  };
}

export function verifyTelegramWebhookSecret(input: {
  receivedSecret: string | null;
  expectedSecret?: string;
}): void {
  if (!input.expectedSecret) {
    throw new Error("Telegram webhook requires TELEGRAM_WEBHOOK_SECRET_TOKEN.");
  }
  if (input.receivedSecret !== input.expectedSecret) {
    throw new Error("Telegram webhook secret token did not match.");
  }
}

function connectSessionKey(token: string): string {
  return `${CONNECT_SESSION_PREFIX}${token}`;
}

function startToken(text: string): string | null {
  const match = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(text.trim());
  return match?.[1] ?? null;
}
