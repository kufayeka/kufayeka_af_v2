import type {
  AssetAttributeValue,
  AssetDefinition,
  AssetHierarchyNode,
  AssetSection,
  AttributeQueryMatch,
  AttributeTemplate,
  FindAttributesResult,
  HistorianTarget,
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

interface AttributeWriteRequest {
  path: string;
  value: unknown;
  targets: ResolvedAttributeTarget[];
}

interface AttributeWriteResult {
  path: string;
  count: number;
  matches: AttributeQueryMatch[];
}

type EffectiveAttributeRecord = ReturnType<AssetSchemaService["buildEffectiveAttributeMap"]> extends Map<string, infer TValue>
  ? TValue
  : never;

/**
 * Fast lookup layer for the active AssetSection.
 *
 * AssetStoreFactory owns revisions and subscriptions. This class owns the
 * keyspace itself: `assetById` is the primary source of truth (a plain
 * mutable Map, patched in place per write, O(1) per touched asset) plus the
 * derived indexes that make path reads, wildcard queries, hierarchy views,
 * and attribute writes predictable. `AssetSection.assets` (the array shape)
 * is only materialized on demand in `getState()` — it is not kept warm on
 * every write.
 */
export class AssetStoreIndex {
  private readonly templateService: AssetSchemaService;
  private attributeTemplatesList: AttributeTemplate[] = [];
  private historiansList: HistorianTarget[] = [];
  private templateById = new Map<string, AttributeTemplate>();
  private assetById = new Map<string, AssetDefinition>();
  private assetPathEntries: AssetPathEntry[] = [];
  private assetPathById = new Map<string, string>();
  private assetByPath = new Map<string, AssetDefinition>();
  private attributeMapByAssetId = new Map<string, Map<string, AttributeQueryMatch>>();
  private attributeByPath = new Map<string, AttributeQueryMatch>();
  private childrenByParentId = new Map<string | null, AssetDefinition[]>();

  constructor(initialState: AssetSection, templateService: AssetSchemaService) {
    this.templateService = templateService;
    this.rebuildAllIndexes(initialState);
  }

  getState(): AssetSection {
    return {
      assets: Array.from(this.assetById.values()),
      attributeTemplates: this.attributeTemplatesList,
      historians: this.historiansList
    };
  }

  getHistorianTargets(): HistorianTarget[] {
    return [...this.historiansList];
  }

  replaceState(nextState: AssetSection): { state: AssetSection; changedMatches: AttributeQueryMatch[] } {
    const previousAttributes = this.attributeByPath;
    this.rebuildAllIndexes(nextState);

    const changedMatches: AttributeQueryMatch[] = [];
    for (const [path, nextMatch] of this.attributeByPath.entries()) {
      const previousMatch = previousAttributes.get(path);
      if (this.templateService.attributeMatchChanged(previousMatch, nextMatch)) {
        changedMatches.push({ ...nextMatch });
      }
    }

    return { state: this.getState(), changedMatches };
  }

  // Query by exact path or wildcard path. Asset paths and attribute paths share
  // the same dotted namespace, for example Plant.Line.Motor.Speed.
  query(pathValue: string): QueryMatch[] {
    const normalizedPath = String(pathValue || "").trim();
    if (!normalizedPath) return [];
    const segments = splitPath(normalizedPath);
    if (segments.length === 0) return [];

    const hasWildcard = segments.some((segment) => segment === "*");
    if (!hasWildcard) {
      return this.queryExactPath(normalizedPath);
    }

    const results: QueryMatch[] = [];
    for (const assetPathEntry of this.assetPathEntries) {
      if (this.matchesAssetPath(segments, assetPathEntry)) {
        const asset = this.assetById.get(assetPathEntry.assetId);
        if (asset) {
          results.push({
            kind: "asset",
            path: assetPathEntry.path,
            assetId: asset.id,
            value: asset
          });
        }
      }

      if (!this.matchesAttributePathPrefix(segments, assetPathEntry)) continue;

      const attributePattern = segments[segments.length - 1];
      results.push(...this.queryAttributesForAsset(assetPathEntry.assetId, attributePattern));
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

  // Apply one or many attribute writes against the indexed state, then return
  // the effective attribute matches that changed.
  setAttribute(pathValue: string, value: unknown): AttributeQueryMatch[] {
    const [result] = this.setAttributes([{ path: pathValue, value }]);
    return result?.matches || [];
  }

  setAttributes(items: Array<{ path: string; value: unknown }> = []): AttributeWriteResult[] {
    const writeRequests = this.toAttributeWriteRequests(items);
    if (writeRequests.length === 0) return [];

    const writesByAssetId = this.groupWritesByAsset(writeRequests);
    if (writesByAssetId.size === 0) {
      return writeRequests.map((request) => ({ path: request.path, count: 0, matches: [] }));
    }

    this.applyGroupedAttributeWrites(writesByAssetId);

    const changedAttributesByTarget = this.collectChangedAttributes(writeRequests);
    return this.toWriteResults(writeRequests, changedAttributesByTarget);
  }

  private queryExactPath(normalizedPath: string): QueryMatch[] {
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

  private matchesAssetPath(querySegments: string[], assetPathEntry: AssetPathEntry): boolean {
    return (
      querySegments.length === assetPathEntry.segments.length &&
      querySegments.every((segment, index) => matches(segment, assetPathEntry.segments[index]))
    );
  }

  private matchesAttributePathPrefix(querySegments: string[], assetPathEntry: AssetPathEntry): boolean {
    return (
      querySegments.length === assetPathEntry.segments.length + 1 &&
      querySegments.slice(0, -1).every((segment, index) => matches(segment, assetPathEntry.segments[index]))
    );
  }

  private queryAttributesForAsset(assetId: string, attributePattern: string): AttributeQueryMatch[] {
    const attributes = this.attributeMapByAssetId.get(assetId);
    if (!attributes) return [];

    const matchedAttributes: AttributeQueryMatch[] = [];
    for (const [attributeName, match] of attributes.entries()) {
      if (!matches(attributePattern, attributeName)) continue;
      matchedAttributes.push({ ...match });
    }
    return matchedAttributes;
  }

  private toAttributeWriteRequests(items: Array<{ path: string; value: unknown }>): AttributeWriteRequest[] {
    return items
      .filter(
        (item) =>
          !!item &&
          typeof item === "object" &&
          Object.prototype.hasOwnProperty.call(item, "path") &&
          Object.prototype.hasOwnProperty.call(item, "value")
      )
      .map((item) => {
        const path = String(item.path || "");
        return {
          path,
          value: item.value,
          targets: this.resolveTargets(path)
        };
      });
  }

  private groupWritesByAsset(writeRequests: AttributeWriteRequest[]): Map<string, Map<string, AssetAttributeValue>> {
    const writesByAssetId = new Map<string, Map<string, AssetAttributeValue>>();

    for (const request of writeRequests) {
      const timestamp = new Date().toISOString();
      for (const target of request.targets) {
        if (!writesByAssetId.has(target.assetId)) {
          writesByAssetId.set(target.assetId, new Map<string, AssetAttributeValue>());
        }
        writesByAssetId.get(target.assetId)?.set(target.attributeName, {
          value: request.value,
          ts: timestamp
        });
      }
    }

    return writesByAssetId;
  }

  private applyGroupedAttributeWrites(writesByAssetId: Map<string, Map<string, AssetAttributeValue>>): void {
    for (const [assetId, attributeWrites] of writesByAssetId.entries()) {
      const currentAsset = this.assetById.get(assetId);
      if (!currentAsset) continue;

      const nextAttributes = { ...(currentAsset.attributes || {}) };
      for (const [attributeName, nextValue] of attributeWrites.entries()) {
        nextAttributes[attributeName] = nextValue;
      }

      const updatedAsset: AssetDefinition = {
        ...currentAsset,
        attributes: nextAttributes
      };

      this.refreshAssetIndexes(updatedAsset);
    }
  }

  private refreshAssetIndexes(updatedAsset: AssetDefinition): void {
    this.assetById.set(updatedAsset.id, updatedAsset);

    const assetPath = this.assetPathById.get(updatedAsset.id) || "";
    this.assetByPath.set(assetPath, updatedAsset);
    this.rebuildAttributeIndexForAsset(updatedAsset, assetPath);
  }

  private collectChangedAttributes(writeRequests: AttributeWriteRequest[]): Map<string, AttributeQueryMatch> {
    const changedAttributesByTarget = new Map<string, AttributeQueryMatch>();

    for (const request of writeRequests) {
      for (const target of request.targets) {
        const assetPath = this.assetPathById.get(target.assetId);
        if (!assetPath) continue;

        const match = this.attributeByPath.get(`${assetPath}.${target.attributeName}`);
        if (!match) continue;

        changedAttributesByTarget.set(this.targetKey(target), { ...match });
      }
    }

    return changedAttributesByTarget;
  }

  private toWriteResults(
    writeRequests: AttributeWriteRequest[],
    changedAttributesByTarget: Map<string, AttributeQueryMatch>
  ): AttributeWriteResult[] {
    return writeRequests.map((request) => {
      const matches = request.targets
        .map((target) => changedAttributesByTarget.get(this.targetKey(target)))
        .filter((match): match is AttributeQueryMatch => !!match)
        .map((match) => ({ ...match }));

      return {
        path: request.path,
        count: matches.length,
        matches
      };
    });
  }

  private targetKey(target: ResolvedAttributeTarget): string {
    return `${target.assetId}:${target.attributeName}`;
  }

  // Convert user-facing paths into concrete asset + attribute targets.
  // This keeps wildcard write behavior in one place.
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

  // Rebuild every lookup map (and the primary `assetById` keyspace) from a
  // canonical AssetSection. Call this on construction or after a full state
  // replacement — never on a single-attribute write, which instead patches
  // `assetById` in place via `refreshAssetIndexes`.
  private rebuildAllIndexes(section: AssetSection): void {
    this.attributeTemplatesList = section.attributeTemplates || [];
    this.historiansList = section.historians || [];
    this.templateById = new Map(this.attributeTemplatesList.map((template) => [template.id, template]));
    this.assetById = new Map((section.assets || []).map((asset) => [asset.id, asset]));
    this.assetPathEntries = [];
    this.assetPathById = new Map();
    this.assetByPath = new Map();
    this.attributeMapByAssetId = new Map();
    this.attributeByPath = new Map();
    this.childrenByParentId = new Map();

    for (const asset of this.assetById.values()) {
      const parentKey = asset.parentId ?? null;
      const siblings = this.childrenByParentId.get(parentKey) || [];
      siblings.push(asset);
      this.childrenByParentId.set(parentKey, siblings);
    }
    for (const siblings of this.childrenByParentId.values()) {
      siblings.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    }

    for (const asset of this.assetById.values()) {
      const path = getAssetPath(asset.id, this.assetById);
      const entry: AssetPathEntry = {
        assetId: asset.id,
        path,
        segments: splitPath(path)
      };
      this.assetPathEntries.push(entry);
      this.assetPathById.set(asset.id, path);
      this.assetByPath.set(path, asset);
    }

    for (const asset of this.assetById.values()) {
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
