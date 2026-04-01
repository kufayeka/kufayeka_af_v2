import type Runtime from "./Runtime";
import type { EventStore } from "./types";
import { EventDomainController } from "./event/EventDomainController";

interface EventStoreOptions {}

export function createEventStore(_options: EventStoreOptions = {}): EventStore {
  throw new Error("createEventStore is deprecated. Use EventDomainController/EventDomainService via runtime composition.");
}

export function ensureEventStore(runtime: Runtime, _options: EventStoreOptions = {}): EventStore {
  const existingController = runtime.getGlobal<EventDomainController | null>("eventDomainController", null);
  const controller = existingController || new EventDomainController(runtime);
  runtime.setGlobal("eventDomainController", controller);
  return controller.initializeStore();
}
