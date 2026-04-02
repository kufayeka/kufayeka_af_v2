import type { AssetChangeMeta, AssetSection, AttributeQueryMatch } from "../core/runtimeTypes";
import { splitPath } from "./assetDataUtils";
import { AssetReadService } from "./AssetReadService";
import { AssetSchemaService } from "./AssetSchemaService";

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
}
