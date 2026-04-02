import type Runtime from "../Runtime";
import type { AssetChangeMeta, AssetHierarchyNode, AssetSection, AssetStore, AttributeQueryMatch, FindAttributesResult, QueryMatch } from "../core/runtimeTypes";

export interface AssetNormalizationServiceContract {
  normalize(input?: unknown): AssetSection;
}

export interface AssetHistorianBridgeLike {
  updateTargets(nextTargets?: unknown[]): void;
  enqueueChanges(changes: unknown, store: AssetStore): void;
  stats(): Record<string, unknown>;
  close?(): void;
}

export interface AssetStoreRepositoryContract {
  ensureStore(initialSection?: unknown): AssetStore;
  getStore(): AssetStore | null;
  syncRuntimeState(store: AssetStore): void;
  onStoreChanged(store: AssetStore, nextState: AssetSection, meta: AssetChangeMeta): void;
  getHistorianBridge(initialSection?: unknown): AssetHistorianBridgeLike;
}

export interface AssetDomainControllerContract {
  readonly domain: "asset";
  initialize(initialSection?: unknown): AssetStore;
  replaceState(nextState: AssetSection): AssetSection;
  getStore(): AssetStore | null;
  getState(): AssetSection | null;
  query(pathValue: string): QueryMatch[];
  getValue(pathValue: string, defaultValue?: unknown): unknown;
  getAttributes(pathValue: string): AttributeQueryMatch[];
  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[];
  setAttributes(items: Array<{ path: string; value: unknown }>): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }>;
  findAttributesByValue(pathValue: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult;
  getHierarchy(options?: { populateAttributes?: boolean }): AssetHierarchyNode[];
  bindRuntime(runtime: Runtime): void;
}

export interface AssetDomainServiceContract {
  initialize(initialSection?: unknown): AssetStore;
  replaceState(nextState: AssetSection): AssetSection;
  getStore(): AssetStore | null;
  getState(): AssetSection | null;
  query(pathValue: string): QueryMatch[];
  getValue(pathValue: string, defaultValue?: unknown): unknown;
  getAttributes(pathValue: string): AttributeQueryMatch[];
  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[];
  setAttributes(items: Array<{ path: string; value: unknown }>): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }>;
  findAttributesByValue(pathValue: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult;
  getHierarchy(options?: { populateAttributes?: boolean }): AssetHierarchyNode[];
  bindRuntime(runtime: Runtime): void;
}
