import type { AssetChangeMeta, AssetSection, AssetStore, AttributeQueryMatch } from "../core/runtimeTypes";
import { AssetSchemaService } from "./AssetSchemaService";
import { AssetStoreIndex } from "./AssetStoreIndex";

export function normalizeAssetSection(input: unknown = {}): AssetSection {
  return new AssetSchemaService().normalizeSection(input);
}

export function createAssetStore(initialSection: unknown = {}): AssetStore {
  const templateService = new AssetSchemaService();
  let state = templateService.normalizeSection(initialSection);
  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set<(state: AssetSection, meta: AssetChangeMeta) => void>();
  let index = new AssetStoreIndex(state, templateService);

  const getState = (): AssetSection => structuredClone(state);

  const emitChange = (change: AssetChangeMeta["change"] = { type: "state.replace", changes: [] }): void => {
    revision += 1;
    updatedAt = new Date().toISOString();
    const shouldCaptureSnapshot = listeners.size > 0;
    const snapshot = shouldCaptureSnapshot ? getState() : null;
    for (const listener of listeners) {
      try {
        if (!snapshot) continue;
        listener(snapshot, { revision, updatedAt, change });
      } catch (error) {
        console.error("asset store listener error:", error);
      }
    }
  };

  return {
    getState,
    getSnapshot() {
      return { state: getState(), revision, updatedAt };
    },
    getRevision() {
      return revision;
    },
    getUpdatedAt() {
      return updatedAt;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(nextState) {
      const normalizedNext = templateService.normalizeSection(nextState);
      const replaced = index.replaceState(normalizedNext);
      state = replaced.state;
      index = new AssetStoreIndex(state, templateService);
      const changed = replaced.changedMatches;
      if (changed.length > 0) emitChange({ type: "attribute.set", pattern: "*", changes: changed });
      else emitChange({ type: "state.replace", changes: [] });
      return getState();
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
        state = index.getState();
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
        state = index.getState();
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
