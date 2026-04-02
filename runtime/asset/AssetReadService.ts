import type { AssetSection, AttributeQueryMatch, FindAttributesResult, QueryMatch } from "../core/runtimeTypes";
import { getAssetPath, matches, splitPath, valuesEqual, valuesLooselyEqual } from "./assetDataUtils";
import { AssetSchemaService } from "./AssetSchemaService";

export class AssetReadService {
  private readonly getState: () => AssetSection;
  private readonly templateService: AssetSchemaService;

  constructor(getState: () => AssetSection, templateService: AssetSchemaService) {
    this.getState = getState;
    this.templateService = templateService;
  }

  resolve(pathValue: string): QueryMatch[] {
    const state = this.getState();
    const segments = splitPath(pathValue);
    const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const resolvedAssets = (state.assets || []).map((asset) => ({ asset, path: getAssetPath(asset.id, assetById) }));
    const results: QueryMatch[] = [];

    for (const node of resolvedAssets) {
      const pathSegments = splitPath(node.path);
      const isAssetQuery = segments.length === pathSegments.length && segments.every((segment, index) => matches(segment, pathSegments[index]));
      if (isAssetQuery) {
        results.push({
          kind: "asset",
          path: node.path,
          assetId: node.asset.id,
          value: node.asset
        });
      }

      const isAttributeQuery =
        segments.length === pathSegments.length + 1 && segments.slice(0, -1).every((segment, index) => matches(segment, pathSegments[index]));
      if (!isAttributeQuery) continue;

      const attrSegment = segments[segments.length - 1];
      const attributes = this.templateService.buildEffectiveAttributeMap(node.asset, templateById);
      for (const [name, attribute] of attributes.entries()) {
        if (attrSegment !== "*" && attrSegment !== name) continue;
        results.push({
          kind: "attribute",
          path: `${node.path}.${name}`,
          assetId: node.asset.id,
          attributeName: name,
          value: attribute.value,
          ts: attribute.ts,
          type: attribute.valueType || "custom",
          unit: attribute.unit || "",
          historianEnabled: attribute.historianEnabled === true,
          historianTimeSourcePath: attribute.historianTimeSourcePath || "",
          historianTargetId: attribute.historianTargetId || "default"
        });
      }
    }
    return results;
  }

  getAttributes(pathValue: string): AttributeQueryMatch[] {
    return this.resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
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
      const pathSegments = splitPath(item.path);
      const assetPath = pathSegments.slice(0, -1).join(".");
      assetsMap.set(item.assetId, { assetId: item.assetId, path: assetPath });
    }
    return {
      path: pathValue,
      expectedValue,
      strict,
      count: matchesFound.length,
      assetCount: assetsMap.size,
      matches: matchesFound,
      assets: Array.from(assetsMap.values())
    };
  }
}
