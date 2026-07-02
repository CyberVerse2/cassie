import { sharedAuth } from "../../../../../../packages/adapters/auth/better-auth";

export async function GET(request: Request) {
  return sharedAuth().handler(request);
}

export async function POST(request: Request) {
  return sharedAuth().handler(request);
}
