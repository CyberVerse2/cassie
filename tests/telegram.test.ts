import { describe, expect, it, vi } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import {
  connectTelegramFromUpdate,
  createTelegramConnectSession,
  processTelegramWebhookUpdate,
  sendTelegramNotification,
  TelegramBotApi,
  verifyTelegramWebhookSecret,
  type TelegramGateway,
} from "../packages/notifications/telegram.ts";

describe("Telegram notifications", () => {
  it("creates a one-time onboarding link and connects the private Telegram chat", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
    });
    const gateway = new FakeTelegramGateway();

    const session = await createTelegramConnectSession({
      privyUserId: "did:privy:user_1",
      store,
      env: {
        botToken: "bot-token",
        botUsername: "cassie_bot",
        connectTtlMs: 60_000,
      },
    });
    const token = new URL(session.connectUrl).searchParams.get("start");

    const result = await connectTelegramFromUpdate({
      store,
      gateway,
      update: {
        update_id: 1,
        message: {
          message_id: 10,
          date: 1_779_932_400,
          chat: { id: 12345, type: "private" },
          from: {
            id: 12345,
            first_name: "Celestine",
            username: "celestine",
          },
          text: `/start ${token}`,
        },
      },
    });

    expect(result).toMatchObject({
      status: "connected",
      connection: {
        chatId: "12345",
        username: "celestine",
      },
    });
    const reused = await connectTelegramFromUpdate({
      store,
      gateway,
      update: {
        update_id: 2,
        message: {
          message_id: 11,
          date: 1_779_932_401,
          chat: { id: 12345, type: "private" },
          text: `/start ${token}`,
        },
      },
    });

    expect(reused).toEqual({ status: "ignored" });
    expect(gateway.messages[1]).toMatchObject({
      chatId: "12345",
      text: expect.stringContaining("already been used"),
    });
    expect(gateway.messages[0]).toMatchObject({
      chatId: "12345",
      text: expect.stringContaining("Telegram is connected"),
    });
    expect((await store.getUserSettingsByPrivyUserId("did:privy:user_1"))?.telegram).toMatchObject({
      chatId: "12345",
      username: "celestine",
    });
  });

  it("replies when a Telegram start token cannot be used", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
    });
    const gateway = new FakeTelegramGateway();

    const missing = await connectTelegramFromUpdate({
      store,
      gateway,
      update: {
        update_id: 10,
        message: {
          message_id: 20,
          date: 1_779_932_401,
          chat: { id: 12345, type: "private" },
          text: "/start missing-token",
        },
      },
    });

    expect(missing).toEqual({ status: "ignored" });
    expect(gateway.messages[0]).toMatchObject({
      chatId: "12345",
      text: expect.stringContaining("not found"),
    });

    await store.setRuntimeState("telegram.connect.expired-token", {
      userId: "did:privy:user_1",
      privyUserId: "did:privy:user_1",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const expired = await connectTelegramFromUpdate({
      store,
      gateway,
      update: {
        update_id: 11,
        message: {
          message_id: 21,
          date: 1_779_932_402,
          chat: { id: 12345, type: "private" },
          text: "/start expired-token",
        },
      },
    });

    expect(expired).toEqual({ status: "ignored" });
    expect(gateway.messages[1]).toMatchObject({
      chatId: "12345",
      text: expect.stringContaining("expired"),
    });
  });

  it("sends notifications to the connected chat through Telegram sendMessage", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const gateway = new TelegramBotApi("bot-token", fetcher as typeof fetch);

    await sendTelegramNotification({
      settings: {
        userId: "user_1",
        privyUserId: "did:privy:user_1",
        privyWalletId: null,
        walletAddress: null,
        profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
        defaultTradeSizeUsd: 50,
        telegram: {
          chatId: "12345",
          username: "celestine",
          firstName: "Celestine",
          lastName: null,
          connectedAt: "2026-05-28T00:00:00.000Z",
          lastMessageAt: "2026-05-28T00:00:00.000Z",
        },
      },
      text: "Trade filled.",
      gateway,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "12345",
          text: "Trade filled.",
          disable_notification: false,
        }),
      }),
    );
  });

  it("processes a Telegram webhook update", async () => {
    const store = new InMemoryCassieStore();
    await store.syncPrivyUser({
      privyUserId: "did:privy:user_1",
      privyWalletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { name: "Cassie", handle: "@cassie", avatarUrl: null },
    });
    const session = await createTelegramConnectSession({
      privyUserId: "did:privy:user_1",
      store,
      env: {
        botToken: "bot-token",
        botUsername: "cassie_bot",
        connectTtlMs: 60_000,
      },
    });
    const token = new URL(session.connectUrl).searchParams.get("start");
    const gateway = new FakeTelegramGateway();

    const result = await processTelegramWebhookUpdate({
      store,
      gateway,
      update: {
        update_id: 42,
        message: {
          message_id: 1,
          date: 1_779_932_400,
          chat: { id: 12345, type: "private" },
          from: {
            id: 12345,
            first_name: "Celestine",
            username: "celestine",
          },
          text: `/start ${token}`,
        },
      },
    });

    expect(result).toMatchObject({
      connected: 1,
      ignored: 0,
      updateId: 42,
    });
    expect(gateway.messages[0]).toMatchObject({
      chatId: "12345",
      text: expect.stringContaining("Telegram is connected"),
    });
  });

  it("requires Telegram webhook secret token verification", () => {
    expect(() => verifyTelegramWebhookSecret({
      receivedSecret: "wrong",
      expectedSecret: "expected",
    })).toThrow("Telegram webhook secret token did not match.");
    expect(() => verifyTelegramWebhookSecret({
      receivedSecret: "expected",
      expectedSecret: "expected",
    })).not.toThrow();
  });
});

class FakeTelegramGateway implements TelegramGateway {
  messages: Array<{ chatId: string; text: string; disableNotification?: boolean }> = [];

  async sendMessage(input: {
    chatId: string;
    text: string;
    disableNotification?: boolean;
  }): Promise<void> {
    this.messages.push(input);
  }
}
