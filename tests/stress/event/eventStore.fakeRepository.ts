import type { EventRow } from "../../../runtime/core/runtimeTypes";
import type {
  EventDeleteByPatternInput,
  EventQueryInput,
  EventQueryResult,
  EventStoreMeta,
  EventStoreRepository
} from "../../../runtime/event/EventContracts";
import {
  compareEventRows,
  matchesContextFilters,
  normalizeSeverity,
  normalizeSortBy,
  normalizeSortDir,
  normalizeStatus,
  parseIsoTs,
  toIsoTs,
  wildcardToRegExp
} from "../../../runtime/event/EventQuerySupport";

export interface FakeEventRepositoryOptions {
  initialRows?: EventRow[];
  failLoadOpenRowsTimes?: number;
  artificialDelayMs?: number;
  meta?: Partial<Omit<EventStoreMeta, "openEventCache">>;
}

function cloneRow(row: EventRow): EventRow {
  return {
    ...row,
    context: { ...(row.context || {}) },
    event_metadata: row.event_metadata ? { ...row.event_metadata } : null
  };
}

function toDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeEventStoreRepository implements EventStoreRepository {
  private readonly rows = new Map<string, EventRow>();
  private readonly meta: Omit<EventStoreMeta, "openEventCache">;
  private failLoadOpenRowsTimes: number;
  private readonly artificialDelayMs: number;
  readonly stats = {
    loadOpenRowsCalls: 0,
    insertOpenEventCalls: 0,
    closeByPatternCalls: 0,
    closeByIdCalls: 0,
    acknowledgeByIdCalls: 0,
    deleteByIdCalls: 0,
    deleteByPatternCalls: 0,
    queryCalls: 0,
    getByIdCalls: 0
  };

  constructor(options: FakeEventRepositoryOptions = {}) {
    this.meta = {
      engine: "postgresql",
      database: options.meta?.database || "fake_event_db",
      schema: options.meta?.schema || "public",
      table: options.meta?.table || "af_event"
    };
    this.failLoadOpenRowsTimes = Math.max(0, options.failLoadOpenRowsTimes ?? 0);
    this.artificialDelayMs = Math.max(0, options.artificialDelayMs ?? 0);
    for (const row of options.initialRows || []) {
      this.rows.set(row.id, cloneRow(row));
    }
  }

  getMeta(): Omit<EventStoreMeta, "openEventCache"> {
    return { ...this.meta };
  }

  async loadOpenRows(): Promise<EventRow[]> {
    this.stats.loadOpenRowsCalls += 1;
    await toDelay(this.artificialDelayMs);
    if (this.failLoadOpenRowsTimes > 0) {
      this.failLoadOpenRowsTimes -= 1;
      throw new Error("Fake loadOpenRows failure");
    }
    return this.getRowsByStatus("open");
  }

  async insertOpenEvent(input: {
    id: string;
    eventPath: string;
    ts?: string;
    startTs: string;
    context?: Record<string, unknown>;
    notesOnOpen?: string;
    severity?: string;
    normalizedSeverity: EventRow["severity"];
    capturedDataOnOpen?: unknown | null;
    eventMetadata?: Record<string, unknown> | null;
  }): Promise<EventRow> {
    this.stats.insertOpenEventCalls += 1;
    await toDelay(this.artificialDelayMs);
    const row: EventRow = {
      id: input.id,
      event_path: String(input.eventPath),
      start_ts: toIsoTs(input.startTs || input.ts),
      end_ts: null,
      status: "open",
      severity: normalizeSeverity(input.normalizedSeverity || input.severity || "other"),
      context: input.context && typeof input.context === "object" ? { ...input.context } : {},
      is_acknowledge: false,
      acknowledged_ts: null,
      notes_on_open: input.notesOnOpen == null ? null : String(input.notesOnOpen),
      notes_on_close: null,
      event_metadata: input.eventMetadata && typeof input.eventMetadata === "object" ? { ...input.eventMetadata } : null,
      captured_data_on_open: input.capturedDataOnOpen === undefined ? null : input.capturedDataOnOpen,
      captured_data_on_close: null
    };
    this.rows.set(row.id, cloneRow(row));
    return cloneRow(row);
  }

  async closeByPattern(input: {
    pattern?: string;
    ts: string;
    notesOnClose: string | null;
    capturedDataOnClose: unknown | null;
  }): Promise<EventRow[]> {
    this.stats.closeByPatternCalls += 1;
    await toDelay(this.artificialDelayMs);
    const matcher = wildcardToRegExp(input.pattern || "*");
    const ts = toIsoTs(input.ts);
    const changed: EventRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== "open") continue;
      if (!matcher.test(row.event_path)) continue;
      const next: EventRow = {
        ...row,
        end_ts: ts,
        status: "closed",
        notes_on_close: input.notesOnClose,
        captured_data_on_close: input.capturedDataOnClose
      };
      this.rows.set(next.id, cloneRow(next));
      changed.push(cloneRow(next));
    }
    return changed;
  }

  async closeById(input: { id: string; ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null }): Promise<EventRow[]> {
    this.stats.closeByIdCalls += 1;
    await toDelay(this.artificialDelayMs);
    const current = this.rows.get(input.id);
    if (!current || current.status !== "open") return [];
    const next: EventRow = {
      ...current,
      end_ts: toIsoTs(input.ts),
      status: "closed",
      notes_on_close: input.notesOnClose,
      captured_data_on_close: input.capturedDataOnClose
    };
    this.rows.set(next.id, cloneRow(next));
    return [cloneRow(next)];
  }

  async acknowledgeById(input: { id: string; ts: string }): Promise<number> {
    this.stats.acknowledgeByIdCalls += 1;
    await toDelay(this.artificialDelayMs);
    const current = this.rows.get(input.id);
    if (!current) return 0;
    const next: EventRow = {
      ...current,
      is_acknowledge: true,
      acknowledged_ts: toIsoTs(input.ts)
    };
    this.rows.set(next.id, cloneRow(next));
    return 1;
  }

  async deleteById(id: string): Promise<number> {
    this.stats.deleteByIdCalls += 1;
    await toDelay(this.artificialDelayMs);
    return this.rows.delete(String(id)) ? 1 : 0;
  }

  async deleteByPattern(input: EventDeleteByPatternInput): Promise<number> {
    this.stats.deleteByPatternCalls += 1;
    await toDelay(this.artificialDelayMs);
    const rows = this.filterRows({
      pattern: input.pattern ?? "*",
      from: input.from ?? "*",
      to: input.to ?? "*",
      status: input.status ?? "*",
      severity: input.severity ?? "*",
      contextFilters: {},
      options: {}
    });
    for (const row of rows) {
      this.rows.delete(row.id);
    }
    return rows.length;
  }

  async query(
    input: Required<Pick<EventQueryInput, "pattern" | "from" | "to" | "status" | "contextFilters">> & { options: Record<string, unknown> }
  ): Promise<EventQueryResult> {
    this.stats.queryCalls += 1;
    await toDelay(this.artificialDelayMs);
    const rows = this.filterRows({
      pattern: input.pattern,
      from: input.from,
      to: input.to,
      status: input.status,
      severity: input.options?.severity,
      contextFilters: input.contextFilters,
      options: input.options
    });

    const sortBy = normalizeSortBy(input.options?.sortBy || "start_ts");
    const sortDir = normalizeSortDir(input.options?.sortDir || input.options?.sort || "desc");
    const limitRaw = Number(input.options?.limit ?? 200);
    const offsetRaw = Number(input.options?.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    rows.sort((left, right) => compareEventRows(left, right, sortBy, sortDir));
    return {
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      limit,
      offset,
      sortBy,
      sortDir
    };
  }

  async getById(id: string): Promise<EventRow | null> {
    this.stats.getByIdCalls += 1;
    await toDelay(this.artificialDelayMs);
    const row = this.rows.get(String(id));
    return row ? cloneRow(row) : null;
  }

  snapshot(): EventRow[] {
    return Array.from(this.rows.values()).map(cloneRow);
  }

  private getRowsByStatus(status: EventRow["status"]): EventRow[] {
    return Array.from(this.rows.values())
      .filter((row) => row.status === status)
      .map(cloneRow);
  }

  private filterRows(input: {
    pattern: unknown;
    from: unknown;
    to: unknown;
    status: unknown;
    severity: unknown;
    contextFilters: unknown;
    options: Record<string, unknown>;
  }): EventRow[] {
    const matcher = wildcardToRegExp(input.pattern ?? "*");
    const fromTs = parseIsoTs(input.from, null);
    const toTs = parseIsoTs(input.to, null);
    const normalizedStatus = normalizeStatus(input.status ?? "*");
    const severity = input.severity && input.severity !== "*" ? normalizeSeverity(input.severity) : null;

    return Array.from(this.rows.values())
      .filter((row) => {
        if (!matcher.test(row.event_path)) return false;
        if (normalizedStatus !== "*" && row.status !== normalizedStatus) return false;
        if (severity && row.severity !== severity) return false;
        if (fromTs && row.start_ts < fromTs) return false;
        if (toTs && row.start_ts > toTs) return false;
        if (!matchesContextFilters(row, input.contextFilters)) return false;
        return true;
      })
      .map(cloneRow);
  }
}
