import type Runtime from "../Runtime";
import type { AssetHierarchyNode, AssetSection, AssetStore, AttributeQueryMatch, FindAttributesResult, QueryMatch } from "../types";
import type { AssetDomainServiceContract } from "./contracts";
import { AssetStateService } from "./AssetStateService";

export class AssetDomainService implements AssetDomainServiceContract {
  private readonly stateService: AssetStateService;

  constructor(runtime: Runtime) {
    this.stateService = new AssetStateService(runtime);
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
    if (!store) throw new Error("Asset store is not initialized");
    return store;
  }
}
