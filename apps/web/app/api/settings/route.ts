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

    // Patch, don't upsert: this write races the promo claim's multi-step
    // writes when the user claims from the intro, and whole-object writes
    // from stale snapshots clobber each other's fields.
    const patch = {
      ...(body.defaultTradeSizeUsd != null
        ? { defaultTradeSizeUsd: body.defaultTradeSizeUsd }
        : {}),
      ...(body.introSeen
        ? { introSeenAt: settings.introSeenAt ?? new Date().toISOString() }
        : {}),
    };
    if (Object.keys(patch).length > 0) {
      await store.patchUserSettings(settings.userId, patch);
    }
    return await accountResponse({ ...settings, ...patch }, store);
  } catch (error) {
    return apiError(error);
  }
}
