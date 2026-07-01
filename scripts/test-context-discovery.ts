import "dotenv/config";
import { CassieStructuredClient, routeStructuredModel } from "../packages/ai/client.ts";
import { discoverSourceContext } from "../packages/agent/reasoning.ts";
import { SourcePostSchema, type SourcePost } from "../packages/core/schemas/index.ts";

// A vague tagged post that should force the scout to infer an affected public
// company ($HIMS) from an FDA peptide-compounding regulatory signal, rather
// than stopping at an abstract "compounding pharmacies" sector.
const DEFAULT_TEXT =
  "FDA briefing docs for the July PCAC meeting recommend NOT adding BPC-157, KPV, TB-500, MOTS-c, DSIP, epitalon, or semax to the 503A bulks list. So much for compounded peptides.";

const post: SourcePost = SourcePostSchema.parse({
  platform: "x",
  postId: flag("post-id"),
  url: flag("url"),
  authorHandle: flag("handle") ?? "MartinShkreli",
  authorName: flag("author") ?? "Martin Shkreli",
  text: flag("text") ?? DEFAULT_TEXT,
  createdAt: flag("created-at"),
  quotedPostText: flag("quoted"),
  linkedUrls: listFlag("link"),
  mediaDescriptions: listFlag("media"),
});

const userCommand = flag("command") ?? "@cassie what's the trade here?";

const route = routeStructuredModel({ name: "cassie_context_discovery" });
console.error(
  `[context-discovery] routing → ${route.provider}/${route.model} (tier=${route.tier})`,
);
console.error(`[context-discovery] post: @${post.authorHandle}: ${post.text}\n`);

const startedAt = Date.now();
const ai = new CassieStructuredClient();
const result = await discoverSourceContext({ ai, sourcePost: post, userCommand });
const elapsedMs = Date.now() - startedAt;

console.log(
  JSON.stringify(
    { ok: true, provider: route.provider, model: route.model, elapsedMs, output: result },
    null,
    2,
  ),
);

function flag(name: string): string | null {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === exact) return process.argv[index + 1] ?? null;
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

function listFlag(name: string): string[] {
  const values: string[] = [];
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === exact && process.argv[index + 1]) values.push(process.argv[index + 1]);
    else if (value.startsWith(prefix)) values.push(value.slice(prefix.length));
  }
  return values;
}
