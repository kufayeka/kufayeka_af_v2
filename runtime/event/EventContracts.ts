import type Runtime from "../Runtime";
import type { EventRow, EventStore, EventStoreChangeMeta, EventTemplateDefinition } from "../core/runtimeTypes";

export interface EventStoreMeta {
  engine: "postgresql";
  database: string;
  schema: string;
  table: string;
  openEventCache: {
    enabled: true;
    warm: boolean;
    openCount: number;
    lastWarmupAt: string | null;
  };
}

export interface EventQueryOptions {
  limit?: unknown;
  offset?: unknown;
  sortBy?: unknown;
  sortDir?: unknown;
  sort?: unknown;
  severity?: unknown;
}

export interface EventQueryInput {
  pattern?: unknown;
  from?: unknown;
  to?: unknown;
  status?: unknown;
  contextFilters?: unknown;
  options?: EventQueryOptions;
}

export interface EventQueryResult {
  rows: EventRow[];
  total: number;
  limit: number;
  offset: number;
  sortBy: string;
  sortDir: "ASC" | "DESC";
}

export interface EventOpenInput {
  eventPath: string;
  ts?: string;
  context?: Record<string, unknown>;
  notesOnOpen?: string;
  severity?: string;
  capturedDataOnOpen?: unknown | null;
  eventMetadata?: Record<string, unknown> | null;
}

export interface EventCloseInput {
  pattern?: string;
  ts?: string;
  notesOnClose?: string;
  capturedDataOnClose?: unknown | null;
}

export interface EventCloseByIdInput {
  id: string;
  ts?: string;
  notesOnClose?: string;
  capturedDataOnClose?: unknown | null;
}

export interface EventDeleteByPatternInput {
  pattern?: string;
  status?: string;
  from?: string;
  to?: string;
  severity?: string;
}

export interface EventAcknowledgeByIdInput {
  id: string;
  ts?: string;
}

export interface EventStoreRepository {
  getMeta(): Omit<EventStoreMeta, "openEventCache">;
  loadOpenRows(): Promise<EventRow[]>;
  insertOpenEvent(input: EventOpenInput & { id: string; startTs: string; normalizedSeverity: EventRow["severity"] }): Promise<EventRow>;
  closeByPattern(input: { pattern?: string; ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null }): Promise<EventRow[]>;
  closeById(input: { id: string; ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null }): Promise<EventRow[]>;
  acknowledgeById(input: { id: string; ts: string }): Promise<number>;
  deleteById(id: string): Promise<number>;
  deleteByPattern(input: EventDeleteByPatternInput): Promise<number>;
  query(input: Required<Pick<EventQueryInput, "pattern" | "from" | "to" | "status" | "contextFilters">> & { options: Record<string, unknown> }): Promise<EventQueryResult>;
  getById(id: string): Promise<EventRow | null>;
}

export interface EventOpenCachePort {
  clear(): void;
  replaceAll(rows: EventRow[]): void;
  attach(row: EventRow): void;
  detach(row: EventRow | null | undefined): void;
  update(row: EventRow | null | undefined): void;
  getById(id: string): EventRow | null;
  query(pattern?: string, from?: string, to?: string, contextFilters?: unknown, options?: Record<string, unknown>): EventQueryResult;
  readonly size: number;
  isWarm(): boolean;
  getLastWarmupAt(): string | null;
}

export type EventStoreListener = (meta: EventStoreChangeMeta) => void;

export interface EventDomainServiceContract {
  bindRuntime(runtime: Runtime): void;
  initializeStore(): EventStore;
  getStore(): EventStore | null;
  setTemplates(definitions: unknown[]): EventTemplateDefinition[];
  getTemplates(): EventTemplateDefinition[];
  getMeta(): EventStoreMeta | null;
}
