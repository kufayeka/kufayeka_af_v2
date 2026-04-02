import type { AssetHierarchyNode, AssetSection } from "../core/runtimeTypes";
import { getAssetPath } from "./assetDataUtils";
import { AssetSchemaService } from "./AssetSchemaService";

export class AssetTreeService {
  private readonly getState: () => AssetSection;
  private readonly templateService: AssetSchemaService;

  constructor(getState: () => AssetSection, templateService: AssetSchemaService) {
    this.getState = getState;
    this.templateService = templateService;
  }

  buildHierarchy(options: { populateAttributes?: boolean } = {}): AssetHierarchyNode[] {
    const state = this.getState();
    const populateAttributes = options.populateAttributes !== false;
    const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const childrenByParentId = new Map<string | null, typeof state.assets>();

    for (const asset of state.assets || []) {
      const key = asset.parentId ?? null;
      const list = childrenByParentId.get(key) || [];
      list.push(asset);
      childrenByParentId.set(key, list);
    }

    for (const [, list] of childrenByParentId) {
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    const toNode = (asset: (typeof state.assets)[number]): AssetHierarchyNode => {
      const path = getAssetPath(asset.id, assetById);
      const children = (childrenByParentId.get(asset.id) || []).map(toNode);
      const baseNode: AssetHierarchyNode = {
        id: asset.id,
        name: asset.name,
        path,
        parentId: asset.parentId ?? null,
        templateIds: Array.isArray(asset.templateIds) ? [...asset.templateIds] : [],
        attributes: structuredClone(asset.attributes || {}),
        children
      };
      if (!populateAttributes) return baseNode;

      const effectiveAttributes = Array.from(this.templateService.buildEffectiveAttributeMap(asset, templateById).entries()).map(([name, attribute]) => {
        const isOverride = Object.prototype.hasOwnProperty.call(asset.attributes || {}, name);
        return {
          name,
          value: attribute.value,
          valueType: attribute.valueType || "custom",
          unit: attribute.unit || "",
          ts: attribute.ts,
          historianEnabled: attribute.historianEnabled === true,
          historianTimeSourcePath: attribute.historianTimeSourcePath || "",
          historianTargetId: attribute.historianTargetId || "default",
          source: isOverride ? "override" : "template"
        } as const;
      });
      effectiveAttributes.sort((a, b) => a.name.localeCompare(b.name));
      return { ...baseNode, effectiveAttributes };
    };

    return (childrenByParentId.get(null) || []).map(toNode);
  }
}
