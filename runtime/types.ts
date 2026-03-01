export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ValueType =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64"
  | "boolean"
  | "string"
  | "array"
  | "object";

export interface HistorianTarget {
  id: string;
  name: string;
  timestampUnit: "us" | "ns";
  enabled: boolean;
}

export interface AssetAttributeTemplate {
  enabled: boolean;
  name: string;
  valueType: ValueType;
  default?: unknown;
  unit: string;
  historianEnabled: boolean;
  historianTimeSourcePath: string;
  historianTargetId: string;
  dashboardVisible: boolean;
  dashboardEditable: boolean;
  nullable: boolean;
  inputType: string;
  options: unknown[];
  optionsScript: string;
  numberMin: number | null;
  numberMax: number | null;
  numberAllowNegative: boolean;
  numberUseThousandSeparator: boolean;
  numberPrefix: string;
  numberSuffix: string;
  numberAllowDecimal: boolean;
  numberPrecision: number;
}

export interface AttributeTemplate {
  id: string;
  name: string;
  attributes: AssetAttributeTemplate[];
}

export interface AssetAttributeValue {
  value: unknown;
  ts?: string;
}

export interface AssetDefinition {
  id: string;
  name: string;
  parentId: string | null;
  templateIds: string[];
  attributes: Record<string, unknown | AssetAttributeValue>;
}

export interface AssetSection {
  assets: AssetDefinition[];
  attributeTemplates: AttributeTemplate[];
  historians: HistorianTarget[];
}

export interface AssetChangeMeta {
  revision: number;
  updatedAt: string;
  change: {
    type: "state.replace" | "attribute.set";
    pattern?: string;
    changes: AttributeQueryMatch[];
  };
}

export interface AssetSnapshot {
  state: AssetSection;
  revision: number;
  updatedAt: string;
}

export interface AssetQueryMatchBase {
  path: string;
  assetId: string;
}

export interface AssetQueryMatch extends AssetQueryMatchBase {
  kind: "asset";
  value: AssetDefinition;
}

export interface AttributeQueryMatch extends AssetQueryMatchBase {
  kind: "attribute";
  attributeName: string;
  value: unknown;
  ts?: string;
  type: string;
  unit: string;
  historianEnabled: boolean;
  historianTimeSourcePath: string;
  historianTargetId: string;
}

export type QueryMatch = AssetQueryMatch | AttributeQueryMatch;

export interface AssetHierarchyNode {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  templateIds: string[];
  attributes: Record<string, unknown | AssetAttributeValue>;
  children: AssetHierarchyNode[];
  effectiveAttributes?: Array<{
    name: string;
    value: unknown;
    valueType: string;
    unit: string;
    ts?: string;
    historianEnabled: boolean;
    historianTimeSourcePath: string;
    historianTargetId: string;
    source: "override" | "template";
  }>;
}

export interface FindAttributesResult {
  path: string;
  expectedValue: unknown;
  strict: boolean;
  count: number;
  assetCount: number;
  matches: AttributeQueryMatch[];
  assets: Array<{ assetId: string; path: string }>;
}

export interface AssetStore {
  getState(): AssetSection;
  getSnapshot(): AssetSnapshot;
  getRevision(): number;
  getUpdatedAt(): string;
  subscribe(listener: (state: AssetSection, meta: AssetChangeMeta) => void): () => void;
  replace(nextState: unknown): AssetSection;
  query(path: string): QueryMatch[];
  getAttribute(path: string, defaultValue?: unknown): unknown;
  getAttributes(path: string): AttributeQueryMatch[];
  setAttribute(path: string, value: unknown): AttributeQueryMatch[];
  setAttributes(items: Array<{ path: string; value: unknown }>): Array<{
    path: string;
    count: number;
    matches: AttributeQueryMatch[];
  }>;
  findAttributesByValue(path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult;
  getHierarchy(options?: { populateAttributes?: boolean }): AssetHierarchyNode[];
}

export interface RuntimeMessage {
  id: string;
  ts: string;
  payload?: unknown;
  [key: string]: unknown;
}

export interface RuntimeGlobalApi {
  get<T = unknown>(key: string, defaultValue?: T): T;
  set<T = unknown>(key: string, value: T): T;
  has(key: string): boolean;
  delete(key: string): boolean;
}

export interface RuntimeAssetApi {
  query(path: string): QueryMatch[];
  get<T = unknown>(path: string, defaultValue?: T): T;
  getAll(path: string): AttributeQueryMatch[];
  set(path: string, value: unknown): AttributeQueryMatch[];
  setMany(items: Array<{ path: string; value: unknown }>): Array<{
    path: string;
    count: number;
    matches: AttributeQueryMatch[];
  }>;
  findByValue(path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult;
  find(path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult;
  hierarchy(options?: { populateAttributes?: boolean }): AssetHierarchyNode[];
}

export interface EventRow {
  id: string;
  event_path: string;
  start_ts: string;
  end_ts: string | null;
  status: "open" | "closed";
  severity: "other" | "info" | "low" | "medium" | "high" | "critical";
  context: Record<string, unknown>;
  is_acknowledge: boolean;
  acknowledged_ts: string | null;
  notes_on_open: string | null;
  notes_on_close: string | null;
  captured_data_on_open: unknown | null;
  captured_data_on_close: unknown | null;
}

export interface RuntimeEventApi {
  open(
    eventPath: string,
    ts?: string,
    context?: Record<string, unknown>,
    notes?: string,
    severity?: string,
    capturedDataOnOpen?: unknown | null
  ): Promise<EventRow>;
  close(
    pattern?: string,
    ts?: string,
    notes?: string,
    capturedDataOnClose?: unknown | null
  ): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; captured_data_on_close: unknown | null }>;
  get(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<EventRow[]>;
}

export interface RuntimeNodeContext {
  nodeId: string;
  global: RuntimeGlobalApi;
  asset: RuntimeAssetApi;
  eventSys: RuntimeEventApi;
}

export type RuntimeNodeHandler = (
  msg: RuntimeMessage,
  send: (msg: RuntimeMessage) => void,
  context: RuntimeNodeContext
) => Promise<void> | void;

export interface EventStore {
  getMeta(): {
    engine: "postgresql";
    database: string;
    schema: string;
    table: string;
  };
  open(
    eventPath: string,
    ts?: string,
    context?: Record<string, unknown>,
    notesOnOpen?: string,
    severity?: string,
    capturedDataOnOpen?: unknown | null
  ): Promise<EventRow>;
  close(
    pattern?: string,
    ts?: string,
    notesOnClose?: string,
    capturedDataOnClose?: unknown | null
  ): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; captured_data_on_close: unknown | null }>;
  closeById(
    id: string,
    ts?: string,
    notesOnClose?: string,
    capturedDataOnClose?: unknown | null
  ): Promise<{ id: string; closedCount: number; ts: string; notes_on_close: string | null; captured_data_on_close: unknown | null }>;
  acknowledgeById(id: string, ts?: string): Promise<{ id: string; acknowledgedCount: number; acknowledged_ts: string }>;
  deleteById(id: string): Promise<{ id: string; deletedCount: number }>;
  deleteByPattern(pattern?: string, status?: string, from?: string, to?: string, severity?: string): Promise<{
    pattern: string;
    status: string;
    severity: string;
    deletedCount: number;
  }>;
  get(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<EventRow[]>;
  query(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{
    rows: EventRow[];
    total: number;
    limit: number;
    offset: number;
    sortBy: string;
    sortDir: "ASC" | "DESC";
  }>;
  shutdown?(): Promise<void>;
}

export interface ProgramDefinition {
  assets?: unknown;
  scriptTemplates?: unknown[];
  actions?: unknown[];
  flows?: { links?: unknown[] };
  triggers?: unknown[];
}
