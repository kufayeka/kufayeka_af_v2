import type { EventRow, EventStore, EventStoreChangeMeta } from "../../runtime/core/runtimeTypes";
import { wildcardToRegExp } from "../../runtime/event/EventQuerySupport";

// Minimal in-memory EventStore used to simulate the real open/close pipeline
// without a Postgres dependency. It implements only what
// EventTemplateLifecycle.openEventFromTemplate/closeEventFromTemplate
// actually call (open, close, closeById, get, getById, subscribe) — the same
// spirit as the existing FakeEventStoreRepository used in the event stress
// tests, just shaped to satisfy the public EventStore contract instead of
// EventStoreRepository.
export class SimEventStore implements EventStore {
  private readonly rows = new Map<string, EventRow>();
  private idCounter = 0;
  private readonly listeners = new Set<(meta: EventStoreChangeMeta) => void>();

  private notify(meta: EventStoreChangeMeta): void {
    for (const listener of this.listeners) listener(meta);
  }

  getMeta(): ReturnType<EventStore["getMeta"]> {
    let openCount = 0;
    for (const row of this.rows.values()) if (row.status === "open") openCount += 1;
    return {
      engine: "postgresql",
      database: "sim",
      schema: "sim",
      table: "sim_event",
      openEventCache: { enabled: true, warm: true, openCount, lastWarmupAt: null }
    };
  }

  async open(
    eventPath: string,
    ts?: string,
    context: Record<string, unknown> = {},
    notesOnOpen = "",
    severity = "other",
    capturedDataOnOpen: unknown | null = null,
    eventMetadata: Record<string, unknown> | null = null
  ): Promise<EventRow> {
    this.idCounter += 1;
    const row: EventRow = {
      id: `evt-${this.idCounter}`,
      event_path: eventPath,
      start_ts: ts || new Date().toISOString(),
      end_ts: null,
      status: "open",
      severity: (severity || "other") as EventRow["severity"],
      context: context || {},
      is_acknowledge: false,
      acknowledged_ts: null,
      notes_on_open: notesOnOpen || null,
      notes_on_close: null,
      event_metadata: eventMetadata,
      captured_data_on_open: capturedDataOnOpen,
      captured_data_on_close: null
    };
    this.rows.set(row.id, row);
    this.notify({ type: "open", ts: row.start_ts, row: { ...row } });
    return { ...row };
  }

  async close(
    pattern = "*",
    ts?: string,
    notesOnClose?: string,
    capturedDataOnClose?: unknown | null
  ): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; captured_data_on_close: unknown | null }> {
    const matcher = wildcardToRegExp(pattern);
    const closeTs = ts || new Date().toISOString();
    let closedCount = 0;
    for (const row of this.rows.values()) {
      if (row.status !== "open" || !matcher.test(row.event_path)) continue;
      row.status = "closed";
      row.end_ts = closeTs;
      row.notes_on_close = notesOnClose ?? null;
      row.captured_data_on_close = capturedDataOnClose ?? null;
      closedCount += 1;
      this.notify({ type: "close", ts: closeTs, row: { ...row } });
    }
    return { pattern, closedCount, ts: closeTs, notes_on_close: notesOnClose ?? null, captured_data_on_close: capturedDataOnClose ?? null };
  }

  async closeById(
    id: string,
    ts?: string,
    notesOnClose?: string,
    capturedDataOnClose?: unknown | null
  ): Promise<{ id: string; closedCount: number; ts: string; notes_on_close: string | null; captured_data_on_close: unknown | null }> {
    const row = this.rows.get(id);
    const closeTs = ts || new Date().toISOString();
    if (!row || row.status !== "open") {
      return { id, closedCount: 0, ts: closeTs, notes_on_close: null, captured_data_on_close: null };
    }
    row.status = "closed";
    row.end_ts = closeTs;
    row.notes_on_close = notesOnClose ?? null;
    row.captured_data_on_close = capturedDataOnClose ?? null;
    this.notify({ type: "closeById", ts: closeTs, id, row: { ...row } });
    return { id, closedCount: 1, ts: closeTs, notes_on_close: row.notes_on_close, captured_data_on_close: row.captured_data_on_close };
  }

  async acknowledgeById(id: string, ts?: string): Promise<{ id: string; acknowledgedCount: number; acknowledged_ts: string }> {
    const row = this.rows.get(id);
    const ackTs = ts || new Date().toISOString();
    if (!row) return { id, acknowledgedCount: 0, acknowledged_ts: ackTs };
    row.is_acknowledge = true;
    row.acknowledged_ts = ackTs;
    return { id, acknowledgedCount: 1, acknowledged_ts: ackTs };
  }

  async deleteById(id: string): Promise<{ id: string; deletedCount: number }> {
    const deleted = this.rows.delete(id);
    return { id, deletedCount: deleted ? 1 : 0 };
  }

  async deleteByPattern(pattern = "*"): Promise<{ pattern: string; status: string; severity: string; deletedCount: number }> {
    const matcher = wildcardToRegExp(pattern);
    let deletedCount = 0;
    for (const [id, row] of this.rows.entries()) {
      if (!matcher.test(row.event_path)) continue;
      this.rows.delete(id);
      deletedCount += 1;
    }
    return { pattern, status: "*", severity: "*", deletedCount };
  }

  async get(pattern = "*", _from?: string, _to?: string, status = "*"): Promise<EventRow[]> {
    const matcher = wildcardToRegExp(pattern);
    const rows: EventRow[] = [];
    for (const row of this.rows.values()) {
      if (!matcher.test(row.event_path)) continue;
      if (status !== "*" && row.status !== status) continue;
      rows.push({ ...row });
    }
    return rows;
  }

  async getById(id: string): Promise<EventRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async query(
    pattern = "*",
    from?: string,
    to?: string,
    status = "*"
  ): Promise<{ rows: EventRow[]; total: number; limit: number; offset: number; sortBy: string; sortDir: "ASC" | "DESC" }> {
    const rows = await this.get(pattern, from, to, status);
    return { rows, total: rows.length, limit: rows.length, offset: 0, sortBy: "start_ts", sortDir: "DESC" };
  }

  subscribe(listener: (meta: EventStoreChangeMeta) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
