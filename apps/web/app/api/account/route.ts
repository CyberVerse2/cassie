import {
  accountResponse,
  apiError,
  authenticatedContext,
} from "../_lib/account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { claims, store } = await authenticatedContext(request);
    return await accountResponse(claims.user_id, store);
  } catch (error) {
    return apiError(error);
  }
}
