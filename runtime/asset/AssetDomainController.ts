import type Runtime from "../Runtime";
import type { AssetHierarchyNode, AssetSection, AssetStore, AttributeQueryMatch, FindAttributesResult, QueryMatch } from "../core/runtimeTypes";
import type { HistorianDomainController } from "../historian/HistorianDomainController";
import type { AssetDomainControllerContract } from "./AssetContracts";
import { AssetDomainService } from "./AssetDomainService";

interface AssetDomainControllerDeps {
  historianController?: HistorianDomainController;
}

export class AssetDomainController implements AssetDomainControllerContract {
  readonly domain = "asset" as const;
  private readonly service: AssetDomainService;

  constructor(runtime: Runtime, deps: AssetDomainControllerDeps = {}) {
    this.service = new AssetDomainService(runtime, deps);
  }

  bindRuntime(runtime: Runtime): void {
    this.service.bindRuntime(runtime);
  }

  initialize(initialSection: unknown = {}): AssetStore {
    return this.service.initialize(initialSection);
  }

  replaceState(nextState: AssetSection): AssetSection {
    return this.service.replaceState(nextState);
  }

  getStore(): AssetStore | null {
    return this.service.getStore();
  }

  getState(): AssetSection | null {
    return this.service.getState();
  }

  query(pathValue: string): QueryMatch[] {
    return this.service.query(pathValue);
  }

  getValue(pathValue: string, defaultValue?: unknown): unknown {
    return this.service.getValue(pathValue, defaultValue);
  }

  getAttributes(pathValue: string): AttributeQueryMatch[] {
    return this.service.getAttributes(pathValue);
  }

  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[] {
    return this.service.setAttribute(pathValue, value);
  }

  setAttributes(items: Array<{ path: string; value: unknown }>): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> {
    return this.service.setAttributes(items);
  }

  findAttributesByValue(pathValue: string, expectedValue: unknown, options: { strict?: boolean } = {}): FindAttributesResult {
    return this.service.findAttributesByValue(pathValue, expectedValue, options);
  }

  getHierarchy(options: { populateAttributes?: boolean } = {}): AssetHierarchyNode[] {
    return this.service.getHierarchy(options);
  }
}
