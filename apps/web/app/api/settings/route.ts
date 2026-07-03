import { z } from "zod";
import {
  MIN_DEFAULT_TRADE_SIZE_USD,
  MIN_DEFAULT_TRADE_SIZE_MESSAGE,
  accountResponse,
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

const settingsSchema = z.object({
  defaultTradeSizeUsd: z
    .number()
    .min(MIN_DEFAULT_TRADE_SIZE_USD, MIN_DEFAULT_TRADE_SIZE_MESSAGE)
    .optional(),
  // Marks the first-call intro as seen; one-way on purpose.
  introSeen: z.literal(true).optional(),
});

export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const body = settingsSchema.parse(await request.json());
    const settings = session.settings;
    if (!settings) {
      throw new Error(`No Cassie account found for user ${session.userId}.`);
    }

    const updated = {
      ...settings,
      ...(body.defaultTradeSizeUsd != null
        ? { defaultTradeSizeUsd: body.defaultTradeSizeUsd }
        : {}),
      ...(body.introSeen
        ? { introSeenAt: settings.introSeenAt ?? new Date().toISOString() }
        : {}),
    };
    await store.upsertUserSettings(updated);
    return await accountResponse(updated, store);
  } catch (error) {
    return apiError(error);
  }
}
