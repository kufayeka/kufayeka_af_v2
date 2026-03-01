import type Runtime from "./Runtime";
import { createAssetFrameworkStore, normalizeAssetSection } from "./assetFramework";
import { createHistorianBridge } from "./historianBridge";
import type { DbConnectionManager } from "./dbConnectionManager";
import type { AssetStore } from "./types";

interface HistorianBridgeLike {
  updateTargets(nextTargets?: unknown[]): void;
  enqueueChanges(changes: unknown, store: AssetStore): void;
  stats(): Record<string, unknown>;
}

function isAssetStore(value: unknown): value is AssetStore {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AssetStore).getState === "function" &&
    typeof (value as AssetStore).query === "function" &&
    typeof (value as AssetStore).setAttribute === "function"
  );
}

export function ensureAssetStorage(runtime: Runtime, initialSection: unknown = {}): AssetStore {
  const historianBridge: HistorianBridgeLike =
    runtime.getGlobal<HistorianBridgeLike | undefined>("historianBridge") ||
    (createHistorianBridge({
      enabled: process.env.HISTORIAN_ENABLED !== "0",
      timestampUnit: process.env.HISTORIAN_TIMESTAMP_UNIT || "us",
      maxQueue: Number(process.env.HISTORIAN_MAX_QUEUE || 100000),
      targets: runtime.getGlobal("assetFramework", initialSection as { historians?: unknown[] })?.historians || [],
      enqueueHistorianRows: (rows) => {
        const db = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
        if (!db) return;
        for (const row of rows) {
          db.enqueueHistorian(row);
        }
      }
    }) as HistorianBridgeLike);
  runtime.setGlobal("historianBridge", historianBridge);

  const existing = runtime.getGlobal<unknown>("assetStorage");
  if (isAssetStore(existing)) return existing;

  const seed = normalizeAssetSection(runtime.getGlobal("assetFramework", initialSection));
  const store = createAssetFrameworkStore(seed);

  store.subscribe((nextState, meta) => {
    runtime.setGlobal("assetFramework", nextState);
    runtime.setGlobal("assetFrameworkMeta", meta);
    historianBridge.updateTargets(nextState.historians || []);
    if (meta?.change?.type === "attribute.set") {
      historianBridge.enqueueChanges(meta.change.changes || [], store);
    }
    runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  });

  runtime.setGlobal("assetStorage", store);
  runtime.setGlobal("assetFramework", store.getState());
  runtime.setGlobal("assetFrameworkMeta", {
    revision: store.getRevision(),
    updatedAt: store.getUpdatedAt(),
  });

  historianBridge.updateTargets(store.getState().historians || []);
  runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  return store;
}
