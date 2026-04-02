import { createEventActionHandler } from "./EventActionHandlerFactory";
import { createScriptActionHandler } from "./ScriptActionHandlerFactory";
import type { EventActionDefinition, RuntimeNodeHandler } from "../core/runtimeTypes";
import type { EventActionFactoryOptions } from "./EventActionSupport";
import type { FlowDefinition, ScriptAction, ScriptActionRuntimeDeps, ScriptTemplate } from "./ScriptActionSupport";
import type { ActionDomainControllerContract } from "./ActionContracts";

interface ActionDomainControllerDeps {
  createScriptHandler?: (
    action: ScriptAction,
    options?: { templateById?: Map<string, ScriptTemplate>; flowById?: Map<string, FlowDefinition>; runtimeDeps?: ScriptActionRuntimeDeps }
  ) => RuntimeNodeHandler;
  createEventHandler?: (
    action: EventActionDefinition,
    mode: "open" | "close",
    options?: EventActionFactoryOptions
  ) => RuntimeNodeHandler;
}

export class ActionDomainController implements ActionDomainControllerContract {
  readonly domain = "action" as const;
  private readonly createScriptHandlerImpl: NonNullable<ActionDomainControllerDeps["createScriptHandler"]>;
  private readonly createEventHandlerImpl: NonNullable<ActionDomainControllerDeps["createEventHandler"]>;

  constructor(deps: ActionDomainControllerDeps = {}) {
    this.createScriptHandlerImpl = deps.createScriptHandler || createScriptActionHandler;
    this.createEventHandlerImpl = deps.createEventHandler || createEventActionHandler;
  }

  createScriptHandler(
    action: ScriptAction,
    options: { templateById?: Map<string, ScriptTemplate>; flowById?: Map<string, FlowDefinition>; runtimeDeps?: ScriptActionRuntimeDeps } = {}
  ): RuntimeNodeHandler {
    return this.createScriptHandlerImpl(action, options);
  }

  createEventHandler(action: EventActionDefinition, mode: "open" | "close", options: EventActionFactoryOptions = {}): RuntimeNodeHandler {
    return this.createEventHandlerImpl(action, mode, options);
  }
}

