import "dotenv/config";
import { inspect } from "node:util";
import { OpenAiStructuredClient } from "./ai.ts";
import { CompositeMarketDataProvider } from "./connectors/market-data.ts";
import {
  GrokXSearchLane,
  LiveResearchSearchLanes,
  OpenAiWebSearchLane,
} from "./connectors/research-lanes.ts";
import { GrokXPostResolver } from "./connectors/x-post-resolver.ts";
import type { ExecutionJob, SourcePost, UserSettings } from "./schemas.ts";
import { DrizzleCassieStore } from "./db/store.ts";
import type { CassieStoreSnapshot } from "./store.ts";
import { routeIntent } from "./tools/intent-router.ts";
import { interpretSignal } from "./tools/signal.ts";
import { extractThesis } from "./tools/thesis.ts";
import { CassieProduct } from "./product.ts";
import type { ExecutionJobQueue } from "./jobs/execution-jobs.ts";
import { TraceRecorder, type TraceEvent } from "./trace.ts";
import { buildVisibilityReport, formatVisibilityReport } from "./visibility.ts";

type CliFlags = Record<string, string | boolean>;

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: CliFlags;
  trace: TraceRecorder;
};

class CliExecutionQueue implements ExecutionJobQueue {
  async enqueue(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: null }> {
    return { executionJobId: job.jobId, graphileJobId: null };
  }
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

const commands = new Map<string, (args: ParsedArgs) => Promise<unknown>>([
  ["help", help],
  ["env", env],
  ["settings:set", settingsSet],
  ["mention", mention],
  ["state", state],
  ["runs", runs],
  ["tickets", tickets],
  ["approve", approve],
  ["execute-next", executeNext],
  ["smoke:ai", smokeAi],
  ["smoke:market", smokeMarket],
]);

try {
  await main();
  process.exit(0);
} catch (error) {
  printError(error);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.trace = createCliTrace(args);
  const handler = commands.get(args.command);

  if (!handler) {
    throw new CliError(`Unknown command "${args.command}". Run "npm run cli -- help".`);
  }

  let result = await handler(args);
  const trace = args.trace.snapshot();
  const tokenUsage = args.trace.usageTotals();
  const visibility = buildVisibilityReport({ result, trace, tokenUsage });
  if (trace.length > 0 && args.flags.json) {
    result = {
      result,
      trace,
      visibility,
      tokenUsage,
    };
  }
  if (result !== undefined) {
    print(result, Boolean(args.flags.json));
  }
  if (trace.length > 0 && args.flags.audit && !args.flags.json) {
    console.error(formatVisibilityReport(visibility));
  }
}

async function help() {
  console.log(`Cassie CLI

Usage:
  npm run cli -- <command> [options]

Setup:
  settings:set              Create or update a test user's trading settings.
  env                       Show required runtime dependencies, with secrets masked.

App flow:
  mention                   Process a Cassie mention synchronously.
  state                     Show the persisted app state summary.
  runs                      List completed Cassie runs.
  tickets                   List trade tickets.
  approve <ticketId>        Approve a pending trade ticket and queue execution.
  execute-next --yes        Execute the next queued execution job.

Smoke checks:
  smoke:ai                  Test intent and thesis extraction.
  smoke:market              Test market candidate discovery for an asset.

Useful examples:
  npm run cli -- settings:set --user local-user --wallet 0xabc... --assets SOL,BTC --size 50
  npm run cli -- state
  npm run cli -- mention --user local-user --command "@Cassie trade this" --tweet-url "https://x.com/_proxystudio/status/2057246023974875269"
  npm run cli -- mention --user local-user --command "@Cassie trade this" --post "SOL looks underpriced into ETF approval."
  npm run cli -- mention --user local-user --command "@Cassie trade this" --post "Exa raised $250M" --audit
  npm run cli -- tickets --json
  npm run cli -- approve <ticketId>
  npm run cli -- execute-next --yes
`);
}

async function env() {
  return {
    databaseUrl: maskSecret(process.env.DATABASE_URL),
    openAiApiKey: maskSecret(process.env.OPENAI_API_KEY),
    xAiApiKey: maskSecret(process.env.XAI_API_KEY),
    hyperliquidPrivateKey: maskSecret(process.env.HYPERLIQUID_PRIVATE_KEY),
    cassieModel: process.env.CASSIE_MODEL ?? "gpt-5.5",
    webSearchModel: process.env.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5",
    grokSearchModel: process.env.GROK_X_SEARCH_MODEL ?? "grok-4.3",
  };
}

async function settingsSet(args: ParsedArgs) {
  const settings: UserSettings = {
    userId: flag(args, "user", "local-user"),
    walletAddress: nullableFlag(args, "wallet"),
    allowedVenues: csvFlag(args, "venues", ["hyperliquid", "polymarket"]),
    allowedAssets: csvFlag(args, "assets", ["SOL"]),
    defaultTradeSizeUsd: numberFlag(args, "size", 50),
    maxTradeSizeUsd: numberFlag(args, "max-size", 100),
    maxDailyLossUsd: numberFlag(args, "max-daily-loss", 100),
    minConfidence: numberFlag(args, "min-confidence", 0.75),
    maxSpreadBps: numberFlag(args, "max-spread-bps", 50),
    maxSlippageBps: numberFlag(args, "max-slippage-bps", 100),
    maxPositionUsd: numberFlag(args, "max-position", 1_000),
    autoTradeEnabled: booleanFlag(args, "auto-trade", false),
  };

  await product(args.trace).upsertSettings(settings);
  return { saved: true, settings };
}

async function mention(args: ParsedArgs) {
  return product(args.trace).processMention({
    userId: flag(args, "user", "local-user"),
    userCommand: flag(args, "command", args.positionals.join(" ") || "@Cassie what do you think?"),
    sourcePost: await sourcePostFromFlags(args),
  });
}

async function state(args: ParsedArgs) {
  const snapshot = await product(args.trace).state();
  if (args.flags.full) {
    return snapshot;
  }

  return summarizeState(snapshot);
}

async function runs(args: ParsedArgs) {
  const snapshot = await product(args.trace).state();
  const userId = nullableFlag(args, "user");
  return snapshot.runs
    .filter((run) => !userId || run.userId === userId)
    .map((run) => ({
      runId: run.runId,
      mentionId: run.mentionId,
      userId: run.userId,
      responseType: run.responseType,
      userCommand: run.userCommand,
      createdAt: run.createdAt,
    }));
}

async function tickets(args: ParsedArgs) {
  const snapshot = await product(args.trace).state();
  const userId = nullableFlag(args, "user");
  return snapshot.tradeTickets
    .filter((ticket) => !userId || ticket.userId === userId)
    .map((ticket) => ({
      ticketId: ticket.ticketId,
      userId: ticket.userId,
      approvalState: ticket.approvalState,
      venue: ticket.venue,
      instrument: ticket.instrument,
      side: ticket.side,
      sizeUsd: ticket.sizeUsd,
      thesis: ticket.thesis,
      riskDecision: ticket.riskDecision.decision,
    }));
}

async function approve(args: ParsedArgs) {
  return product(args.trace).approveTicket(requiredPositional(args, 0, "ticketId"));
}

async function executeNext(args: ParsedArgs) {
  if (!args.flags.yes) {
    throw new CliError("Refusing live execution without --yes.");
  }

  return product(args.trace).processNextExecutionJob();
}

async function smokeAi(args: ParsedArgs) {
  const ai = new OpenAiStructuredClient(undefined, args.trace);
  const userCommand = flag(args, "command", "@Cassie should we trade this?");
  const sourcePost = await sourcePostFromFlags(args);
  const intent = await routeIntent({ ai, sourcePost, userCommand });
  const signal = await interpretSignal({ ai, sourcePost, userCommand });
  const thesis = await extractThesis({ ai, sourcePost, userCommand, signal });

  return { intent, signal, thesis };
}

async function smokeMarket(args: ParsedArgs) {
  const asset = flag(args, "asset", "SOL").toUpperCase();
  const candidates = await new CompositeMarketDataProvider().findCandidates({
    thesis: {
      claim: flag(args, "claim", `${asset} has a bullish catalyst that may be underpriced.`),
      direction: flag(args, "direction", "bullish") as "bullish" | "bearish" | "neutral" | "unclear",
      mentionedAssets: [asset],
      topics: csvFlag(args, "topics", ["market_structure"]),
      timeHorizon: "weeks",
      evidenceQuality: "unknown",
      manipulationRisk: "unknown",
      confidence: numberFlag(args, "confidence", 0.75),
    },
  });

  return {
    asset,
    candidateCount: candidates.length,
    candidates,
  };
}

function product(trace: TraceRecorder) {
  return new CassieProduct(
    new DrizzleCassieStore(),
    {
      ai: new OpenAiStructuredClient(undefined, trace),
      marketData: new CompositeMarketDataProvider(),
      researchLanes: new LiveResearchSearchLanes(
        new OpenAiWebSearchLane(undefined, undefined, trace),
        new GrokXSearchLane(undefined, undefined, trace),
      ),
    },
    null,
    undefined,
    new CliExecutionQueue(),
  );
}

function summarizeState(snapshot: CassieStoreSnapshot) {
  return {
    mentions: snapshot.mentions.length,
    runs: countBy(snapshot.runs, (run) => run.responseType),
    tradeTickets: countBy(snapshot.tradeTickets, (ticket) => ticket.approvalState),
    executionJobs: countBy(snapshot.executionJobs, (job) => job.status),
    auditEvents: snapshot.auditEvents.length,
    userSettings: snapshot.userSettings.map((settings) => ({
      userId: settings.userId,
      walletAddress: settings.walletAddress,
      allowedVenues: settings.allowedVenues,
      allowedAssets: settings.allowedAssets,
      defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
      autoTradeEnabled: settings.autoTradeEnabled,
    })),
  };
}

async function sourcePostFromFlags(args: ParsedArgs): Promise<SourcePost> {
  const tweetUrl = nullableFlag(args, "tweet-url");
  if (tweetUrl) {
    if (typeof args.flags.post === "string") {
      throw new CliError("Use either --tweet-url or --post, not both.");
    }

    return new GrokXPostResolver(undefined, undefined, args.trace).resolve(tweetUrl);
  }

  return {
    platform: "x",
    postId: nullableFlag(args, "post-id"),
    url: nullableFlag(args, "url"),
    authorHandle: nullableFlag(args, "author") ?? "local-test",
    authorName: nullableFlag(args, "author-name") ?? "Local Test",
    text: flag(args, "post", "Solana ETF approval is basically inevitable now. Market is asleep."),
    createdAt: nullableFlag(args, "created-at"),
    quotedPostText: nullableFlag(args, "quote") ?? undefined,
    linkedUrls: csvFlag(args, "links", []),
    mediaDescriptions: csvFlag(args, "media", []),
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand = "help", ...rest] = argv;
  const flags: CliFlags = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }

  return { command: rawCommand, positionals, flags, trace: new TraceRecorder() };
}

function createCliTrace(args: ParsedArgs): TraceRecorder {
  if (args.flags.json || args.flags["quiet-trace"]) {
    return new TraceRecorder();
  }

  return new TraceRecorder((event) => {
    printTraceEvent(event);
  });
}

function printTraceEvent(event: TraceEvent) {
  if (event.status === "running") {
    console.error(`[trace:${event.stepId}] start ${event.name} (${event.kind}${event.model ? `, ${event.model}` : ""})`);
    console.error(`  ${event.thinkingTrace}`);
    return;
  }

  const usage = event.usage
    ? ` tokens=${event.usage.totalTokens ?? "?"} in=${event.usage.inputTokens ?? "?"} out=${event.usage.outputTokens ?? "?"} reasoning=${event.usage.reasoningTokens ?? "?"}`
    : "";
  const status = event.status === "succeeded" ? "done" : "fail";
  console.error(`[trace:${event.stepId}] ${status} ${event.name} ${event.durationMs ?? 0}ms${usage}`);
  if (event.error) {
    console.error(`  error: ${event.error}`);
  }
}

function flag(args: ParsedArgs, name: string, defaultValue: string): string {
  const value = args.flags[name];
  return typeof value === "string" ? value : defaultValue;
}

function nullableFlag(args: ParsedArgs, name: string): string | null {
  const value = args.flags[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function csvFlag(args: ParsedArgs, name: string, defaultValue: string[]): string[] {
  const value = args.flags[name];
  if (typeof value !== "string" || value.length === 0) {
    return defaultValue;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function numberFlag(args: ParsedArgs, name: string, defaultValue: number): number {
  const value = args.flags[name];
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`--${name} must be a number.`);
  }

  return parsed;
}

function booleanFlag(args: ParsedArgs, name: string, defaultValue: boolean): boolean {
  const value = args.flags[name];
  if (value == null) {
    return defaultValue;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new CliError(`--${name} must be true or false.`);
}

function requiredPositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (!value) {
    throw new CliError(`Missing required ${name}.`);
  }

  return value;
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function maskSecret(value: string | undefined) {
  if (!value) {
    return { configured: false };
  }

  return {
    configured: true,
    masked: `${value.slice(0, 7)}...${value.slice(-4)}`,
    length: value.length,
  };
}

function print(value: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(inspect(value, { colors: true, depth: 8, maxArrayLength: 50 }));
}

function printError(error: unknown) {
  if (error instanceof CliError) {
    console.error(error.message);
    return;
  }

  if (isConnectionRefusedError(error)) {
    console.error("Cassie database is unavailable. Start Postgres and verify DATABASE_URL before running this command.");
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    return;
  }

  console.error(String(error));
}

function isConnectionRefusedError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
    return true;
  }

  if (typeof error === "object" && error !== null && "cause" in error) {
    return isConnectionRefusedError((error as { cause: unknown }).cause);
  }

  if (error instanceof AggregateError) {
    return error.errors.some(isConnectionRefusedError);
  }

  return false;
}
