import path from "node:path";
import { AssetSchemaService } from "./AssetSchemaService";
import type {
  AssetChangeMeta,
  AssetHierarchyNode,
  AssetSection,
  AssetSnapshot,
  AssetStore,
  AttributeQueryMatch,
  FindAttributesResult,
  HistorianTarget,
  QueryMatch
} from "../core/runtimeTypes";

// Drop-in AssetStore backed by the native Rust keyspace (native/asset-store)
// instead of the pure-TypeScript one in AssetStoreIndex.ts/AssetStoreFactory.ts.
// Revision bookkeeping and subscriber notification stay in TypeScript --
// exactly the same split of responsibility as the TS version's
// AssetStoreIndex (data/query engine) vs AssetStoreFactory (revision +
// pub/sub wrapper). The native side owns nothing but the keyspace itself.

interface NativeAssetKeyspace {
  getState(): unknown;
  getHistorianTargets(): unknown;
  replaceState(nextState: unknown): unknown;
  query(pathValue: string): unknown;
  getAttributes(pathValue: string): unknown;
  findAttributesByValue(pathValue: string, expectedValue: unknown, strict: boolean): unknown;
  getHierarchy(populateAttributes: boolean): unknown;
  setAttribute(pathValue: string, value: unknown): unknown;
  setAttributes(items: unknown): unknown;
}

interface NativeAssetKeyspaceCtor {
  new (initialState: unknown): NativeAssetKeyspace;
}

let cachedCtor: NativeAssetKeyspaceCtor | null = null;

function loadNativeKeyspaceCtor(): NativeAssetKeyspaceCtor {
  if (cachedCtor) return cachedCtor;
  const modulePath = path.resolve(process.cwd(), "native", "asset-store", "index.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modulePath) as { RustAssetKeyspace: NativeAssetKeyspaceCtor };
  cachedCtor = mod.RustAssetKeyspace;
  return cachedCtor;
}

// Mirrors AssetStoreIndex.getValue()'s exact fallback shape: empty -> default,
// one match -> its value, multiple matches -> array of values. Kept in
// TypeScript (not passed through the native boundary) specifically so an
// omitted `defaultValue` stays `undefined` -- JSON has no way to represent
// that distinctly from `null`, so resolving it on the Rust side would
// silently turn "no default given" into "default is null".
function deriveValue(matches: AttributeQueryMatch[], defaultValue: unknown): unknown {
  if (matches.length === 0) return defaultValue;
  if (matches.length === 1) return matches[0].value;
  return matches.map((item) => item.value);
}

export function createRustAssetStore(initialSection: unknown = {}): AssetStore {
  const templateService = new AssetSchemaService();
  const normalized = templateService.normalizeSection(initialSection);
  const NativeKeyspace = loadNativeKeyspaceCtor();
  const native = new NativeKeyspace(normalized);

  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set<(meta: AssetChangeMeta) => void>();

  const emitChange = (change: AssetChangeMeta["change"]): void => {
    revision += 1;
    updatedAt = new Date().toISOString();
    const meta: AssetChangeMeta = { revision, updatedAt, change };
    for (const listener of listeners) {
      try {
        listener(meta);
      } catch (error) {
        console.error("asset store listener error:", error);
      }
    }
  };

  return {
    getState() {
      return native.getState() as AssetSection;
    },
    getSnapshot(): AssetSnapshot {
      return { state: native.getState() as AssetSection, revision, updatedAt };
    },
    getRevision() {
      return revision;
    },
    getUpdatedAt() {
      return updatedAt;
    },
    getHistorianTargets() {
      return native.getHistorianTargets() as HistorianTarget[];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(nextState) {
      const normalizedNext = templateService.normalizeSection(nextState);
      const changed = native.replaceState(normalizedNext) as AttributeQueryMatch[];
      if (changed.length > 0) emitChange({ type: "attribute.set", pattern: "*", changes: changed });
      else emitChange({ type: "state.replace", changes: [] });
      return native.getState() as AssetSection;
    },
    query(pathValue) {
      return native.query(pathValue) as QueryMatch[];
    },
    getAttribute(pathValue, defaultValue) {
      return deriveValue(native.getAttributes(pathValue) as AttributeQueryMatch[], defaultValue);
    },
    getValue(pathValue, defaultValue) {
      return deriveValue(native.getAttributes(pathValue) as AttributeQueryMatch[], defaultValue);
    },
    getAttributes(pathValue) {
      return native.getAttributes(pathValue) as AttributeQueryMatch[];
    },
    setAttribute(pathValue, value) {
      const changed = native.setAttribute(pathValue, value) as AttributeQueryMatch[];
      if (changed.length > 0) {
        emitChange({ type: "attribute.set", pattern: pathValue, changes: changed.map((item) => ({ ...item })) });
      }
      return changed;
    },
    setAttributes(items) {
      const results = native.setAttributes(items) as Array<{ path: string; count: number; matches: AttributeQueryMatch[] }>;
      const changedMatches = results.flatMap((result) => result.matches);
      if (changedMatches.length > 0) {
        emitChange({
          type: "attribute.set",
          pattern: results.length === 1 ? results[0].path : "__batch__",
          changes: changedMatches.map((item) => ({ ...item }))
        });
      }
      return results;
    },
    findAttributesByValue(pathValue, expectedValue, options = {}) {
      return native.findAttributesByValue(pathValue, expectedValue, options.strict === true) as FindAttributesResult;
    },
    getHierarchy(options = {}) {
      return native.getHierarchy(options.populateAttributes !== false) as AssetHierarchyNode[];
    }
  };
}
