import {
  accountResponse,
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { session, store } = await authenticatedContext(request);
    return await accountResponse(session.settings, store);
  } catch (error) {
    return apiError(error);
  }
}
