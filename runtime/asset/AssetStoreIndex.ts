import type {
  AssetAttributeValue,
  AssetChangeMeta,
  AssetDefinition,
  AssetHierarchyNode,
  AssetSection,
  AttributeQueryMatch,
  AttributeTemplate,
  FindAttributesResult,
  QueryMatch
} from "../core/runtimeTypes";
import { getAssetPath, matches, splitPath, valuesEqual, valuesLooselyEqual } from "./assetDataUtils";
import { AssetSchemaService } from "./AssetSchemaService";

interface AssetPathEntry {
  assetId: string;
  path: string;
  segments: string[];
}

interface ResolvedAttributeTarget {
  assetId: string;
  attributeName: string;
}

type EffectiveAttributeRecord = ReturnType<AssetSchemaService["buildEffectiveAttributeMap"]> extends Map<string, infer TValue>
  ? TValue
  : never;

export class AssetStoreIndex {
  private state: AssetSection;
  private readonly templateService: AssetSchemaService;
  private templateById = new Map<string, AttributeTemplate>();
  private assetById = new Map<string, AssetDefinition>();
  private assetIndexById = new Map<string, number>();
  private assetPathEntries: AssetPathEntry[] = [];
  private assetPathById = new Map<string, string>();
  private assetPathEntryById = new Map<string, AssetPathEntry>();
  private assetByPath = new Map<string, AssetDefinition>();
  private attributeMapByAssetId = new Map<string, Map<string, AttributeQueryMatch>>();
  private attributeByPath = new Map<string, AttributeQueryMatch>();
  private childrenByParentId = new Map<string | null, AssetDefinition[]>();

  constructor(initialState: AssetSection, templateService: AssetSchemaService) {
    this.templateService = templateService;
    this.state = initialState;
    this.rebuildAllIndexes();
  }

  getState(): AssetSection {
    return this.state;
  }

  replaceState(nextState: AssetSection): { state: AssetSection; changedMatches: AttributeQueryMatch[] } {
    const previousAttributes = this.attributeByPath;
    this.state = nextState;
    this.rebuildAllIndexes();

    const changedMatches: AttributeQueryMatch[] = [];
    for (const [path, nextMatch] of this.attributeByPath.entries()) {
      const previousMatch = previousAttributes.get(path);
      if (this.templateService.attributeMatchChanged(previousMatch, nextMatch)) {
        changedMatches.push({ ...nextMatch });
      }
    }

    return { state: this.state, changedMatches };
  }

  query(pathValue: string): QueryMatch[] {
    const normalizedPath = String(pathValue || "").trim();
    if (!normalizedPath) return [];
    const segments = splitPath(normalizedPath);
    if (segments.length === 0) return [];

    const hasWildcard = segments.some((segment) => segment === "*");
    if (!hasWildcard) {
      const asset = this.assetByPath.get(normalizedPath);
      if (asset) {
        return [
          {
            kind: "asset",
            path: normalizedPath,
            assetId: asset.id,
            value: asset
          }
        ];
      }

      const attribute = this.attributeByPath.get(normalizedPath);
      return attribute ? [{ ...attribute }] : [];
    }

    const results: QueryMatch[] = [];
    for (const entry of this.assetPathEntries) {
      if (segments.length === entry.segments.length && segments.every((segment, index) => matches(segment, entry.segments[index]))) {
        const asset = this.assetById.get(entry.assetId);
        if (asset) {
          results.push({
            kind: "asset",
            path: entry.path,
            assetId: asset.id,
            value: asset
          });
        }
      }

      if (segments.length !== entry.segments.length + 1) continue;
      if (!segments.slice(0, -1).every((segment, index) => matches(segment, entry.segments[index]))) continue;

      const attributePattern = segments[segments.length - 1];
      const attributes = this.attributeMapByAssetId.get(entry.assetId);
      if (!attributes) continue;
      for (const [name, match] of attributes.entries()) {
        if (!matches(attributePattern, name)) continue;
        results.push({ ...match });
      }
    }

    return results;
  }

  getAttributes(pathValue: string): AttributeQueryMatch[] {
    const normalizedPath = String(pathValue || "").trim();
    if (!normalizedPath) return [];
    if (!normalizedPath.includes("*")) {
      const direct = this.attributeByPath.get(normalizedPath);
      return direct ? [{ ...direct }] : [];
    }
    return this.query(normalizedPath).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
  }

  getValue(pathValue: string, defaultValue?: unknown): unknown {
    const matchesFound = this.getAttributes(pathValue);
    if (matchesFound.length === 0) return defaultValue;
    if (matchesFound.length === 1) return matchesFound[0].value;
    return matchesFound.map((item) => item.value);
  }

  findAttributesByValue(pathValue: string, expectedValue: unknown, options: { strict?: boolean } = {}): FindAttributesResult {
    const strict = options.strict === true;
    const matchesFound = this.getAttributes(pathValue).filter((item) =>
      strict ? valuesEqual(item.value, expectedValue) : valuesLooselyEqual(item.value, expectedValue)
    );
    const assetsMap = new Map<string, { assetId: string; path: string }>();
    for (const item of matchesFound) {
      if (assetsMap.has(item.assetId)) continue;
      assetsMap.set(item.assetId, {
        assetId: item.assetId,
        path: this.assetPathById.get(item.assetId) || splitPath(item.path).slice(0, -1).join(".")
      });
    }
    return {
      path: pathValue,
      expectedValue,
      strict,
      count: matchesFound.length,
      assetCount: assetsMap.size,
      matches: matchesFound.map((item) => ({ ...item })),
      assets: Array.from(assetsMap.values())
    };
  }

  getHierarchy(options: { populateAttributes?: boolean } = {}): AssetHierarchyNode[] {
    const populateAttributes = options.populateAttributes !== false;
    const buildNode = (asset: AssetDefinition): AssetHierarchyNode => {
      const children = (this.childrenByParentId.get(asset.id) || []).map(buildNode);
      const baseNode: AssetHierarchyNode = {
        id: asset.id,
        name: asset.name,
        path: this.assetPathById.get(asset.id) || "",
        parentId: asset.parentId ?? null,
        templateIds: Array.isArray(asset.templateIds) ? [...asset.templateIds] : [],
        attributes: structuredClone(asset.attributes || {}),
        children
      };
      if (!populateAttributes) return baseNode;

      const attributeMap = this.attributeMapByAssetId.get(asset.id) || new Map<string, AttributeQueryMatch>();
      const effectiveAttributes = Array.from(attributeMap.values())
        .map((attribute) => ({
          name: attribute.attributeName,
          value: attribute.value,
          valueType: attribute.type || "custom",
          unit: attribute.unit || "",
          ts: attribute.ts,
          historianEnabled: attribute.historianEnabled === true,
          historianTimeSourcePath: attribute.historianTimeSourcePath || "",
          historianTargetId: attribute.historianTargetId || "default",
          source: Object.prototype.hasOwnProperty.call(asset.attributes || {}, attribute.attributeName) ? "override" : "template"
        } as const))
        .sort((left, right) => left.name.localeCompare(right.name));

      return { ...baseNode, effectiveAttributes };
    };

    return (this.childrenByParentId.get(null) || []).map(buildNode);
  }

  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[] {
    const [result] = this.setAttributes([{ path: pathValue, value }]);
    return result?.matches || [];
  }

  setAttributes(items: Array<{ path: string; value: unknown }> = []): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> {
    const normalizedItems = items.filter(
      (item) =>
        !!item &&
        typeof item === "object" &&
        Object.prototype.hasOwnProperty.call(item, "path") &&
        Object.prototype.hasOwnProperty.call(item, "value")
    );
    if (normalizedItems.length === 0) return [];

    const resolvedTargetsByItem = normalizedItems.map((item) => ({
      path: String(item.path || ""),
      value: item.value,
      targets: this.resolveTargets(String(item.path || ""))
    }));
    const updatesByAssetId = new Map<string, Map<string, AssetAttributeValue>>();

    for (const item of resolvedTargetsByItem) {
      const timestamp = new Date().toISOString();
      for (const target of item.targets) {
        if (!updatesByAssetId.has(target.assetId)) updatesByAssetId.set(target.assetId, new Map<string, AssetAttributeValue>());
        updatesByAssetId.get(target.assetId)?.set(target.attributeName, { value: item.value, ts: timestamp });
      }
    }

    if (updatesByAssetId.size === 0) {
      return resolvedTargetsByItem.map((item) => ({ path: item.path, count: 0, matches: [] }));
    }

    const nextAssets = [...this.state.assets];

    for (const [assetId, updates] of updatesByAssetId.entries()) {
      const assetIndex = this.assetIndexById.get(assetId);
      if (assetIndex === undefined) continue;
      const currentAsset = nextAssets[assetIndex];
      if (!currentAsset) continue;

      const nextAttributes = { ...(currentAsset.attributes || {}) };
      for (const [attributeName, nextValue] of updates.entries()) {
        nextAttributes[attributeName] = nextValue;
      }

      const updatedAsset: AssetDefinition = {
        ...currentAsset,
        attributes: nextAttributes
      };
      nextAssets[assetIndex] = updatedAsset;

      this.assetById.set(assetId, updatedAsset);
      const assetPath = this.assetPathById.get(assetId) || "";
      this.assetByPath.set(assetPath, updatedAsset);
      this.rebuildAttributeIndexForAsset(updatedAsset, assetPath);
    }

    this.state = {
      ...this.state,
      assets: nextAssets
    };

    const changedByKey = new Map<string, AttributeQueryMatch>();
    for (const item of resolvedTargetsByItem) {
      for (const target of item.targets) {
        const assetPath = this.assetPathById.get(target.assetId);
        if (!assetPath) continue;
        const match = this.attributeByPath.get(`${assetPath}.${target.attributeName}`);
        if (!match) continue;
        changedByKey.set(`${target.assetId}:${target.attributeName}`, { ...match });
      }
    }

    return resolvedTargetsByItem.map((item) => {
      const matches = item.targets
        .map((target) => changedByKey.get(`${target.assetId}:${target.attributeName}`))
        .filter((match): match is AttributeQueryMatch => !!match)
        .map((match) => ({ ...match }));
      return {
        path: item.path,
        count: matches.length,
        matches
      };
    });
  }

  private resolveTargets(pathValue: string): ResolvedAttributeTarget[] {
    const normalizedPath = String(pathValue || "").trim();
    if (!normalizedPath) return [];

    if (!normalizedPath.includes("*")) {
      const direct = this.attributeByPath.get(normalizedPath);
      if (direct) {
        return [{ assetId: direct.assetId, attributeName: direct.attributeName }];
      }
    }

    const segments = splitPath(normalizedPath);
    if (segments.length < 2) return [];
    const attributePattern = segments[segments.length - 1];
    if (!attributePattern) return [];
    const assetPatternSegments = segments.slice(0, -1);
    const targets: ResolvedAttributeTarget[] = [];

    for (const entry of this.assetPathEntries) {
      if (entry.segments.length !== assetPatternSegments.length) continue;
      if (!assetPatternSegments.every((segment, index) => matches(segment, entry.segments[index]))) continue;
      const attributeMap = this.attributeMapByAssetId.get(entry.assetId);
      if (!attributeMap) continue;
      if (attributePattern === "*") {
        for (const attributeName of attributeMap.keys()) {
          targets.push({ assetId: entry.assetId, attributeName });
        }
        continue;
      }
      if (attributeMap.has(attributePattern)) {
        targets.push({ assetId: entry.assetId, attributeName: attributePattern });
      }
    }

    return targets;
  }

  private rebuildAllIndexes(): void {
    this.templateById = new Map((this.state.attributeTemplates || []).map((template) => [template.id, template]));
    this.assetById = new Map((this.state.assets || []).map((asset) => [asset.id, asset]));
    this.assetIndexById = new Map((this.state.assets || []).map((asset, index) => [asset.id, index]));
    this.assetPathEntries = [];
    this.assetPathById = new Map();
    this.assetPathEntryById = new Map();
    this.assetByPath = new Map();
    this.attributeMapByAssetId = new Map();
    this.attributeByPath = new Map();
    this.childrenByParentId = new Map();

    for (const asset of this.state.assets || []) {
      const parentKey = asset.parentId ?? null;
      const siblings = this.childrenByParentId.get(parentKey) || [];
      siblings.push(asset);
      this.childrenByParentId.set(parentKey, siblings);
    }
    for (const siblings of this.childrenByParentId.values()) {
      siblings.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    }

    for (const asset of this.state.assets || []) {
      const path = getAssetPath(asset.id, this.assetById);
      const entry: AssetPathEntry = {
        assetId: asset.id,
        path,
        segments: splitPath(path)
      };
      this.assetPathEntries.push(entry);
      this.assetPathById.set(asset.id, path);
      this.assetPathEntryById.set(asset.id, entry);
      this.assetByPath.set(path, asset);
    }

    for (const asset of this.state.assets || []) {
      this.rebuildAttributeIndexForAsset(asset, this.assetPathById.get(asset.id) || "");
    }
  }

  private rebuildAttributeIndexForAsset(asset: AssetDefinition, assetPath: string): void {
    const previousMap = this.attributeMapByAssetId.get(asset.id);
    if (previousMap) {
      for (const previous of previousMap.values()) {
        this.attributeByPath.delete(previous.path);
      }
    }

    const nextMap = new Map<string, AttributeQueryMatch>();
    const effectiveAttributes = this.templateService.buildEffectiveAttributeMap(asset, this.templateById);
    for (const [attributeName, attribute] of effectiveAttributes.entries()) {
      const match = this.toAttributeMatch(asset.id, assetPath, attributeName, attribute);
      nextMap.set(attributeName, match);
      this.attributeByPath.set(match.path, match);
    }
    this.attributeMapByAssetId.set(asset.id, nextMap);
  }

  private toAttributeMatch(assetId: string, assetPath: string, attributeName: string, attribute: EffectiveAttributeRecord): AttributeQueryMatch {
    return {
      kind: "attribute",
      path: `${assetPath}.${attributeName}`,
      assetId,
      attributeName,
      value: attribute.value,
      ts: attribute.ts,
      type: attribute.valueType || "custom",
      unit: attribute.unit || "",
      historianEnabled: attribute.historianEnabled === true,
      historianTimeSourcePath: attribute.historianTimeSourcePath || "",
      historianTargetId: attribute.historianTargetId || "default"
    };
  }
}
