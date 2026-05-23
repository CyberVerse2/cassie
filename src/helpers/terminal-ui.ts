import { Chalk } from "chalk";
import Table from "cli-table3";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { config } from "../../packages/core/config.ts";

export type TerminalTheme = ReturnType<typeof createTerminalTheme>;

export function createTerminalTheme(input: {
  color?: boolean;
  columns?: number;
} = {}) {
  const color = input.color ?? shouldUseColor();
  const columns = input.columns ?? process.stdout.columns ?? 100;
  const c = new Chalk({ level: color ? 1 : 0 });

  return {
    color,
    columns,
    title: (value: string) => c.bold.cyan(value),
    section: (value: string) => c.bold(value),
    dim: (value: string) => c.dim(value),
    label: (value: string) => c.gray(value),
    value: (value: string) => value,
    ok: (value: string) => c.green(value),
    fail: (value: string) => c.red(value),
    wait: (value: string) => c.yellow(value),
    run: (value: string) => c.blue(value),
    ai: (value: string) => c.magenta(value),
    web: (value: string) => c.blue(value),
    x: (value: string) => c.cyan(value),
    risk: (value: string) => c.yellow(value),
    ticket: (value: string) => c.green(value),
  };
}

export function shouldUseColor(): boolean {
  return Boolean(process.stderr.isTTY) && !config.terminal.noColor;
}

export function indentWrap(input: {
  text: string;
  indent: string;
  width?: number;
  theme?: TerminalTheme;
}): string[] {
  const width = Math.max(24, input.width ?? (input.theme?.columns ?? process.stderr.columns ?? 100));
  const available = Math.max(20, width - stringWidth(stripAnsiHint(input.indent)));
  return wrapAnsi(input.text, available, { hard: true, trim: false })
    .split("\n")
    .map((line) => `${input.indent}${line}`);
}

export function terminalTable(input: {
  head: string[];
  rows: Array<Array<string | number | null | undefined>>;
  theme?: TerminalTheme;
}): string[] {
  const table = new Table({
    head: input.head.map((item) => input.theme?.label(item) ?? item),
    style: {
      head: [],
      border: [],
      compact: true,
    },
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: "  ",
    },
  });

  for (const row of input.rows) {
    table.push(row.map((value) => value == null ? "unknown" : String(value)));
  }

  return table.toString().split("\n").filter((line) => line.trim().length > 0);
}

export function statusTag(status: string, theme: TerminalTheme = createTerminalTheme()): string {
  const normalized = normalizeStatus(status);
  const raw = `[${normalized}]`;
  if (normalized === "ok") return theme.ok(raw);
  if (normalized === "fail") return theme.fail(raw);
  if (normalized === "run") return theme.run(raw);
  if (normalized === "wait") return theme.wait(raw);
  return raw;
}

export function normalizeStatus(status: string): string {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "fail";
  if (status === "running") return "run";
  if (status === "queued" || status === "pending" || status === "awaiting_approval") return "wait";
  return status;
}

function stripAnsiHint(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
