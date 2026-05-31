import type { CassieStore } from "../core/db/store.ts";
import type { ExecutionJob, Position, PositionReview, TradeTicket, UserSettings } from "../core/schemas/index.ts";
import { sendTelegramNotification, type TelegramGateway } from "./telegram.ts";

export function formatTicketCreated(ticket: TradeTicket): string {
  return [
    `Ticket created: ${ticket.instrument} ${ticket.side}`,
    `Size: $${formatUsd(ticket.sizeUsd)}`,
    `Exit: +${ticket.exitPlan.takeProfitPct}% / -${ticket.exitPlan.stopLossPct}% / ${ticket.exitPlan.maxHoldDays}d`,
    ticket.exitPlan.thesis,
  ].join("\n");
}

export function formatTradeExecuted(input: { ticket: TradeTicket; job: ExecutionJob; position: Position | null }): string {
  const positionLine = input.position
    ? `Position opened at ${formatNullable(input.position.entryPrice)} for $${formatUsd(input.position.filledSizeUsd)}.`
    : "Execution returned no fill; no position was opened.";
  return [
    `Trade executed: ${input.ticket.instrument} ${input.ticket.side}`,
    positionLine,
    `Exit: +${input.ticket.exitPlan.takeProfitPct}% / -${input.ticket.exitPlan.stopLossPct}% / ${input.ticket.exitPlan.maxHoldDays}d`,
  ].join("\n");
}

export function formatExecutionFailed(input: { ticket: TradeTicket; job: ExecutionJob }): string {
  return [
    `Execution failed: ${input.ticket.instrument} ${input.ticket.side}`,
    input.job.failureReason ?? "No failure reason returned.",
  ].join("\n");
}

export function formatDailyPositionSummary(input: {
  positions: Array<{ position: Position; review?: PositionReview }>;
}): string {
  if (input.positions.length === 0) {
    return "No open Cassie positions.";
  }
  return [
    `Open positions: ${input.positions.length}`,
    ...input.positions.map(({ position, review }) => {
      const signal = review?.exitSignal && review.exitSignal !== "none"
        ? ` signal=${review.exitSignal}`
        : "";
      return `${position.instrument} ${position.side}: $${formatUsd(position.currentValueUsd)} (${formatPct(position.unrealizedPnlPct)})${signal}`;
    }),
  ].join("\n");
}

export async function sendTelegramForUser(input: {
  store: CassieStore;
  userId: string;
  text: string;
  gateway?: TelegramGateway;
}): Promise<"sent" | "skipped"> {
  const settings = await input.store.getUserSettings(input.userId);
  if (!settings?.telegram) return "skipped";
  await sendTelegramNotification({
    settings,
    text: input.text,
    gateway: input.gateway,
  });
  return "sent";
}

export async function sendDailyPositionSummaries(input: {
  store: CassieStore;
  userId?: string;
  gateway?: TelegramGateway;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const positions = await input.store.listOpenPositions(input.userId);
  const byUser = new Map<string, Position[]>();
  for (const position of positions) {
    byUser.set(position.userId, [...(byUser.get(position.userId) ?? []), position]);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const [userId, userPositions] of byUser) {
    const settings = await input.store.getUserSettings(userId);
    if (!settings?.telegram) {
      skipped += 1;
      continue;
    }
    const decorated = await Promise.all(userPositions.map(async (position) => ({
      position,
      review: await input.store.getLatestPositionReview(position.positionId),
    })));
    try {
      await sendTelegramNotification({
        settings,
        text: formatDailyPositionSummary({ positions: decorated }),
        gateway: input.gateway,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await input.store.audit({
        entityId: userId,
        entityType: "position",
        eventType: "telegram.position_summary_failed",
        message: "Telegram position summary failed.",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return { sent, skipped, failed };
}

export async function notifyTradeLifecycle(input: {
  store: CassieStore;
  settings: UserSettings;
  text: string;
  entityId: string;
  eventType: string;
  gateway?: TelegramGateway;
}): Promise<void> {
  if (!input.settings.telegram) return;
  try {
    await sendTelegramNotification({
      settings: input.settings,
      text: input.text,
      gateway: input.gateway,
    });
  } catch (error) {
    await input.store.audit({
      entityId: input.entityId,
      entityType: "execution_job",
      eventType: input.eventType,
      message: "Telegram lifecycle notification failed.",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNullable(value: number | null): string {
  return value == null ? "unknown price" : String(value);
}
