import type { EventActionDefinition, RuntimeNodeHandler } from "../types";

export interface ActionDomainControllerContract {
  readonly domain: "action";
  createScriptHandler(action: unknown, context?: Record<string, unknown>): RuntimeNodeHandler;
  createEventHandler(action: EventActionDefinition, mode: "open" | "close", context?: Record<string, unknown>): RuntimeNodeHandler;
}
