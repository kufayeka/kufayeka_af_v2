import type { EventActionDefinition, RuntimeNodeHandler } from "../core/runtimeTypes";
import type { EventActionFactoryOptions } from "./EventActionSupport";
import type { FlowDefinition, ScriptAction, ScriptActionRuntimeDeps, ScriptTemplate } from "./ScriptActionSupport";

export interface ActionDomainControllerContract {
  readonly domain: "action";
  createScriptHandler(
    action: ScriptAction,
    options?: { templateById?: Map<string, ScriptTemplate>; flowById?: Map<string, FlowDefinition>; runtimeDeps?: ScriptActionRuntimeDeps }
  ): RuntimeNodeHandler;
  createEventHandler(action: EventActionDefinition, mode: "open" | "close", options?: EventActionFactoryOptions): RuntimeNodeHandler;
}
