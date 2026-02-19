export type TriggerType = "interval";
export type ActionType = "script";
export type AssetAttributeType = "number" | "boolean" | "string" | "array" | "object";

export interface AssetTemplateAttributeDefinition {
  name: string;
  type: AssetAttributeType;
  defaultValue: unknown;
  unit?: string;
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
}

export interface TriggerDefinition {
  id: string;
  type: TriggerType;
  enabled: boolean;
  intervalMs: number;
  message: {
    payload?: unknown;
    [key: string]: unknown;
  };
}

export interface ActionDefinition {
  id: string;
  type: ActionType;
  enabled: boolean;
  description?: string;
  script: string;
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
  flows: {
    links: FlowLink[];
    nodePositions?: Record<string, NodePosition>;
  };
  assets: AssetFrameworkDefinition;
}
