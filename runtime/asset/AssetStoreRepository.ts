import { createAssetStore } from "./AssetStoreFactory";
import type Runtime from "../Runtime";
import type { AssetChangeMeta, AssetSection, AssetStore } from "../core/runtimeTypes";
import type { AssetHistorianBridgeLike, AssetNormalizationServiceContract, AssetStoreRepositoryContract } from "./AssetContracts";
import { HistorianDomainController } from "../historian/HistorianDomainController";

interface AssetStoreRepositoryDeps {
  historianController?: HistorianDomainController;
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

export class AssetStoreRepository implements AssetStoreRepositoryContract {
  private readonly runtime: Runtime;
  private readonly normalizationService: AssetNormalizationServiceContract;
  private readonly historianController?: HistorianDomainController;
  private store: AssetStore | null = null;

  constructor(
    runtime: Runtime,
    normalizationService: AssetNormalizationServiceContract,
    deps: AssetStoreRepositoryDeps = {}
  ) {
    this.runtime = runtime;
    this.normalizationService = normalizationService;
    this.historianController = deps.historianController;
  }

  ensureStore(initialSection: unknown = {}): AssetStore {
    const existing = this.getStore();
    if (existing) return existing;

    const seed = this.normalizationService.normalize(this.runtime.getGlobal("assetFramework", initialSection));
    const store = createAssetStore(seed);
    store.subscribe((nextState, meta) => {
      this.onStoreChanged(store, nextState, meta);
    });

    this.store = store;
    this.runtime.setGlobal("assetStorage", store);
    this.syncRuntimeState(store);
    return store;
  }

  getStore(): AssetStore | null {
    return this.store;
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
    const controller = this.historianController || new HistorianDomainController(this.runtime);
    return controller.initializeBridge((this.runtime.getGlobal("assetFramework", initialSection as { historians?: unknown[] })?.historians || []) as unknown[]) as AssetHistorianBridgeLike;
  }
}
