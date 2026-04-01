import type { EventRow } from "../types";
import { normalizeSeverity } from "./eventStoreUtils";

export function mapEventRow(row: Record<string, unknown>): EventRow {
  let parsedContext: Record<string, unknown> = {};
  let parsedMetadata: Record<string, unknown> | null = null;
  let parsedCapturedOnOpen: unknown | null = null;
  let parsedCapturedOnClose: unknown | null = null;
  try {
    try {
      if (row.event_metadata && typeof row.event_metadata === "object") parsedMetadata = row.event_metadata as Record<string, unknown>;
      else parsedMetadata = row.event_metadata ? (JSON.parse(String(row.event_metadata)) as Record<string, unknown>) : null;
    } catch {
      parsedMetadata = null;
    }
    if (row.context && typeof row.context === "object") parsedContext = row.context as Record<string, unknown>;
    else parsedContext = row.context ? (JSON.parse(String(row.context)) as Record<string, unknown>) : {};
  } catch {
    parsedContext = {};
  }
  try {
    if (row.captured_data_on_open !== undefined && row.captured_data_on_open !== null && typeof row.captured_data_on_open !== "string") {
      parsedCapturedOnOpen = row.captured_data_on_open;
    } else {
      parsedCapturedOnOpen = row.captured_data_on_open
        ? (JSON.parse(String(row.captured_data_on_open)) as unknown)
        : null;
    }
  } catch {
    parsedCapturedOnOpen = null;
  }
  try {
    if (row.captured_data_on_close !== undefined && row.captured_data_on_close !== null && typeof row.captured_data_on_close !== "string") {
      parsedCapturedOnClose = row.captured_data_on_close;
    } else {
      parsedCapturedOnClose = row.captured_data_on_close
        ? (JSON.parse(String(row.captured_data_on_close)) as unknown)
        : null;
    }
  } catch {
    parsedCapturedOnClose = null;
  }
  return {
    id: String(row.id),
    event_path: String(row.event_path),
    start_ts: new Date(String(row.start_ts)).toISOString(),
    end_ts: row.end_ts ? new Date(String(row.end_ts)).toISOString() : null,
    status: String(row.status) === "closed" ? "closed" : "open",
    severity: normalizeSeverity(row.severity || "other"),
    context: parsedContext,
    is_acknowledge: Boolean(row.is_acknowledge),
    acknowledged_ts: row.acknowledged_ts ? new Date(String(row.acknowledged_ts)).toISOString() : null,
    notes_on_open: row.notes_on_open == null ? null : String(row.notes_on_open),
    notes_on_close: row.notes_on_close == null ? null : String(row.notes_on_close),
    event_metadata: parsedMetadata,
    captured_data_on_open: parsedCapturedOnOpen,
    captured_data_on_close: parsedCapturedOnClose
  };
}
