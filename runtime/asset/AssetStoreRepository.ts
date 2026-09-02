import { createAssetStore } from "./AssetStoreFactory";
import type Runtime from "../Runtime";
import type { AssetChangeMeta, AssetStore } from "../core/runtimeTypes";
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

/**
 * Boundary between the in-memory AssetStore and the rest of Runtime.
 *
 * It keeps compatibility mirrors in Runtime.globalStore and forwards attribute
 * changes to the historian bridge. Asset read/write rules live in AssetStore.
 */
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

    const seed = this.normalizationService.normalize(initialSection);
    const store = createAssetStore(seed);
    store.subscribe((meta) => {
      this.onStoreChanged(store, meta);
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
    const historianBridge = this.getHistorianBridge(store.getHistorianTargets());
    historianBridge.updateTargets(store.getHistorianTargets());
    this.runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  }

  onStoreChanged(store: AssetStore, meta: AssetChangeMeta): void {
    const historianBridge = this.getHistorianBridge(store.getHistorianTargets());
    historianBridge.updateTargets(store.getHistorianTargets());
    if (meta?.change?.type === "attribute.set") {
      historianBridge.enqueueChanges(meta.change.changes || [], store);
    }
    this.runtime.setGlobal("historianBridgeStats", historianBridge.stats());
  }

  getHistorianBridge(historianTargets: unknown[] = []): AssetHistorianBridgeLike {
    const controller = this.historianController || new HistorianDomainController(this.runtime);
    return controller.initializeBridge(historianTargets) as AssetHistorianBridgeLike;
  }
}
