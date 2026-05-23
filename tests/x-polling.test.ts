import { describe, expect, it } from "vitest";
import { InMemoryCassieStore } from "../packages/core/db/store.ts";
import { pollXMentions, type XPollingClient } from "../packages/app/x-polling.ts";
import type { CassieProduct } from "../packages/app/product.ts";

describe("X polling", () => {
  it("does not rewrite the runtime cursor when no newer mention arrives", async () => {
    const store = new InMemoryCassieStore();
    await store.setRuntimeState("x_poll:user_1", { sinceId: "tweet_2" });

    let runtimeWrites = 0;
    const originalSetRuntimeState = store.setRuntimeState.bind(store);
    store.setRuntimeState = async (key, value) => {
      runtimeWrites += 1;
      await originalSetRuntimeState(key, value);
    };

    const result = await pollXMentions({
      store,
      userId: "user_1",
      product: {} as CassieProduct,
      client: {
        async fetchMentions() {
          return {
            meta: { newest_id: "tweet_2", result_count: 0 },
          };
        },
      } as unknown as XPollingClient,
    });

    expect(result).toMatchObject({ queued: 0, newestId: "tweet_2" });
    expect(runtimeWrites).toBe(0);
  });
});
