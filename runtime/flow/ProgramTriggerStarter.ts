import type Runtime from "../Runtime";
import type { EventRow, EventStore, EventStoreChangeMeta } from "../core/runtimeTypes";
import type { ProgramRuntimeComposition } from "../composition/RuntimeComposition";
import type { ProgramFlowNode, ProgramTrigger } from "./ProgramFlowContracts";
import {
  createTriggerMessage,
  createTriggerRuntimeDeps,
  getAttributeChanges,
  getEventRows,
  mapClosedEventRow,
  mapOpenedEventRow,
  matchWildcardText,
  normalizeWatchPath,
  resolveTriggers,
  shouldEmitAttributeChange,
  type TriggerRuntimeDeps,
  type WatcherMode
} from "./ProgramTriggerSupport";

interface AssetStoreSubscription {
  subscribe: (cb: (meta: unknown) => void) => () => void;
}

function requireAssetStore(composition: ProgramRuntimeComposition, triggerId: string): AssetStoreSubscription {
  const store = composition.assetStore;
  if (!store || typeof (store as { subscribe?: unknown }).subscribe !== "function") {
    throw new Error(`Watcher trigger "${triggerId}" failed: assetStorage is not available`);
  }
  return store as AssetStoreSubscription;
}

function requireEventStore(composition: ProgramRuntimeComposition, triggerId: string): EventStore {
  const eventStore = composition.eventStore;
  if (!eventStore || typeof eventStore.subscribe !== "function") {
    throw new Error(`Watcher trigger "${triggerId}" failed: eventStore is not available`);
  }
  return eventStore;
}

function startIntervalTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  const intervalMs = Math.max(1, Number(trigger.intervalMs) || 1000);
  const timer = setInterval(() => {
    runtime.send(
      trigger.id,
      createTriggerMessage(trigger, trigger.message || {}, { type: "interval" }, deps)
    );
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function startWatcherTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  mode: WatcherMode,
  composition: ProgramRuntimeComposition,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  const assetStore = requireAssetStore(composition, trigger.id);
  const watchPath = normalizeWatchPath(trigger, "*.*.*");
  const lastSeenByKey = new Map<string, string>();
  const unsubscribe = assetStore.subscribe((meta) => {
    for (const change of getAttributeChanges(meta)) {
      if (!shouldEmitAttributeChange(mode, change, watchPath, lastSeenByKey)) continue;
      runtime.send(
        trigger.id,
        createTriggerMessage(
          trigger,
          change as Record<string, unknown>,
          { type: "watcher", watchPath, source: "subscribe" },
          deps
        )
      );
    }
  });
  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function subscribeEventTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  triggerType: "watcher_event_falling" | "watcher_event_open",
  matchesMeta: (meta: EventStoreChangeMeta) => boolean,
  mapRow: (meta: EventStoreChangeMeta, row: EventRow) => Record<string, unknown> | null,
  composition: ProgramRuntimeComposition,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  const eventStore = requireEventStore(composition, trigger.id);
  const watchPath = normalizeWatchPath(trigger, "*");
  const unsubscribe = eventStore.subscribe((meta) => {
    if (!matchesMeta(meta)) return;
    for (const row of getEventRows(meta)) {
      const payload = mapRow(meta, row);
      if (!payload) continue;
      if (!matchWildcardText(watchPath, String(payload.event_path || ""))) continue;
      runtime.send(
        trigger.id,
        createTriggerMessage(trigger, payload, { type: triggerType, watchPath, source: meta.type }, deps)
      );
    }
  });
  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function startEventFallingTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  composition: ProgramRuntimeComposition,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  return subscribeEventTrigger(
    runtime,
    trigger,
    "watcher_event_falling",
    (meta) => meta.type === "close" || meta.type === "closeById",
    mapClosedEventRow,
    composition,
    deps
  );
}

function startEventOpenTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  composition: ProgramRuntimeComposition,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  return subscribeEventTrigger(
    runtime,
    trigger,
    "watcher_event_open",
    (meta) => meta.type === "open",
    mapOpenedEventRow,
    composition,
    deps
  );
}

function startSingleTrigger(
  runtime: Runtime,
  trigger: ProgramTrigger,
  composition: ProgramRuntimeComposition,
  deps: Required<TriggerRuntimeDeps>
): () => void {
  if (!trigger.id) throw new Error("Trigger must have an id");
  if (trigger.type === "interval") return startIntervalTrigger(runtime, trigger, deps);
  if (trigger.type === "watcher_set") return startWatcherTrigger(runtime, trigger, "set", composition, deps);
  if (trigger.type === "watcher_valuechange") return startWatcherTrigger(runtime, trigger, "valuechange", composition, deps);
  if (trigger.type === "watcher_event_falling" || trigger.type === "watcher_event_close") {
    return startEventFallingTrigger(runtime, trigger, composition, deps);
  }
  if (trigger.type === "watcher_event_open") return startEventOpenTrigger(runtime, trigger, composition, deps);
  throw new Error(`Unsupported trigger type "${String(trigger.type)}"`);
}

export function startTriggers(
  runtime: Runtime,
  triggerNodes: ProgramFlowNode[] = [],
  composition: ProgramRuntimeComposition,
  legacyTriggers: unknown[] = [],
  runtimeDeps: TriggerRuntimeDeps = {}
): Array<() => void> {
  const deps = createTriggerRuntimeDeps(runtimeDeps);
  const stops: Array<() => void> = [];
  const derivedTriggers = resolveTriggers(triggerNodes, composition.triggerTemplates, legacyTriggers);

  for (const trigger of derivedTriggers) {
    if (trigger.enabled === false) continue;
    stops.push(startSingleTrigger(runtime, trigger, composition, deps));
  }

  return stops;
}
