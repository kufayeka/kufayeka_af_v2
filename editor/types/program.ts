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
  | "static_number"
  | "static_string"
  | "static_boolean"
  | "static_array"
  | "static_object";

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
  templateBindingOverrides?: Record<string, ScriptVariableBindingDefinition>;
  script: string;
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
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  flows: {
    links: FlowLink[];
    nodePositions?: Record<string, NodePosition>;
  };
  assets: AssetFrameworkDefinition;
}
