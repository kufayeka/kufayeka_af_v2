import type Runtime from "../Runtime";
import type { AssetHierarchyNode, AssetSection, AssetStore, AttributeQueryMatch, FindAttributesResult, QueryMatch } from "../core/runtimeTypes";
import type { HistorianDomainController } from "../historian/HistorianDomainController";
import { AssetStateService } from "./AssetStateService";

interface AssetDomainServiceDeps {
  historianController?: HistorianDomainController;
}

/**
 * Use-case layer for asset operations.
 *
 * Lifecycle calls are handled by AssetStateService. Read/write calls require
 * the active AssetStore and fail fast when the domain has not been initialized.
 */
export class AssetDomainService {
  private readonly stateService: AssetStateService;

  constructor(runtime: Runtime, deps: AssetDomainServiceDeps = {}) {
    this.stateService = new AssetStateService(runtime, deps);
  }

  bindRuntime(runtime: Runtime): void {
    this.stateService.bindRuntime(runtime);
  }

  initialize(initialSection: unknown = {}): AssetStore {
    return this.stateService.initialize(initialSection);
  }

  replaceState(nextState: AssetSection): AssetSection {
    return this.stateService.replaceState(nextState);
  }

  getStore(): AssetStore | null {
    return this.stateService.getStore();
  }

  getState(): AssetSection | null {
    return this.stateService.getState();
  }

  query(pathValue: string): QueryMatch[] {
    return this.requireStore().query(pathValue);
  }

  getValue(pathValue: string, defaultValue?: unknown): unknown {
    return this.requireStore().getValue(pathValue, defaultValue);
  }

  getAttributes(pathValue: string): AttributeQueryMatch[] {
    return this.requireStore().getAttributes(pathValue);
  }

  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[] {
    return this.requireStore().setAttribute(pathValue, value);
  }

  setAttributes(items: Array<{ path: string; value: unknown }>): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> {
    return this.requireStore().setAttributes(items);
  }

  findAttributesByValue(pathValue: string, expectedValue: unknown, options: { strict?: boolean } = {}): FindAttributesResult {
    return this.requireStore().findAttributesByValue(pathValue, expectedValue, options);
  }

  getHierarchy(options: { populateAttributes?: boolean } = {}): AssetHierarchyNode[] {
    return this.requireStore().getHierarchy(options);
  }

  private requireStore(): AssetStore {
    const store = this.getStore();
    if (!store) throw new Error("Asset domain cannot read or write before initialize() creates the active store");
    return store;
  }
}
