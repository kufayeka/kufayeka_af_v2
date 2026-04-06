import { randomUUID } from "node:crypto";
import type { EventRow, EventStore, EventStoreChangeMeta } from "../../core/runtimeTypes";
import type { EventCloseByIdInput, EventDeleteByPatternInput, EventOpenCachePort, EventOpenInput, EventQueryInput, EventStoreListener, EventStoreMeta, EventStoreRepository } from "../EventContracts";
import { normalizeSeverity, normalizeStatus, toIsoTs } from "../EventQuerySupport";

export class EventStoreService implements EventStore {
  private readonly repository: EventStoreRepository;
  private readonly openEventCache: EventOpenCachePort;
  private readonly listeners = new Set<EventStoreListener>();
  private openRowsWarmupPromise: Promise<void> | null = null;

  constructor(repository: EventStoreRepository, openEventCache: EventOpenCachePort) {
    this.repository = repository;
    this.openEventCache = openEventCache;
    void this.ensureOpenRowsWarm().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[eventStore] open-events warmup failed:", message);
    });
  }

  getMeta(): EventStoreMeta {
    return {
      ...this.repository.getMeta(),
      openEventCache: {
        enabled: true,
        warm: this.openEventCache.isWarm(),
        openCount: this.openEventCache.size,
        lastWarmupAt: this.openEventCache.getLastWarmupAt()
      }
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
    const normalizedPath = String(eventPath || "").trim();
    if (!normalizedPath) throw new Error("event_path is required");

    const mapped = await this.repository.insertOpenEvent({
      id: randomUUID(),
      eventPath: normalizedPath,
      ts,
      startTs: toIsoTs(ts),
      context: context && typeof context === "object" ? context : {},
      notesOnOpen,
      severity,
      normalizedSeverity: normalizeSeverity(severity),
      capturedDataOnOpen: capturedDataOnOpen === undefined ? null : capturedDataOnOpen,
      eventMetadata: eventMetadata && typeof eventMetadata === "object" ? eventMetadata : null
    });
    this.openEventCache.attach(mapped);
    this.emitChange({ type: "open", row: mapped, rows: [mapped], count: 1 });
    return mapped;
  }

  async close(pattern = "*", ts?: string, notesOnClose = "", capturedDataOnClose: unknown | null = null) {
    const normalizedTs = toIsoTs(ts);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const normalizedCapturedOnClose = capturedDataOnClose === undefined ? null : capturedDataOnClose;
    const rows = await this.repository.closeByPattern({
      pattern,
      ts: normalizedTs,
      notesOnClose: normalizedNotes,
      capturedDataOnClose: normalizedCapturedOnClose
    });
    if (rows.length > 0) {
      rows.forEach((row) => this.openEventCache.detach(row));
      this.emitChange({ type: "close", pattern: String(pattern || "*"), rows, count: rows.length });
    }
    return {
      pattern: String(pattern || "*"),
      closedCount: rows.length,
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
      captured_data_on_close: normalizedCapturedOnClose
    };
  }

  async closeById(id: string, ts?: string, notesOnClose = "", capturedDataOnClose: unknown | null = null) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const normalizedTs = toIsoTs(ts);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const normalizedCapturedOnClose = capturedDataOnClose === undefined ? null : capturedDataOnClose;
    const rows = await this.repository.closeById({
      id: normalizedId,
      ts: normalizedTs,
      notesOnClose: normalizedNotes,
      capturedDataOnClose: normalizedCapturedOnClose
    } as EventCloseByIdInput & { ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null });
    if (rows.length > 0) {
      rows.forEach((row) => this.openEventCache.detach(row));
      this.emitChange({ type: "closeById", id: normalizedId, rows, row: rows[0], count: rows.length });
    }
    return {
      id: normalizedId,
      closedCount: rows.length,
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
      captured_data_on_close: normalizedCapturedOnClose
    };
  }

  async acknowledgeById(id: string, ts?: string) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const normalizedTs = toIsoTs(ts);
    const count = await this.repository.acknowledgeById({ id: normalizedId, ts: normalizedTs });
    if (count > 0) {
      const current = this.openEventCache.getById(normalizedId);
      if (current) {
        this.openEventCache.update({
          ...current,
          is_acknowledge: true,
          acknowledged_ts: normalizedTs
        });
      }
      this.emitChange({ type: "acknowledgeById", id: normalizedId, count });
    }
    return { id: normalizedId, acknowledgedCount: count, acknowledged_ts: normalizedTs };
  }

  async deleteById(id: string) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const existingOpenRow = this.openEventCache.getById(normalizedId);
    const deletedCount = await this.repository.deleteById(normalizedId);
    if (deletedCount > 0) {
      this.openEventCache.detach(existingOpenRow);
      this.emitChange({ type: "deleteById", id: normalizedId, count: deletedCount });
    }
    return { id: normalizedId, deletedCount };
  }

  async deleteByPattern(pattern = "*", status = "*", from = "*", to = "*", severity = "*") {
    const normalizedStatus = normalizeStatus(status || "*");
    const shouldDetachOpenRows = normalizedStatus === "open" || normalizedStatus === "*";
    const rowsToDetach = shouldDetachOpenRows ? await this.get(pattern, from, to, "open", {}, { limit: 5000, severity }) : [];
    const deletedCount = await this.repository.deleteByPattern({ pattern, status, from, to, severity } as EventDeleteByPatternInput);
    if (deletedCount > 0) {
      rowsToDetach.forEach((row) => this.openEventCache.detach(row));
      this.emitChange({ type: "deleteByPattern", pattern: String(pattern || "*"), count: deletedCount });
    }
    return { pattern: String(pattern || "*"), status: normalizedStatus, severity: String(severity || "*"), deletedCount };
  }

  async query(pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) {
    const normalizedStatus = normalizeStatus(status || "*");
    if (normalizedStatus === "open") {
      await this.ensureOpenRowsWarm();
      return this.openEventCache.query(pattern, from, to, contextFilters, options || {});
    }
    return this.repository.query({
      pattern,
      from,
      to,
      status,
      contextFilters,
      options
    } as Required<Pick<EventQueryInput, "pattern" | "from" | "to" | "status" | "contextFilters">> & { options: Record<string, unknown> });
  }

  async get(pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) {
    return (await this.query(pattern, from, to, status, contextFilters, options)).rows;
  }

  async getById(id: string): Promise<EventRow | null> {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    await this.ensureOpenRowsWarm();
    const cached = this.openEventCache.getById(normalizedId);
    if (cached) return cached;
    return this.repository.getById(normalizedId);
  }

  subscribe(listener: EventStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {}

  private async ensureOpenRowsWarm(): Promise<void> {
    if (!this.openRowsWarmupPromise) {
      this.openRowsWarmupPromise = (async () => {
        const rows = await this.repository.loadOpenRows();
        this.openEventCache.replaceAll(rows);
        console.info(`[eventStore] open-events cache warmed with ${this.openEventCache.size} row(s)`);
      })().catch((error) => {
        this.openRowsWarmupPromise = null;
        this.openEventCache.clear();
        throw error;
      });
    }
    await this.openRowsWarmupPromise;
  }

  private emitChange(meta: Omit<EventStoreChangeMeta, "ts">): void {
    if (this.listeners.size === 0) return;
    const payload: EventStoreChangeMeta = { ...meta, ts: new Date().toISOString() };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[eventStore] subscriber error:", message);
      }
    }
  }
}
