import { z } from "zod";
import {
  dismissPrivyMigration,
  markPrivyFundsMoved,
} from "../../../../../packages/app/privy-migration";
import {
  accountResponse,
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

const migrationSchema = z.object({
  action: z.enum(["dismiss", "moved"]),
});

export async function POST(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    const body = migrationSchema.parse(await request.json());
    const settings = session.settings;
    if (!settings) {
      throw new Error(`No Cassie account found for user ${session.userId}.`);
    }
    const updated = body.action === "dismiss"
      ? dismissPrivyMigration(settings)
      : markPrivyFundsMoved(settings);
    await store.upsertUserSettings(updated);
    return await accountResponse(updated, store);
  } catch (error) {
    return apiError(error);
  }
}
