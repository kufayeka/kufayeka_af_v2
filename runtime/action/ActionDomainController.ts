import createEventActionHandler from "../createEventActionHandler";
import createScriptActionHandler from "../createScriptActionHandler";
import type { EventActionDefinition, RuntimeNodeHandler } from "../types";
import type { ActionDomainControllerContract } from "./contracts";

export class ActionDomainController implements ActionDomainControllerContract {
  readonly domain = "action" as const;

  createScriptHandler(action: unknown, context: Record<string, unknown> = {}): RuntimeNodeHandler {
    return createScriptActionHandler(action as never, context as never);
  }

  createEventHandler(action: EventActionDefinition, mode: "open" | "close", context: Record<string, unknown> = {}): RuntimeNodeHandler {
    return createEventActionHandler(action, mode, context);
  }
}
