import type Runtime from "../Runtime";
import type { EventStore } from "../core/runtimeTypes";

interface EventStoreOptions {}

export function createEventStore(_options: EventStoreOptions = {}): EventStore {
  throw new Error("createEventStore is deprecated. Use EventDomainController/EventDomainService via runtime composition.");
}

export function getProgramEventStore(runtime: Runtime, _options: EventStoreOptions = {}): EventStore {
  const composition = runtime.getProgramComposition();
  if (!composition) {
    throw new Error("getProgramEventStore requires an initialized program composition");
  }
  return composition.services.event.initializeStore();
}
