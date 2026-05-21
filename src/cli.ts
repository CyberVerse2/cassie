import "dotenv/config";
import { inspect } from "node:util";
import { GrokXPostResolver } from "./connectors/x-post-resolver.ts";
import { OpenAiStructuredClient } from "../packages/ai/client.ts";
import { CompositeMarketDataProvider } from "../packages/market-data/index.ts";
import type { SourcePost } from "../packages/core/schemas/index.ts";
import { runCassieSupervisorForRun } from "../packages/ai/agents/supervisor/agent.ts";
import type { ControlRun, ExecutionJob as ControlExecutionJob } from "../packages/core/schemas/index.ts";
import { CassieProduct } from "../packages/workflows/product.ts";
import type { CassieJobQueue } from "../packages/workflows/execution-jobs.ts";
import { DrizzleCassieStore as ControlPlaneStore } from "../packages/db/drizzle-store.ts";
import type { CassieStore, CassieStoreSnapshot } from "../packages/db/store.ts";
import { routeIntent } from "../packages/ai/tools/intent-router.ts";
import { interpretSignal } from "../packages/ai/tools/signal.ts";
import { extractThesis } from "../packages/ai/tools/thesis.ts";
import { TraceRecorder, type TraceEvent } from "../packages/core/trace.ts";
import { buildVisibilityReport, formatVisibilityReport } from "./visibility.ts";
import { formatRunTimeline } from "./timeline.ts";
import { buildCliUserSettings } from "./cli-settings.ts";
import { createTerminalTheme, indentWrap, normalizeStatus, statusTag, type TerminalTheme } from "./terminal-ui.ts";

type CliFlags = Record<string, string | boolean>;

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: CliFlags;
  trace: TraceRecorder;
};

class CliControlPlaneQueue implements CassieJobQueue {
  async enqueueSupervisor(run: ControlRun): Promise<{ runId: string; graphileJobId: null }> {
    return { runId: run.runId, graphileJobId: null };
  }

  async enqueueExecution(job: ControlExecutionJob): Promise<{ executionJobId: string; graphileJobId: null }> {
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
  mention                   Create a durable control-plane run for a Cassie mention.
  run-supervisor <runId>    Run the ToolLoopAgent supervisor for a queued control-plane run.
  control-run <runId>       Show a durable control-plane run, recorded steps, and timeline.
  state                     Show the persisted app state summary.
  runs                      List durable control-plane runs.
  tickets                   List trade tickets.
  approve <ticketId>        Approve a pending trade ticket and queue execution.
  execute-next --yes        Execute the next queued execution job.

Smoke checks:
  smoke:ai                  Test intent and thesis extraction.
  smoke:market              Test market candidate discovery for an asset.

Useful examples:
  npm run cli -- settings:set --user local-user
  npm run cli -- settings:set --user local-user --size 50
  npm run cli -- state
  npm run cli -- mention --user local-user --command "@Cassie trade this" --tweet-url "https://x.com/_proxystudio/status/2057246023974875269"
  npm run cli -- mention --user local-user --command "@Cassie trade this" --post "SOL looks underpriced into ETF approval."
  npm run cli -- mention --user local-user --command "@Cassie trade this" --post "Exa raised $250M" --audit
  npm run cli -- run-supervisor <runId>
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
    webSearchModel: process.env.CASSIE_WEB_SEARCH_MODEL ?? process.env.OPENROUTER_WEB_SEARCH_MODEL ?? "google/gemini-3.1-flash-lite",
    grokSearchModel: process.env.GROK_X_SEARCH_MODEL ?? "grok-4.3",
  };
}

async function settingsSet(args: ParsedArgs) {
  const { settings, generatedWallet } = buildCliUserSettings(args.flags);

  await product().upsertSettings(settings);
  return { saved: true, settings, generatedWallet };
}

async function mention(args: ParsedArgs) {
  return product().createMentionRun({
    userId: flag(args, "user", "local-user"),
    userCommand: flag(args, "command", args.positionals.join(" ") || "@Cassie what do you think?"),
    sourcePost: await sourcePostFromFlags(args),
  });
}

async function runSupervisor(args: ParsedArgs) {
  const runId = requiredPositional(args, 0, "runId");
  const store = new ControlPlaneStore();
  const showTimeline = !args.flags.json && !args.flags["quiet-timeline"];
  const liveTimeline = showTimeline ? startLiveRunTimeline(store, runId) : null;
  let result: unknown;
  try {
    result = await runCassieSupervisorForRun({ runId, store });
  } finally {
    await liveTimeline?.stop();
  }
  const timeline = formatRunTimeline(await store.load(), runId);
  if (showTimeline) {
    console.error(timeline);
  }
  return args.flags.json ? { runId, result, timeline } : { runId, result };
}

async function controlRun(args: ParsedArgs) {
  const runId = requiredPositional(args, 0, "runId");
  const cassie = product();
  const run = await cassie.getRun(runId);
  const timeline = formatRunTimeline(await cassie.state(), runId);
  if (!args.flags.json && !args.flags["quiet-timeline"]) {
    console.error(timeline);
  }
  return args.flags.json ? { ...run, timeline } : run;
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

function product() {
  return new CassieProduct(
    new ControlPlaneStore(),
    undefined,
    null,
    undefined,
    new CliControlPlaneQueue(),
  );
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

  for (const researchRun of snapshot.researchRuns
    .filter((candidate) => candidate.controlRunId === runId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    events.push({
      key: `research:${researchRun.researchRunId}`,
      signature: `${researchRun.status}:${researchRun.completedAt ?? ""}:${researchRun.error ?? ""}`,
      lines: [
        `|-- ${theme.ai("[research]")} ${researchRun.researchRunId} ${statusTag(researchRun.status, theme)} ${liveDuration(researchRun.startedAt, researchRun.completedAt)}`,
        ...indentWrap({ text: `${theme.label("thinking")} plan goals, run web/X query jobs, classify evidence, resolve goals`, indent: "|   |-- ", theme }),
        ...(researchRun.error ? indentWrap({ text: `${theme.fail("error")} ${researchRun.error}`, indent: "|   |-- ", theme }) : []),
      ],
    });
  }

  const researchRunIds = new Set(snapshot.researchRuns
    .filter((run) => run.controlRunId === runId)
    .map((run) => run.researchRunId));
  const jobs = snapshot.researchQueryJobs
    .filter((candidate) => researchRunIds.has(candidate.researchRunId));
  for (const summary of summarizeLiveQueryJobs(jobs)) {
    events.push({
      key: `query-summary:${summary.wave}:${summary.lane}`,
      signature: `${summary.running}:${summary.succeeded}:${summary.failed}:${summary.lastError ?? ""}`,
      lines: liveQuerySummaryLines(summary, theme),
    });
  }

  return events;
}

function summarizeLiveQueryJobs(jobs: CassieStoreSnapshot["researchQueryJobs"]) {
  const groups = new Map<string, {
    wave: number;
    lane: string;
    provider: string;
    total: number;
    running: number;
    succeeded: number;
    failed: number;
    lastError: string | null;
  }>();

  for (const job of jobs) {
    const key = `${job.wave}:${job.lane}:${job.provider}`;
    const group = groups.get(key) ?? {
      wave: job.wave,
      lane: job.lane,
      provider: job.provider,
      total: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      lastError: null,
    };
    group.total += 1;
    if (job.status === "running") group.running += 1;
    if (job.status === "succeeded") group.succeeded += 1;
    if (job.status === "failed") {
      group.failed += 1;
      group.lastError = job.error ?? "unknown error";
    }
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.wave - right.wave || left.lane.localeCompare(right.lane)
  );
}

function liveQuerySummaryLines(
  summary: ReturnType<typeof summarizeLiveQueryJobs>[number],
  theme: TerminalTheme,
): string[] {
  const badge = summary.lane === "x" ? theme.x(`[wave ${summary.wave}]`) : theme.web(`[wave ${summary.wave}]`);
  const status = summary.failed > 0 && summary.running === 0
    ? "completed_with_failures"
    : summary.running > 0
      ? "running"
      : "succeeded";
  const lines = [
    `|   |-- ${badge} ${summary.lane}/${summary.provider} ${statusTag(status, theme)} ${summary.succeeded}/${summary.total} ok ${summary.failed} failed ${summary.running} running`,
  ];
  if (summary.lastError) {
    lines.push(...indentWrap({ text: `${theme.fail("last error")} ${summary.lastError}`, indent: "|   |   |-- ", theme }));
  }
  return lines;
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
    case "intent":
      return "Classify the command into Cassie's bounded intent set.";
    case "signal":
      return "Classify the post signal, tradability, lead quality, and research angles.";
    case "thesis":
      return "Extract the thesis that research should test.";
    case "inverse_thesis":
      return "Build the strongest opposing thesis for countertrade analysis.";
    case "research":
      return "Run goal-first research with query jobs and evidence resolution.";
    case "critique":
      return "Use evidence to identify the strongest objections.";
    case "market_selection":
      return "Select a real market expression without inventing instruments.";
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
  const fields = ["intent", "signalType", "claim", "stance", "decision", "responseType", "publicSummary"];
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
