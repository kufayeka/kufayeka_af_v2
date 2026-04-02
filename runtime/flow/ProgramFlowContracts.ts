import type { EventActionDefinition } from "../core/runtimeTypes";

export interface ProgramAction {
  id: string;
  enabled?: boolean;
  type: string;
  templateId?: string;
  eventTemplateId?: string;
  eventTemplateOverrides?: Record<string, unknown>;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, unknown>;
}

export interface ProgramEventAction extends EventActionDefinition {}

export interface ProgramFlowNode {
  id: string;
  kind: "trigger" | "action" | "event_open" | "event_close";
  refId?: string;
  label?: string;
  enabled?: boolean;
  templateId?: string;
  config?: Record<string, unknown>;
}

export interface ProgramFlowDefinition {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  variables?: Array<{
    name?: string;
    source?: string;
    staticValue?: unknown;
    attributePath?: string;
  }>;
  nodes?: ProgramFlowNode[];
  links?: ProgramLink[];
  nodePositions?: Record<string, unknown>;
}

export interface ProgramLink {
  from: string;
  to: string;
  fromPort?: string;
  enabled?: boolean;
}

export interface ProgramTrigger {
  id: string;
  type:
    | "interval"
    | "cron"
    | "watcher_set"
    | "watcher_valuechange"
    | "watcher_event_falling"
    | "watcher_event_open"
    | "watcher_event_close";
  enabled?: boolean;
  intervalMs?: number;
  activeFrom?: string;
  activeTo?: string;
  message?: Record<string, unknown>;
  watchPath?: string;
}

export interface ProgramTriggerTemplate extends ProgramTrigger {
  name?: string;
  description?: string;
}
