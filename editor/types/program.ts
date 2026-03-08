export type TriggerType =
  | "interval"
  | "cron"
  | "watcher_set"
  | "watcher_valuechange"
  | "watcher_event_falling";
export type ActionType = "script";
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

export interface ActionDefinition {
  id: string;
  label?: string;
  type: ActionType;
  enabled: boolean;
  allowTreeDuplicate?: boolean;
  allowNodeDuplication?: boolean;
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

export interface EventActionDefinition {
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

export interface ScriptTemplateDefinition {
  id: string;
  name: string;
  description?: string;
  script: string;
  allowTemplateReuse?: boolean;
  allowActionDuplication?: boolean;
  variableBindings?: ScriptVariableBindingDefinition[];
}

export interface FlowLink {
  from: string;
  to: string;
  enabled?: boolean;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface Program {
  meta: {
    name: string;
    version: number;
  };
  eventTemplates?: EventTemplateDefinition[];
  eventActions?: EventActionDefinition[];
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  flows: {
    links: FlowLink[];
    nodePositions?: Record<string, NodePosition>;
  };
  assets: AssetFrameworkDefinition;
}
