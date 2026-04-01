import { createAssetFrameworkStore } from "../assetFramework";
import type Runtime from "../Runtime";
import type { AssetChangeMeta, AssetSection, AssetStore } from "../types";
import type { AssetHistorianBridgeLike, AssetNormalizationServiceContract, AssetStoreRepositoryContract } from "./contracts";
import { HistorianDomainController } from "../historian/HistorianDomainController";

function isAssetStore(value: unknown): value is AssetStore {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AssetStore).getState === "function" &&
    typeof (value as AssetStore).query === "function" &&
    typeof (value as AssetStore).setAttribute === "function"
  );
}

export class AssetStoreRepository implements AssetStoreRepositoryContract {
  private readonly runtime: Runtime;
  private readonly normalizationService: AssetNormalizationServiceContract;

  constructor(runtime: Runtime, normalizationService: AssetNormalizationServiceContract) {
    this.runtime = runtime;
    this.normalizationService = normalizationService;
  }

  ensureStore(initialSection: unknown = {}): AssetStore {
    const existing = this.getStore();
    if (existing) return existing;

    const seed = this.normalizationService.normalize(this.runtime.getGlobal("assetFramework", initialSection));
    const store = createAssetFrameworkStore(seed);
    store.subscribe((nextState, meta) => {
      this.onStoreChanged(store, nextState, meta);
    });

    this.runtime.setGlobal("assetStorage", store);
    this.syncRuntimeState(store);
    return store;
  }

  getStore(): AssetStore | null {
    const existing = this.runtime.getGlobal<unknown>("assetStorage");
    return isAssetStore(existing) ? existing : null;
  }

  syncRuntimeState(store: AssetStore): void {
    this.runtime.setGlobal("assetFramework", store.getState());
    this.runtime.setGlobal("assetFrameworkMeta", {
      revision: store.getRevision(),
      updatedAt: store.getUpdatedAt()
    });
    const historianBridge = this.getHistorianBridge(store.getState());
    historianBridge.updateTargets(store.getState().historians || []);
    this.runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  }

  onStoreChanged(store: AssetStore, nextState: AssetSection, meta: AssetChangeMeta): void {
    this.runtime.setGlobal("assetFramework", nextState);
    this.runtime.setGlobal("assetFrameworkMeta", meta);
    const historianBridge = this.getHistorianBridge(nextState);
    historianBridge.updateTargets(nextState.historians || []);
    if (meta?.change?.type === "attribute.set") {
      historianBridge.enqueueChanges(meta.change.changes || [], store);
    }
    this.runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  }

  getHistorianBridge(initialSection: unknown = {}): AssetHistorianBridgeLike {
    const existingController = this.runtime.getGlobal<HistorianDomainController | null>("historianDomainController", null);
    const controller = existingController || new HistorianDomainController(this.runtime);
    this.runtime.setGlobal("historianDomainController", controller);
    return controller.initializeBridge((this.runtime.getGlobal("assetFramework", initialSection as { historians?: unknown[] })?.historians || []) as unknown[]) as AssetHistorianBridgeLike;
  }
}
