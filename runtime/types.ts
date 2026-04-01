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
  getValue(path: string, defaultValue?: unknown): unknown;
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
  getValue<T = unknown>(path: string, defaultValue?: T): T;
  getAll(path: string): AttributeQueryMatch[];
  set(path: string, value: unknown): Promise<AttributeQueryMatch[]>;
  setMany(items: Array<{ path: string; value: unknown }>): Promise<Array<{
    path: string;
    count: number;
    matches: AttributeQueryMatch[];
  }>>;
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
  event_metadata: Record<string, unknown> | null;
  captured_data_on_open: unknown | null;
  captured_data_on_close: unknown | null;
}

export interface EventStoreChangeMeta {
  type: "open" | "close" | "closeById" | "acknowledgeById" | "deleteById" | "deleteByPattern";
  ts: string;
  pattern?: string;
  id?: string;
  row?: EventRow;
  rows?: EventRow[];
  count?: number;
}

export interface EventTemplateBinding {
  source: "variable" | "static" | "attribute";
  key?: string;
  value?: unknown;
  pathTemplate?: string;
}

export interface EventTemplateTimeSource {
  source: "now" | "variable" | "asset_path_attribute";
  key?: string;
  assetPathId?: string;
  attributeName?: string;
}

export interface EventTemplatePathSegment {
  type: "static" | "binding" | "asset_path" | "variable" | "context_field" | "captured_value" | "wildcard";
  value?: string;
  separator?: "" | "/" | "." | "-";
}

export type EventTemplateConcurrencyMode = "parallel" | "unique_exact_path" | "unique_pattern";

export interface EventTemplateInputBinding {
  name: string;
  source: "asset" | "attribute" | "msg_path" | "static_number" | "static_string" | "static_boolean" | "static_array" | "static_object";
  templateId?: string;
  defaultValue?: unknown;
}

export interface EventTemplateAssetPath {
  id: string;
  source: "variable" | "static";
  key?: string;
  value?: string;
  templateId?: string;
}

export interface EventTemplateField {
  key: string;
  source: "variable" | "static" | "asset_path_attribute" | "captured_value";
  variableKey?: string;
  value?: unknown;
  assetPathId?: string;
  attributeName?: string;
  capturedKey?: string;
}

export interface EventTemplateDefinition {
  id: string;
  enabled?: boolean;
  allowParallel?: boolean;
  concurrencyMode?: EventTemplateConcurrencyMode;
  eventPathTemplate: string;
  closePatternTemplate?: string;
  eventPathBuilder?: EventTemplatePathSegment[];
  closePatternBuilder?: EventTemplatePathSegment[];
  uniquePatternTemplate?: string;
  uniquePatternBuilder?: EventTemplatePathSegment[];
  closeOnOpenPatterns?: string[];
  closeOnOpenPatternBuilders?: EventTemplatePathSegment[][];
  requiredParentPattern?: string;
  requiredParentBuilder?: EventTemplatePathSegment[];
  closeChildrenOnClosePatterns?: string[];
  closeChildrenOnClosePatternBuilders?: EventTemplatePathSegment[][];
  bindings?: EventTemplateInputBinding[];
  severity?: string;
  assetPaths?: EventTemplateAssetPath[];
  snapshotTemplateId?: string;
  contextBindings?: Record<string, EventTemplateBinding>;
  contextFields?: EventTemplateField[];
  timeSource?: {
    open?: EventTemplateTimeSource;
    close?: EventTemplateTimeSource;
  };
  capture?: {
    onOpen?: boolean;
    onClose?: boolean;
  };
  captureFields?: EventTemplateField[];
}

export interface EventActionBinding {
  source: "asset" | "attribute" | "flow_variable" | "msg_path" | "static_number" | "static_string" | "static_boolean" | "static_array" | "static_object";
  staticValue?: unknown;
  attributePath?: string;
}

export interface EventActionDefinition {
  id: string;
  enabled?: boolean;
  label?: string;
  description?: string;
  templateId?: string;
  templateOverrides?: Record<string, unknown>;
  bindings?: Record<string, EventActionBinding>;
  openNotes?: string;
  closeNotes?: string;
}

export interface EventTemplateMetadata {
  id: string;
  eventPath: string;
  closePattern: string;
  assetPath: string;
  assetPaths?: Record<string, string>;
  vars: Record<string, unknown>;
  closeTimeSource?: EventTemplateTimeSource | null;
  parent_event_id?: string | null;
  policy?: {
    concurrencyMode?: EventTemplateConcurrencyMode;
    uniquePattern?: string;
    requiredParentPattern?: string;
    closeOnOpenPatterns?: string[];
    closeChildrenOnClosePatterns?: string[];
  };
}

export interface EventTemplateOpenOptions {
  vars?: Record<string, unknown>;
  context?: Record<string, unknown>;
  notes?: string;
  severity?: string;
  ts?: string;
  capturedDataOnOpen?: unknown | null;
  templateOverrides?: Partial<EventTemplateDefinition>;
}

export interface EventTemplateCloseOptions {
  id?: string;
  vars?: Record<string, unknown>;
  pattern?: string;
  context?: Record<string, unknown>;
  notes?: string;
  severity?: string;
  ts?: string;
  capturedDataOnClose?: unknown | null;
  templateOverrides?: Partial<EventTemplateDefinition>;
}

export interface RuntimeEventApi {
  open(
    eventPath: string,
    ts?: string,
    context?: Record<string, unknown>,
    notes?: string,
    severity?: string,
    capturedDataOnOpen?: unknown | null,
    eventMetadata?: Record<string, unknown> | null
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
  getEarliestTs(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<string | null>;
  getLatestTs(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<string | null>;
  getRange(
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ start_ts: string | null; end_ts: string | null; count: number }>;
  openTemplate(templateId: string, options?: EventTemplateOpenOptions): Promise<EventRow>;
  closeTemplate(
    templateId: string,
    options?: EventTemplateCloseOptions
  ): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; rows: EventRow[] }>;
}

export interface RuntimeDbApi {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
  executeSafe(sql: string): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
  testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number }>;
}

export interface RuntimeNodeContext {
  nodeId: string;
  global: RuntimeGlobalApi;
  asset: RuntimeAssetApi;
  eventSys: RuntimeEventApi;
  db: RuntimeDbApi;
  flow?: {
    id: string;
    name: string;
    variables: Record<string, unknown>;
  };
}

export type RuntimeNodeHandler = (
  msg: RuntimeMessage,
  send: (msgOrPorts: RuntimeMessage | string[] | number[], msgOrPort?: RuntimeMessage | string, maybePort?: string) => void,
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
    capturedDataOnOpen?: unknown | null,
    eventMetadata?: Record<string, unknown> | null
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
  getById(id: string): Promise<EventRow | null>;
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
  subscribe(listener: (meta: EventStoreChangeMeta) => void): () => void;
  shutdown?(): Promise<void>;
}

export interface ProgramDefinition {
  assets?: unknown;
  scriptTemplates?: unknown[];
  triggerTemplates?: unknown[];
  activeFlowId?: unknown;
  flowDefinitions?: unknown[];
  flows?: { id?: unknown; name?: unknown; enabled?: unknown; variables?: unknown; nodes?: unknown[]; links?: unknown[]; nodePositions?: unknown };
  triggers?: unknown[];
  eventTemplates?: unknown[];
}
