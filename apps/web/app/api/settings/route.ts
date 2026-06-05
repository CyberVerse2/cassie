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
  defaultTradeSizeUsd: z.number().min(MIN_DEFAULT_TRADE_SIZE_USD, MIN_DEFAULT_TRADE_SIZE_MESSAGE),
});

export async function POST(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    const body = settingsSchema.parse(await request.json());
    const settings = await store.getUserSettingsByPrivyUserId(claims.user_id);
    if (!settings) {
      throw new Error(`No Cassie account found for Privy user ${claims.user_id}.`);
    }

    await store.upsertUserSettings({
      ...settings,
      defaultTradeSizeUsd: body.defaultTradeSizeUsd,
    });
    return await accountResponse(claims.user_id, store);
  } catch (error) {
    return apiError(error);
  }
}
