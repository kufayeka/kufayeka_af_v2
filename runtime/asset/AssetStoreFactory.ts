import type { AssetChangeMeta, AssetSection, AssetStore } from "../core/runtimeTypes";
import { AssetSchemaService } from "./AssetSchemaService";
import { AssetStoreIndex } from "./AssetStoreIndex";

export function normalizeAssetSection(input: unknown = {}): AssetSection {
  return new AssetSchemaService().normalizeSection(input);
}

export function createAssetStore(initialSection: unknown = {}): AssetStore {
  const templateService = new AssetSchemaService();
  const initialState = templateService.normalizeSection(initialSection);
  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set<(meta: AssetChangeMeta) => void>();
  const index = new AssetStoreIndex(initialState, templateService);

  // Store mutations are applied by AssetStoreIndex, which owns the keyspace.
  // This wrapper owns revision metadata and subscriber notifications. Unlike
  // the old design, listeners get the delta (`meta`) only — never a cloned
  // full-state snapshot, mirroring Redis keyspace notifications rather than
  // handing every subscriber a `DUMP` on every single write.
  const emitChange = (change: AssetChangeMeta["change"] = { type: "state.replace", changes: [] }): void => {
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
      return index.getState();
    },
    getSnapshot() {
      return { state: index.getState(), revision, updatedAt };
    },
    getRevision() {
      return revision;
    },
    getUpdatedAt() {
      return updatedAt;
    },
    getHistorianTargets() {
      return index.getHistorianTargets();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(nextState) {
      const normalizedNext = templateService.normalizeSection(nextState);
      const replaced = index.replaceState(normalizedNext);
      const changed = replaced.changedMatches;
      if (changed.length > 0) emitChange({ type: "attribute.set", pattern: "*", changes: changed });
      else emitChange({ type: "state.replace", changes: [] });
      return index.getState();
    },
    query(pathValue: string) {
      return index.query(pathValue);
    },
    getAttribute(pathValue, defaultValue = undefined) {
      return index.getValue(pathValue, defaultValue);
    },
    getValue(pathValue, defaultValue = undefined) {
      return index.getValue(pathValue, defaultValue);
    },
    getAttributes(pathValue) {
      return index.getAttributes(pathValue);
    },
    setAttribute(pathValue, value) {
      const changedMatches = index.setAttribute(pathValue, value);
      if (changedMatches.length > 0) {
        emitChange({
          type: "attribute.set",
          pattern: pathValue,
          changes: changedMatches.map((item) => ({ ...item }))
        });
      }
      return changedMatches;
    },
    setAttributes(items: Array<{ path: string; value: unknown }> = []) {
      const results = index.setAttributes(items);
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
      return index.findAttributesByValue(pathValue, expectedValue, options);
    },
    getHierarchy(options) {
      return index.getHierarchy(options);
    }
  };
}
