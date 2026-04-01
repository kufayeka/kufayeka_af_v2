import type Runtime from "../Runtime";
import type { AssetSection, AssetStore } from "../types";
import type { AssetNormalizationServiceContract, AssetStoreRepositoryContract } from "./contracts";
import { AssetNormalizationService } from "./AssetNormalizationService";
import { AssetStoreRepository } from "./AssetStoreRepository";

export class AssetStateService {
  private runtime: Runtime | null;
  private readonly normalizationService: AssetNormalizationServiceContract;
  private repository: AssetStoreRepositoryContract | null = null;

  constructor(runtime: Runtime) {
    this.runtime = runtime;
    this.normalizationService = new AssetNormalizationService();
    this.repository = new AssetStoreRepository(runtime, this.normalizationService);
  }

  bindRuntime(runtime: Runtime): void {
    this.runtime = runtime;
    this.repository = new AssetStoreRepository(runtime, this.normalizationService);
  }

  initialize(initialSection: unknown = {}): AssetStore {
    return this.requireRepository().ensureStore(initialSection);
  }

  replaceState(nextState: AssetSection): AssetSection {
    const normalized = this.normalizationService.normalize(nextState);
    const store = this.initialize(normalized);
    const replaced = store.replace(normalized);
    this.requireRepository().syncRuntimeState(store);
    return replaced;
  }

  getStore(): AssetStore | null {
    return this.requireRepository().getStore();
  }

  getState(): AssetSection | null {
    const store = this.getStore();
    return store ? store.getState() : null;
  }

  private requireRepository(): AssetStoreRepositoryContract {
    if (!this.runtime || !this.repository) throw new Error("AssetStateService is not bound to a runtime");
    return this.repository;
  }
}
