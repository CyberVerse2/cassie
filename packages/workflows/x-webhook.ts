import { createHmac } from "node:crypto";
import { z } from "zod";
import type { SourcePost } from "../core/schemas/index.ts";

export const XWebhookPayloadSchema = z.object({
  tweet_create_events: z
    .array(
      z.object({
        id_str: z.string(),
        text: z.string(),
        created_at: z.string().optional(),
        user: z
          .object({
            screen_name: z.string().nullable().optional(),
            name: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export function crcResponse(crcToken: string, secret = process.env.X_CONSUMER_SECRET): {
  response_token: string;
} {
  if (!secret) {
    throw new Error("X_CONSUMER_SECRET is not configured.");
  }

  const hmac = createHmac("sha256", secret).update(crcToken).digest("base64");
  return { response_token: `sha256=${hmac}` };
}

export function xEventToMention(event: {
  id_str: string;
  text: string;
  created_at?: string;
  user?: {
    screen_name?: string | null;
    name?: string | null;
  };
}, userId: string): {
  userId: string;
  userCommand: string;
  sourcePost: SourcePost;
} {
  return {
    userId,
    userCommand: event.text,
    sourcePost: {
      platform: "x",
      postId: event.id_str,
      url: event.user?.screen_name
        ? `https://x.com/${event.user.screen_name}/status/${event.id_str}`
        : null,
      authorHandle: event.user?.screen_name ?? null,
      authorName: event.user?.name ?? null,
      text: event.text,
      createdAt: event.created_at ?? null,
    },
  };
}
