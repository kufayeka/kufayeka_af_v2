export type TriggerType =
  | "interval"
  | "cron"
  | "watcher_set"
  | "watcher_valuechange"
  | "watcher_event_falling"
  | "watcher_event_open"
  | "watcher_event_close";
export type TriggerTemplateType =
  | "interval"
  | "watcher_set"
  | "watcher_valuechange"
  | "watcher_event_open"
  | "watcher_event_close";
export type AssetAttributeType =
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
export type ScriptBindingSource =
  | "asset"
  | "attribute"
  | "flow_variable"
  | "msg_path"
  | "static_number"
  | "static_string"
  | "static_boolean"
  | "static_array"
  | "static_object";
export type EventTemplateBindingSource = "variable" | "static" | "attribute";
export type EventTemplateTimeSourceType = "now" | "variable" | "asset_path_attribute";
export type EventTemplateFieldSource = "variable" | "static" | "asset_path_attribute" | "captured_value";
export type EventTemplatePathSegmentType = "static" | "binding" | "asset_path" | "variable" | "context_field" | "captured_value" | "wildcard";
export type EventTemplatePathSegmentSeparator = "" | "/" | "." | "-";
export type EventTemplateConcurrencyMode = "parallel" | "unique_exact_path" | "unique_pattern";

export interface AssetTemplateAttributeDefinition {
  enabled?: boolean;
  name: string;
  valueType: AssetAttributeType;
  default: unknown;
  unit?: string;
  historianEnabled?: boolean;
  historianTimeSourcePath?: string;
  historianTargetId?: string;
}

export interface AssetAttributeTemplateDefinition {
  id: string;
  name: string;
  attributes: AssetTemplateAttributeDefinition[];
}

export interface AssetAttributeValue {
  value: unknown;
  ts?: string;
  quality?: string;
}

export interface AssetDefinition {
  id: string;
  name: string;
  parentId: string | null;
  templateIds: string[];
  attributes: Record<string, AssetAttributeValue>;
}

export interface AssetFrameworkDefinition {
  assets: AssetDefinition[];
  attributeTemplates: AssetAttributeTemplateDefinition[];
  historians?: HistorianTargetDefinition[];
}

export interface HistorianTargetDefinition {
  id: string;
  name: string;
  timestampUnit: "us" | "ns";
  enabled?: boolean;
}

export interface TriggerDefinition {
  id: string;
  label?: string;
  type: TriggerType;
  enabled: boolean;
  intervalMs: number;
  cronExpression?: string;
  timezone?: string;
  activeFrom?: string;
  activeTo?: string;
  watchPath?: string;
  message: {
    payload?: unknown;
    [key: string]: unknown;
  };
}

export interface TriggerTemplateDefinition {
  id: string;
  name: string;
  description?: string;
  type: TriggerTemplateType;
  enabled: boolean;
  intervalMs: number;
  activeFrom?: string;
  activeTo?: string;
  watchPath?: string;
  message: {
    payload?: unknown;
    [key: string]: unknown;
  };
}

export interface ScriptNodeSummary {
  id: string;
  label?: string;
  enabled: boolean;
  description?: string;
  templateId?: string;
  eventTemplateId?: string;
  eventTemplateOverrides?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, ScriptVariableBindingDefinition>;
  script: string;
}

export interface EventActionBindingDefinition {
  source: ScriptBindingSource;
  staticValue?: unknown;
  attributePath?: string;
}

export interface EventNodeSummary {
  id: string;
  label?: string;
  enabled: boolean;
  description?: string;
  templateId?: string;
  templateOverrides?: Record<string, unknown>;
  bindings?: Record<string, EventActionBindingDefinition>;
  openNotes?: string;
  closeNotes?: string;
}

export interface EventTemplateBindingDefinition {
  source: EventTemplateBindingSource;
  key?: string;
  value?: unknown;
  pathTemplate?: string;
}

export interface EventTemplateAssetPathDefinition {
  id: string;
  source: "variable" | "static";
  key?: string;
  value?: string;
  templateId?: string;
}

export interface EventTemplateFieldDefinition {
  key: string;
  source: EventTemplateFieldSource;
  variableKey?: string;
  value?: unknown;
  assetPathId?: string;
  attributeName?: string;
  capturedKey?: string;
}

export interface EventTemplateTimeSourceDefinition {
  source: EventTemplateTimeSourceType;
  key?: string;
  assetPathId?: string;
  attributeName?: string;
}

export interface EventTemplatePathSegmentDefinition {
  type: EventTemplatePathSegmentType;
  value?: string;
  separator?: EventTemplatePathSegmentSeparator;
}

export interface EventTemplateInputBindingDefinition {
  name: string;
  source: ScriptBindingSource;
  templateId?: string;
  defaultValue?: unknown;
}

export interface EventTemplateDefinition {
  id: string;
  enabled?: boolean;
  allowParallel?: boolean;
  concurrencyMode?: EventTemplateConcurrencyMode;
  eventPathTemplate: string;
  closePatternTemplate?: string;
  eventPathBuilder?: EventTemplatePathSegmentDefinition[];
  closePatternBuilder?: EventTemplatePathSegmentDefinition[];
  uniquePatternTemplate?: string;
  uniquePatternBuilder?: EventTemplatePathSegmentDefinition[];
  closeOnOpenPatterns?: string[];
  closeOnOpenPatternBuilders?: EventTemplatePathSegmentDefinition[][];
  requiredParentPattern?: string;
  requiredParentBuilder?: EventTemplatePathSegmentDefinition[];
  closeChildrenOnClosePatterns?: string[];
  closeChildrenOnClosePatternBuilders?: EventTemplatePathSegmentDefinition[][];
  bindings?: EventTemplateInputBindingDefinition[];
  severity?: string;
  assetPaths?: EventTemplateAssetPathDefinition[];
  snapshotTemplateId?: string;
  contextBindings?: Record<string, EventTemplateBindingDefinition>;
  contextFields?: EventTemplateFieldDefinition[];
  timeSource?: {
    open?: EventTemplateTimeSourceDefinition;
    close?: EventTemplateTimeSourceDefinition;
  };
  capture?: {
    onOpen?: boolean;
    onClose?: boolean;
  };
  captureFields?: EventTemplateFieldDefinition[];
}

export interface ScriptVariableBindingDefinition {
  name: string;
  source: ScriptBindingSource;
  staticValue?: unknown;
  attributePath?: string;
  allowOverride?: boolean;
}

export interface ScriptOutputDefinition {
  name: string;
  order: number;
  description?: string;
}

export interface ScriptTemplateDefinition {
  id: string;
  name: string;
  description?: string;
  script: string;
  outputs?: ScriptOutputDefinition[];
  variableBindings?: ScriptVariableBindingDefinition[];
}

export interface FlowLink {
  from: string;
  to: string;
  fromPort?: string;
  enabled?: boolean;
}

export interface NodePosition {
  x: number;
  y: number;
}

export type FlowVariableSource = "static_string" | "static_number" | "static_boolean" | "static_array" | "static_object" | "asset" | "attribute";

export interface FlowVariableDefinition {
  name: string;
  order: number;
  description?: string;
  source: FlowVariableSource;
  staticValue?: unknown;
  attributePath?: string;
}

export type FlowNodeKind = "trigger" | "action" | "event_open" | "event_close";

export interface FlowNodeDefinition {
  id: string;
  kind: FlowNodeKind;
  refId: string;
  label?: string;
  subtitle?: string;
  enabled?: boolean;
  templateId?: string;
  config?: Record<string, unknown>;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  variables?: FlowVariableDefinition[];
  nodes?: FlowNodeDefinition[];
  links: FlowLink[];
  nodePositions?: Record<string, NodePosition>;
}

export interface Program {
  meta: {
    name: string;
    version: number;
  };
  activeFlowId?: string;
  flowDefinitions?: FlowDefinition[];
  eventTemplates?: EventTemplateDefinition[];
  triggerTemplates?: TriggerTemplateDefinition[];
  triggers: TriggerDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  flows: {
    id?: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    variables?: FlowVariableDefinition[];
    activeFlowId?: string;
    nodes?: FlowNodeDefinition[];
    links: FlowLink[];
    nodePositions?: Record<string, NodePosition>;
  };
  assets: AssetFrameworkDefinition;
}
