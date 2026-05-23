import "dotenv/config";
import { inspect } from "node:util";
import { GrokXPostResolver } from "../packages/helpers/x-post-resolver.ts";
import { selectNextTweetUrl } from "../packages/helpers/tweet-round-robin.ts";
import { CassieStructuredClient } from "../packages/ai/client.ts";
import { CompositeMarketDataProvider } from "../packages/adapters/index.ts";
import type { SourcePost } from "../packages/core/schemas/index.ts";
import { runCassieSupervisorForRun } from "../packages/agent/agent.ts";
import { CassieProduct } from "../packages/app/product.ts";
import { DrizzleCassieStore as ControlPlaneStore } from "../packages/core/db/drizzle-store.ts";
import type { CassieStore, CassieStoreSnapshot } from "../packages/core/db/store.ts";
import type { CassieJobQueue } from "../packages/jobs/index.ts";
import type { ControlRun, ExecutionJob } from "../packages/core/schemas/index.ts";
import { frameOpportunity, generateTradeExpressions } from "../packages/agent/tools.ts";
import { TraceRecorder, type TraceEvent } from "../packages/core/trace.ts";
import {
  config,
} from "../packages/core/config.ts";
import { buildVisibilityReport, formatVisibilityReport } from "./visibility.ts";
import { formatRunTimeline } from "./timeline.ts";
import { buildCliUserSettings } from "./cli-settings.ts";
import { createTerminalTheme, indentWrap, normalizeStatus, statusTag, terminalTable, type TerminalTheme } from "./helpers/terminal-ui.ts";

type CliFlags = Record<string, string | boolean>;

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: CliFlags;
  trace: TraceRecorder;
};

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

class InlineCliJobQueue implements CassieJobQueue {
  async enqueueExecution(job: ExecutionJob): Promise<{ executionJobId: string; graphileJobId: string | null }> {
    return { executionJobId: job.jobId, graphileJobId: null };
  }

  async enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: string | null }> {
    return { runId: run.runId, graphileJobId: null };
  }
}

const commands = new Map<string, (args: ParsedArgs) => Promise<unknown>>([
  ["help", help],
  ["env", env],
  ["settings:set", settingsSet],
  ["run", run],
  ["mention", mention],
  ["run-supervisor", runSupervisor],
  ["control-run", controlRun],
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
  run                       Create a run, execute Cassie once inline, and show the live timeline.
  mention                   Create a durable queued run without executing it.
  run-supervisor <runId>    Execute an existing queued run.
  control-run <runId>       Show a durable run, recorded steps, and timeline.
  state                     Show the persisted app state summary.
  runs                      List durable control-plane runs.
  tickets                   List trade tickets.
  approve <ticketId>        Approve a pending trade ticket and queue execution.
  execute-next --yes        Execute the next queued execution job.

Smoke checks:
  smoke:ai                  Test opportunity framing and trade-expression generation.
  smoke:market              Test market candidate discovery for an asset.

Useful examples:
  npm run cli -- settings:set --user local-user
  npm run cli -- settings:set --user local-user --size 50
  npm run cli -- state
  npm run cli -- run
  npm run cli -- run --tweet-url "https://x.com/_proxystudio/status/2057246023974875269"
  npm run cli -- run --post "SOL looks underpriced into ETF approval."
  npm run cli -- run --post "Exa raised $250M" --audit
  npm run cli -- run-supervisor <runId>
  npm run cli -- tickets --json
  npm run cli -- approve <ticketId>
  npm run cli -- execute-next --yes
`);
}

async function env() {
  return {
    databaseUrl: maskSecret(config.database.url),
    geminiApiKey: maskSecret(config.ai.googleApiKey),
    xAiApiKey: maskSecret(config.ai.xAiApiKey),
    hyperliquidPrivateKey: maskSecret(config.execution.hyperliquid.privateKey),
    cassieModel: config.ai.importantModel,
    webSearchModel: config.ai.webSearchModel,
    grokSearchModel: config.ai.grokXSearchModel,
  };
}

async function settingsSet(args: ParsedArgs) {
  const { settings, generatedWallet } = buildCliUserSettings(args.flags);

  await product().upsertSettings(settings);
  return { saved: true, settings, generatedWallet };
}

async function run(args: ParsedArgs) {
  const store = new ControlPlaneStore();
  const queued = await new CassieProduct(store, null, undefined, new InlineCliJobQueue())
    .createMentionRun(await mentionRequestFromArgs(args));
  return executeRunWithTimeline({
    args,
    store,
    runId: queued.runId,
    queued,
  });
}

async function mention(args: ParsedArgs) {
  return product().createMentionRun(await mentionRequestFromArgs(args));
}

async function runSupervisor(args: ParsedArgs) {
  const runId = requiredPositional(args, 0, "runId");
  return executeRunWithTimeline({
    args,
    store: new ControlPlaneStore(),
    runId,
  });
}

async function executeRunWithTimeline(input: {
  args: ParsedArgs;
  store: ControlPlaneStore;
  runId: string;
  queued?: unknown;
}) {
  const { args, store, runId, queued } = input;
  const showTimeline = !args.flags.json && !args.flags["quiet-timeline"];
  const liveTimeline = showTimeline ? startLiveRunTimeline(store, runId) : null;
  let result: unknown;
  try {
    result = await runCassieSupervisorForRun({ runId, store });
  } finally {
    await liveTimeline?.stop();
  }
  const snapshot = await store.load();
  const timeline = formatRunTimeline(snapshot, runId);
  if (showTimeline) {
    console.error(timeline);
  }
  if (args.flags.json) return { runId, queued, result, timeline };
  if (args.flags.full) return { runId, queued, result };
  return summarizeRun(snapshot, runId);
}

async function controlRun(args: ParsedArgs) {
  const runId = requiredPositional(args, 0, "runId");
  const cassie = product();
  const run = await cassie.getRun(runId);
  const timeline = formatRunTimeline(await cassie.state(), runId);
  if (!args.flags.json && !args.flags["quiet-timeline"]) {
    console.error(timeline);
  }
  if (args.flags.json) return { ...run, timeline };
  if (args.flags.full) return run;
  return summarizeRun(await cassie.state(), runId);
}

async function state(args: ParsedArgs) {
  const snapshot = await product().state();
  if (args.flags.full) {
    return snapshot;
  }

  return summarizeState(snapshot);
}

async function runs(args: ParsedArgs) {
  const snapshot = await product().state();
  const userId = nullableFlag(args, "user");
  return snapshot.controlRuns
    .filter((run) => !userId || run.userId === userId)
    .map((run) => ({
      runId: run.runId,
      userId: run.userId,
      status: run.status,
      userCommand: run.userCommand,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
}

async function tickets(args: ParsedArgs) {
  const snapshot = await product().state();
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
  return product().approveTicket(requiredPositional(args, 0, "ticketId"));
}

async function executeNext(args: ParsedArgs) {
  if (!args.flags.yes) {
    throw new CliError("Refusing live execution without --yes.");
  }

  return product().processNextExecutionJob();
}

async function smokeAi(args: ParsedArgs) {
  const ai = new CassieStructuredClient(undefined, args.trace);
  const userCommand = flag(args, "command", "@Cassie should we trade this?");
  const sourcePost = await sourcePostFromFlags(args);
  const opportunityFrame = await frameOpportunity({ ai, sourcePost, userCommand });
  const tradeExpression = await generateTradeExpressions({
    ai,
    sourcePost,
    userCommand,
    opportunityFrame,
  });

  return { opportunityFrame, tradeExpression };
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

function product() {
  return new CassieProduct(new ControlPlaneStore());
}

async function mentionRequestFromArgs(args: ParsedArgs) {
  return {
    userId: flag(args, "user", "local-user"),
    userCommand: flag(args, "command", args.positionals.join(" ") || "@Cassie trade this"),
    sourcePost: await mentionSourcePostFromArgs(args),
  };
}

async function mentionSourcePostFromArgs(args: ParsedArgs): Promise<SourcePost> {
  if (nullableFlag(args, "tweet-url") || typeof args.flags.post === "string") {
    return sourcePostFromFlags(args);
  }

  return sourcePostFromFlags({
    ...args,
    flags: {
      ...args.flags,
      "tweet-url": await selectNextTweetUrl(nullableFlag(args, "tweets-file") ?? undefined),
    },
  });
}

function summarizeState(snapshot: CassieStoreSnapshot) {
  return {
    mentions: snapshot.mentions.length,
    runs: countBy(snapshot.controlRuns, (run) => run.status),
    tradeTickets: countBy(snapshot.tradeTickets, (ticket) => ticket.approvalState),
    executionJobs: countBy(snapshot.executionJobs, (job) => job.status),
    auditEvents: snapshot.auditEvents.length,
    userSettings: snapshot.userSettings.map((settings) => ({
      userId: settings.userId,
      walletAddress: settings.walletAddress,
      allowedVenues: settings.allowedVenues,
      defaultTradeSizeUsd: settings.defaultTradeSizeUsd,
      autoTradeEnabled: settings.autoTradeEnabled,
    })),
  };
}

function summarizeRun(snapshot: CassieStoreSnapshot, runId: string) {
  const theme = createTerminalTheme();
  const run = snapshot.controlRuns.find((candidate) => candidate.runId === runId);
  if (!run) return `${theme.title("CASSIE RUN")}\n${statusTag("missing", theme)} ${runId}`;

  const steps = snapshot.runSteps
    .filter((step) => step.runId === runId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((step) => ({
      type: step.stepType,
      status: step.status,
      model: step.model,
      output: summarizeLiveOutput(step.output),
      error: step.error,
    }));
  const result = run.result && typeof run.result === "object" ? run.result as Record<string, unknown> : {};
  const actionState = stringOrNull(result.actionState) ?? "unknown";
  const responseType = stringOrNull(result.responseType) ?? "unknown";
  const ticketId = stringOrNull(result.ticketId) ?? "none";
  const publicSummary = stringOrNull(result.publicSummary);

  const lines = [
    theme.title("CASSIE RUN"),
    `${statusTag(run.status, theme)} ${theme.section(run.runId)}`,
    "",
    ...terminalTable({
      head: ["field", "value"],
      rows: [
        ["status", run.status],
        ["action", actionState],
        ["response", responseType],
        ["ticket", ticketId],
      ],
      theme,
    }),
  ];

  if (publicSummary) {
    lines.push(
      "",
      theme.section("Verdict"),
      ...indentWrap({ text: publicSummary, indent: "|-- ", theme }),
    );
  }

  lines.push(
    "",
    theme.section("Workflow"),
    ...terminalTable({
      head: ["step", "status", "model", "output"],
      rows: steps.map((step) => [
        formatStepType(step.type),
        normalizeStatus(step.status),
        step.model ?? "none",
        truncateTerminal(step.error ? `error: ${step.error}` : step.output ?? "done", 96),
      ]),
      theme,
    }),
  );

  return lines.join("\n");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatStepType(value: string): string {
  return value
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateTerminal(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
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

function startLiveRunTimeline(store: CassieStore, runId: string) {
  const theme = createTerminalTheme();
  const seen = new Map<string, string>();
  let pending = false;
  let stopped = false;

  console.error(theme.title("CASSIE LIVE RUN"));
  console.error(`${theme.run("[run]")} ${runId}`);
  console.error(`|-- ${theme.dim("waiting for persisted supervisor steps...")}`);

  const render = async () => {
    if (pending) return;
    pending = true;
    try {
      const snapshot = await store.load();
      for (const event of liveRunEvents(snapshot, runId, theme)) {
        const previous = seen.get(event.key);
        if (previous === event.signature) continue;
        seen.set(event.key, event.signature);
        for (const line of event.lines) {
          console.error(line);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const key = "live-timeline-error";
      if (seen.get(key) !== message) {
        seen.set(key, message);
        console.error(`|-- [timeline] failed to refresh: ${message}`);
      }
    } finally {
      pending = false;
    }
  };

  const timer = setInterval(() => {
    void render();
  }, 1_000);
  void render();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await render();
      console.error("");
    },
  };
}

function liveRunEvents(snapshot: CassieStoreSnapshot, runId: string, theme: TerminalTheme) {
  const events: Array<{ key: string; signature: string; lines: string[] }> = [];
  const run = snapshot.controlRuns.find((candidate) => candidate.runId === runId);
  if (run) {
    events.push({
      key: `run:${run.runId}`,
      signature: `${run.status}:${run.updatedAt}:${run.error ?? ""}`,
      lines: [
        `${statusTag(run.status, theme)} ${theme.section(run.runId)} ${run.status}`,
        ...(run.error ? indentWrap({ text: `${theme.fail("error")} ${run.error}`, indent: "|-- ", theme }) : []),
      ],
    });
  }

  for (const step of snapshot.runSteps
    .filter((candidate) => candidate.runId === runId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    const output = summarizeLiveOutput(step.output);
    events.push({
      key: `step:${step.stepId}`,
      signature: `${step.status}:${step.completedAt ?? ""}:${step.error ?? ""}:${output ?? ""}`,
      lines: [
        `|-- ${liveToolBadge(step.model, step.stepType, theme)} ${step.stepType} ${statusTag(step.status, theme)} ${liveDuration(step.startedAt, step.completedAt)}`,
        `|   |-- ${theme.label("tool")} ${step.promptName ?? step.stepType}${step.model ? ` (${step.model})` : ""}`,
        ...indentWrap({ text: `${theme.label("thinking")} ${liveThinking(step.stepType)}`, indent: "|   |-- ", theme }),
        ...(output ? indentWrap({ text: `${theme.label("output")} ${output}`, indent: "|   |-- ", theme }) : []),
        ...(step.error ? indentWrap({ text: `${theme.fail("error")} ${step.error}`, indent: "|   |-- ", theme }) : []),
      ],
    });
  }

  return events;
}

function liveToolBadge(model: string | null, stepType: string, theme: TerminalTheme): string {
  if (model) return theme.ai("[ai]");
  if (stepType === "risk") return theme.risk("[risk]");
  if (stepType === "ticket") return theme.ticket("[ticket]");
  return "[tool]";
}

function liveThinking(stepType: string): string {
  switch (stepType) {
    case "intake":
      return "Persist the incoming mention before agent work starts.";
    case "opportunity":
      return "Frame the raw verifiable signal into a market opportunity.";
    case "trade_expression":
      return "Generate competing trade expressions from the framed opportunity.";
    case "market_candidates":
      return "Fetch real candidates from configured venues.";
    case "market_assessment":
      return "Assess candidate fit and prediction-market side semantics.";
    case "market_quote":
      return "Refresh market quote data.";
    case "market_selection":
      return "Rank real market expressions without inventing instruments.";
    case "risk":
      return "Evaluate deterministic user and account risk limits.";
    case "ticket":
      return "Persist a ticket only after the gates allow it.";
    case "final":
      return "Persist the final user-facing result.";
    default:
      return "Run the next persisted control-plane step.";
  }
}

function summarizeLiveOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const fields = ["userIntent", "literalClaim", "opportunity", "decision", "responseType", "publicSummary"];
  const summary = fields
    .map((fieldName) => {
      const value = record[fieldName];
      return typeof value === "string" ? `${fieldName}=${truncate(value, 160)}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return summary.length > 0 ? summary : null;
}

function liveDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "unknown";
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  const ms = Math.max(0, end - start);
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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

  if (typeof value === "string") {
    console.log(value);
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
    if (config.terminal.debug) {
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
