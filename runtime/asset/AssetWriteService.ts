import type { AssetChangeMeta, AssetDefinition, AssetSection, AttributeQueryMatch, AttributeTemplate } from "../core/runtimeTypes";
import { getAssetPath, matches, splitPath } from "./assetDataUtils";
import { AssetReadService } from "./AssetReadService";
import { AssetSchemaService } from "./AssetSchemaService";

interface ResolvedAttributeTarget {
  assetId: string;
  assetPath: string;
  attributeName: string;
}

interface AssetPathEntry {
  asset: AssetDefinition;
  path: string;
  pathSegments: string[];
}

export class AssetWriteService {
  private readonly getState: () => AssetSection;
  private readonly setState: (nextState: AssetSection) => void;
  private readonly emitChange: (change: AssetChangeMeta["change"]) => void;
  private readonly queryService: AssetReadService;
  private readonly templateService: AssetSchemaService;

  constructor(
    getState: () => AssetSection,
    setState: (nextState: AssetSection) => void,
    emitChange: (change: AssetChangeMeta["change"]) => void,
    queryService: AssetReadService,
    templateService: AssetSchemaService
  ) {
    this.getState = getState;
    this.setState = setState;
    this.emitChange = emitChange;
    this.queryService = queryService;
    this.templateService = templateService;
  }

  setAttributesByPathBatch(items: Array<{ path: string; value: unknown }> = []): Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> {
    const normalizedItems = items.filter(
      (item) =>
        !!item &&
        typeof item === "object" &&
        Object.prototype.hasOwnProperty.call(item, "path") &&
        Object.prototype.hasOwnProperty.call(item, "value")
    );
    if (normalizedItems.length === 0) return [];

    const state = this.getState();
    if (!Array.isArray(state.assets) || state.assets.length === 0) {
      return normalizedItems.map((item) => ({ path: item.path, count: 0, matches: [] }));
    }

    const templateById = new Map<string, AttributeTemplate>((state.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map<string, AssetDefinition>((state.assets || []).map((asset) => [asset.id, asset]));
    const assetEntries: AssetPathEntry[] = (state.assets || []).map((asset) => ({
      asset,
      path: getAssetPath(asset.id, assetById),
      pathSegments: splitPath(getAssetPath(asset.id, assetById))
    }));
    const effectiveNamesCache = new Map<string, Set<string>>();
    const finalValueByKey = new Map<string, { value: unknown; ts: string }>();
    const resolvedTargetsByItem = normalizedItems.map((item) => ({
      path: item.path,
      value: item.value,
      targets: this.resolveTargetsForPath(String(item.path || ""), assetEntries, templateById, effectiveNamesCache)
    }));

    for (const item of resolvedTargetsByItem) {
      const ts = new Date().toISOString();
      for (const target of item.targets) {
        finalValueByKey.set(`${target.assetId}:${target.attributeName}`, { value: item.value, ts });
      }
    }

    if (finalValueByKey.size === 0) {
      return resolvedTargetsByItem.map((item) => ({ path: item.path, count: 0, matches: [] }));
    }

    const nextState: AssetSection = {
      ...state,
      assets: state.assets.map((asset) => {
        const nextAttributes = asset.attributes || {};
        let hasChange = false;
        const updatedAttributes: Record<string, unknown> = { ...nextAttributes };
        for (const key of finalValueByKey.keys()) {
          const [assetId, attributeName] = key.split(":");
          if (assetId !== asset.id) continue;
          const nextValue = finalValueByKey.get(key);
          if (!nextValue) continue;
          updatedAttributes[attributeName] = { value: nextValue.value, ts: nextValue.ts };
          hasChange = true;
        }
        if (!hasChange) return asset;
        return { ...asset, attributes: updatedAttributes };
      })
    };

    this.setState(nextState);

    const nextAssetById = new Map<string, AssetDefinition>((nextState.assets || []).map((asset) => [asset.id, asset]));
    const nextEffectiveMapCache = new Map<string, Map<string, ReturnType<AssetSchemaService["buildEffectiveAttributeMap"]> extends Map<string, infer TValue> ? TValue : never>>();
    const changedMatchByKey = new Map<string, AttributeQueryMatch>();

    for (const key of finalValueByKey.keys()) {
      const [assetId, attributeName] = key.split(":");
      const asset = nextAssetById.get(assetId);
      if (!asset) continue;
      const effectiveMap = this.getEffectiveAttributeMap(asset, templateById, nextEffectiveMapCache);
      const attribute = effectiveMap.get(attributeName);
      if (!attribute) continue;
      changedMatchByKey.set(key, {
        kind: "attribute",
        path: `${getAssetPath(asset.id, nextAssetById)}.${attributeName}`,
        assetId,
        attributeName,
        value: attribute.value,
        ts: attribute.ts,
        type: attribute.valueType || "custom",
        unit: attribute.unit || "",
        historianEnabled: attribute.historianEnabled === true,
        historianTimeSourcePath: attribute.historianTimeSourcePath || "",
        historianTargetId: attribute.historianTargetId || "default"
      });
    }

    const changedMatches = Array.from(changedMatchByKey.values());
    this.emitChange({
      type: "attribute.set",
      pattern: normalizedItems.length === 1 ? String(normalizedItems[0].path || "") : "__batch__",
      changes: changedMatches.map((item) => ({ ...item }))
    });

    return resolvedTargetsByItem.map((item) => {
      const matches = item.targets
        .map((target) => changedMatchByKey.get(`${target.assetId}:${target.attributeName}`))
        .filter((match): match is AttributeQueryMatch => !!match)
        .map((match) => ({ ...match }));
      return {
        path: item.path,
        count: matches.length,
        matches
      };
    });
  }

  setAttributeByPath(pathValue: string, value: unknown): AttributeQueryMatch[] {
    const state = this.getState();
    let pathMatches = this.queryService.getAttributes(pathValue);

    if (pathMatches.length === 0) {
      const segments = splitPath(pathValue);
      if (segments.length < 2) return [];
      const attrName = segments[segments.length - 1];
      if (!attrName || attrName === "*") return [];

      const assetPattern = segments.slice(0, -1).join(".");
      const assetMatches = this.queryService.resolve(assetPattern).filter((item) => item.kind === "asset");
      if (assetMatches.length === 0) return [];

      const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
      const updatesByAssetId = new Map<string, string[]>();
      for (const item of assetMatches) {
        const targetAsset = state.assets.find((asset) => asset.id === item.assetId);
        if (!targetAsset) continue;
        const effectiveMap = this.templateService.buildEffectiveAttributeMap(targetAsset, templateById);
        if (!effectiveMap.has(attrName)) continue;
        updatesByAssetId.set(item.assetId, [attrName]);
      }
      if (updatesByAssetId.size === 0) return [];

      this.setState({
        ...state,
        assets: state.assets.map((asset) => {
          const names = updatesByAssetId.get(asset.id);
          if (!names || names.length === 0) return asset;
          const nextAttributes = { ...(asset.attributes || {}) };
          for (const name of names) {
            nextAttributes[name] = { value, ts: new Date().toISOString() };
          }
          return { ...asset, attributes: nextAttributes };
        })
      });

      pathMatches = this.queryService.getAttributes(pathValue);
      const changedKeys = new Set(Array.from(updatesByAssetId.entries()).map(([assetId, names]) => `${assetId}:${names[0]}`));
      const changedMatches = pathMatches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
      this.emitChange({
        type: "attribute.set",
        pattern: pathValue,
        changes: changedMatches.map((item) => ({ ...item }))
      });
      return changedMatches;
    }

    const updatesByAssetId = new Map<string, string[]>();
    for (const item of pathMatches) {
      if (!updatesByAssetId.has(item.assetId)) updatesByAssetId.set(item.assetId, []);
      updatesByAssetId.get(item.assetId)?.push(item.attributeName);
    }

    this.setState({
      ...state,
      assets: state.assets.map((asset) => {
        const names = updatesByAssetId.get(asset.id);
        if (!names || names.length === 0) return asset;
        const nextAttributes = { ...(asset.attributes || {}) };
        for (const name of names) {
          nextAttributes[name] = { value, ts: new Date().toISOString() };
        }
        return { ...asset, attributes: nextAttributes };
      })
    });

    const nextMatches = this.queryService.getAttributes(pathValue);
    const changedKeys = new Set<string>();
    for (const [assetId, names] of updatesByAssetId.entries()) {
      for (const name of names) changedKeys.add(`${assetId}:${name}`);
    }
    const changedMatches = nextMatches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
    this.emitChange({
      type: "attribute.set",
      pattern: pathValue,
      changes: changedMatches.map((item) => ({ ...item }))
    });
    return changedMatches;
  }

  private resolveTargetsForPath(
    pathValue: string,
    assetEntries: AssetPathEntry[],
    templateById: Map<string, AttributeTemplate>,
    effectiveNamesCache: Map<string, Set<string>>
  ): ResolvedAttributeTarget[] {
    const segments = splitPath(pathValue);
    if (segments.length < 2) return [];
    const attributePattern = segments[segments.length - 1];
    if (!attributePattern || attributePattern === "") return [];
    const assetPatternSegments = segments.slice(0, -1);
    const targets: ResolvedAttributeTarget[] = [];

    for (const entry of assetEntries) {
      if (assetPatternSegments.length !== entry.pathSegments.length) continue;
      if (!assetPatternSegments.every((segment, index) => matches(segment, entry.pathSegments[index]))) continue;

      const effectiveNames = this.getEffectiveAttributeNames(entry.asset, templateById, effectiveNamesCache);
      if (attributePattern === "*") {
        for (const attributeName of effectiveNames) {
          targets.push({
            assetId: entry.asset.id,
            assetPath: entry.path,
            attributeName
          });
        }
        continue;
      }

      if (!effectiveNames.has(attributePattern)) continue;
      targets.push({
        assetId: entry.asset.id,
        assetPath: entry.path,
        attributeName: attributePattern
      });
    }

    return targets;
  }

  private getEffectiveAttributeNames(
    asset: AssetDefinition,
    templateById: Map<string, AttributeTemplate>,
    effectiveNamesCache: Map<string, Set<string>>
  ): Set<string> {
    const cached = effectiveNamesCache.get(asset.id);
    if (cached) return cached;
    const effectiveMap = this.templateService.buildEffectiveAttributeMap(asset, templateById);
    const names = new Set<string>(effectiveMap.keys());
    effectiveNamesCache.set(asset.id, names);
    return names;
  }

  private getEffectiveAttributeMap(
    asset: AssetDefinition,
    templateById: Map<string, AttributeTemplate>,
    cache: Map<string, Map<string, ReturnType<AssetSchemaService["buildEffectiveAttributeMap"]> extends Map<string, infer TValue> ? TValue : never>>
  ) {
    const cached = cache.get(asset.id);
    if (cached) return cached;
    const effectiveMap = this.templateService.buildEffectiveAttributeMap(asset, templateById);
    cache.set(asset.id, effectiveMap);
    return effectiveMap;
  }
}
