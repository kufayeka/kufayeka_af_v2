import type { AssetChangeMeta, AssetSection, AssetStore, AttributeQueryMatch } from "./types";
import { AssetHierarchyService } from "./asset/AssetHierarchyService";
import { AssetMutationService } from "./asset/AssetMutationService";
import { AssetQueryService } from "./asset/AssetQueryService";
import { AssetTemplateService } from "./asset/AssetTemplateService";

export function normalizeAssetSection(input: unknown = {}): AssetSection {
  return new AssetTemplateService().normalizeSection(input);
}

export function createAssetFrameworkStore(initialSection: unknown = {}): AssetStore {
  const templateService = new AssetTemplateService();
  let state = templateService.normalizeSection(initialSection);
  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set<(state: AssetSection, meta: AssetChangeMeta) => void>();

  const getState = (): AssetSection => structuredClone(state);

  const emitChange = (change: AssetChangeMeta["change"] = { type: "state.replace", changes: [] }): void => {
    revision += 1;
    updatedAt = new Date().toISOString();
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot, { revision, updatedAt, change });
      } catch (error) {
        console.error("asset store listener error:", error);
      }
    }
  };

  const queryService = new AssetQueryService(() => state, templateService);
  const mutationService = new AssetMutationService(
    () => state,
    (nextState) => {
      state = nextState;
    },
    emitChange,
    queryService,
    templateService
  );
  const hierarchyService = new AssetHierarchyService(() => state, templateService);

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
      const previousState = state;
      const normalizedNext = templateService.normalizeSection(nextState);
      const prevMap = templateService.collectEffectiveAttributeMatches(previousState);
      const nextMap = templateService.collectEffectiveAttributeMatches(normalizedNext);
      const changed: AttributeQueryMatch[] = [];

      for (const [key, nextAttr] of nextMap.entries()) {
        const prevAttr = prevMap.get(key);
        if (templateService.attributeMatchChanged(prevAttr, nextAttr)) {
          changed.push(nextAttr);
        }
      }

      state = normalizedNext;
      if (changed.length > 0) emitChange({ type: "attribute.set", pattern: "*", changes: changed });
      else emitChange({ type: "state.replace", changes: [] });
      return getState();
    },
    query(pathValue: string) {
      return queryService.resolve(pathValue);
    },
    getAttribute(pathValue, defaultValue = undefined) {
      return queryService.getValue(pathValue, defaultValue);
    },
    getValue(pathValue, defaultValue = undefined) {
      return queryService.getValue(pathValue, defaultValue);
    },
    getAttributes(pathValue) {
      return queryService.getAttributes(pathValue);
    },
    setAttribute(pathValue, value) {
      return mutationService.setAttributeByPath(pathValue, value);
    },
    setAttributes(items: Array<{ path: string; value: unknown }> = []) {
      const results: Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (!Object.prototype.hasOwnProperty.call(item, "path")) continue;
        if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
        const matches = mutationService.setAttributeByPath(item.path, item.value);
        results.push({ path: item.path, count: matches.length, matches });
      }
      return results;
    },
    findAttributesByValue(pathValue, expectedValue, options = {}) {
      return queryService.findAttributesByValue(pathValue, expectedValue, options);
    },
    getHierarchy(options) {
      return hierarchyService.buildHierarchy(options);
    }
  };
}
