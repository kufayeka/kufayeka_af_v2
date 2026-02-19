export type TriggerType = "interval";
export type ActionType = "script";

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
}
