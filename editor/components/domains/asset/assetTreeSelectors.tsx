import type { DataNode, Key } from "rc-tree/lib/interface";
import { Database } from "lucide-react";
import type { AssetDefinition } from "../../../types/program";
import {
  buildChildrenMap,
  collectTreeKeys,
  getAssetPath,
  serializeValue,
  TREE_BOTTOM_SPACER_KEY,
  type EffectiveAttributeRow
} from "./assetManagerUtils";

export function filterEffectiveAttributeRows(
  rows: EffectiveAttributeRow[],
  keyword: string
): EffectiveAttributeRow[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) =>
    `${row.name} ${serializeValue(row.value, row)} ${row.unit || ""}`.toLowerCase().includes(normalized)
  );
}

export function buildAssetAttributePaths(
  assets: AssetDefinition[],
  assetById: Map<string, AssetDefinition>,
  templateById: Map<string, { attributes: Array<{ enabled?: boolean; name: string }> }>
): string[] {
  const options: string[] = [];
  for (const asset of assets) {
    const basePath = getAssetPath(asset, assetById);
    const names = new Set<string>();
    for (const templateId of asset.templateIds) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attribute of template.attributes) {
        if (attribute.enabled === false) continue;
        names.add(attribute.name);
      }
    }
    for (const name of Object.keys(asset.attributes || {})) {
      names.add(name);
    }
    for (const name of names) {
      options.push(`${basePath}.${name}`);
    }
  }
  options.sort((a, b) => a.localeCompare(b));
  return options;
}

export function buildAssetTreeData(args: {
  assets: AssetDefinition[];
  assetById: Map<string, AssetDefinition>;
  effectiveAttributesByAssetId: Map<string, EffectiveAttributeRow[]>;
  assetSearch: string;
  attributeSearch: string;
}): DataNode[] {
  const { assets, assetById, effectiveAttributesByAssetId, assetSearch, attributeSearch } = args;
  const assetKeyword = assetSearch.trim().toLowerCase();
  const attributeKeyword = attributeSearch.trim().toLowerCase();
  const childrenMap = buildChildrenMap(assets);
  const result: DataNode[] = [];

  const includeAsset = (asset: AssetDefinition, attrs: EffectiveAttributeRow[]) => {
    const path = getAssetPath(asset, assetById).toLowerCase();
    const assetHit = !assetKeyword || path.includes(assetKeyword);
    const attrHit =
      !attributeKeyword ||
      attrs.some((attr) =>
        `${attr.name} ${serializeValue(attr.value, attr)} ${attr.unit || ""}`.toLowerCase().includes(attributeKeyword)
      );
    return assetHit && attrHit;
  };

  const buildNode = (asset: AssetDefinition): DataNode | null => {
    const attrs = effectiveAttributesByAssetId.get(asset.id) || [];
    const childAssets = (childrenMap.get(asset.id) || []).map(buildNode).filter(Boolean) as DataNode[];
    const selfIncluded = includeAsset(asset, attrs);
    if (!selfIncluded && childAssets.length === 0) return null;

    return {
      key: `asset:${asset.id}`,
      title: (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minHeight: 24
          }}
        >
          <Database size={14} />
          <span>{asset.name}</span>
        </span>
      ),
      children: childAssets
    };
  };

  for (const root of childrenMap.get(null) || []) {
    const node = buildNode(root);
    if (node) result.push(node);
  }

  if (result.length > 0) {
    result.push({
      key: TREE_BOTTOM_SPACER_KEY,
      title: <span style={{ display: "block", height: 96 }} />,
      disabled: true,
      selectable: false,
      isLeaf: true
    });
  }

  return result;
}

export function buildAutoExpandedKeys(
  treeData: DataNode[],
  expandedKeys: Key[],
  assetSearch: string,
  attributeSearch: string
): Key[] {
  return assetSearch.trim() || attributeSearch.trim() ? collectTreeKeys(treeData) : expandedKeys;
}

export function buildVisibleAttributeRows(args: {
  scrollTop: number;
  rows: EffectiveAttributeRow[];
  rowHeight: number;
  viewportHeight: number;
}) {
  const { scrollTop, rows, rowHeight, viewportHeight } = args;
  const overscan = 8;
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(rows.length, startIndex + visibleCount + overscan * 2);
  return {
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex),
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: Math.max(0, (rows.length - endIndex) * rowHeight)
  };
}
