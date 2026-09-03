import type {
  AssetAttributeTemplate,
  AssetDefinition,
  AssetSection,
  AttributeQueryMatch,
  AttributeTemplate,
  HistorianTarget
} from "../core/runtimeTypes";
import { coerceAttributeValue, getAssetPath, normalizeValueType, toObject, valuesEqual } from "./assetDataUtils";

const DEFAULT_HISTORIAN_TARGET: HistorianTarget = {
  id: "default",
  name: "Default Historian",
  timestampUnit: "us",
  enabled: true
};

function normalizeAsset(input: unknown): AssetDefinition {
  const src = toObject(input);
  return {
    id: String(src.id ?? ""),
    name: String(src.name ?? ""),
    parentId: src.parentId == null ? null : String(src.parentId),
    templateIds: Array.isArray(src.templateIds) ? src.templateIds.map((x) => String(x)) : [],
    attributes: toObject(src.attributes)
  };
}

function normalizeAssetAttributeTemplate(input: unknown): AssetAttributeTemplate {
  const src = toObject(input);
  return {
    enabled: src.enabled !== false,
    name: String(src.name ?? ""),
    valueType: normalizeValueType(src.valueType ?? src.type ?? "string"),
    default: Object.prototype.hasOwnProperty.call(src, "default") ? src.default : src.defaultValue,
    unit: String(src.unit ?? ""),
    historianEnabled: src.historianEnabled === true,
    historianTimeSourcePath: String(src.historianTimeSourcePath ?? ""),
    historianTargetId: String(src.historianTargetId ?? "default"),
    dashboardVisible: src.dashboardVisible === true,
    dashboardEditable: src.dashboardEditable !== false,
    nullable: src.nullable === true,
    inputType: String(src.inputType ?? src.inputMode ?? "text"),
    options: Array.isArray(src.options) ? src.options : [],
    optionsScript: String(src.optionsScript ?? src.optionsTransformScript ?? ""),
    numberMin: typeof src.numberMin === "number" ? src.numberMin : null,
    numberMax: typeof src.numberMax === "number" ? src.numberMax : null,
    numberAllowNegative: src.numberAllowNegative !== false,
    numberUseThousandSeparator: src.numberUseThousandSeparator === true,
    numberPrefix: String(src.numberPrefix ?? ""),
    numberSuffix: String(src.numberSuffix ?? ""),
    numberAllowDecimal: src.numberAllowDecimal !== false,
    numberPrecision: Math.max(0, Math.min(10, Number(src.numberPrecision ?? 2) || 0))
  };
}

function normalizeTemplate(input: unknown): AttributeTemplate {
  const src = toObject(input);
  return {
    id: String(src.id ?? ""),
    name: String(src.name ?? ""),
    attributes: Array.isArray(src.attributes) ? src.attributes.map(normalizeAssetAttributeTemplate) : []
  };
}

function normalizeHistorian(input: unknown): HistorianTarget | null {
  const src = toObject(input);
  const id = String(src.id ?? "");
  if (!id.length) return null;
  return {
    id,
    name: String(src.name ?? src.id ?? ""),
    timestampUnit: String(src.timestampUnit ?? "us") === "ns" ? "ns" : "us",
    enabled: src.enabled !== false
  };
}

export class AssetSchemaService {
  normalizeSection(input: unknown = {}): AssetSection {
    const source = toObject(input);
    const rawAssets = Array.isArray(source.assets) ? source.assets.map(normalizeAsset) : [];
    const attributeTemplates = Array.isArray(source.attributeTemplates) ? source.attributeTemplates.map(normalizeTemplate) : [];
    const templateById = new Map((attributeTemplates || []).map((template) => [template.id, template]));
    const assets = rawAssets.map((asset) => {
      const allowedNames = new Set<string>();
      for (const templateId of asset.templateIds || []) {
        const template = templateById.get(templateId);
        if (!template) continue;
        for (const attribute of template.attributes || []) {
          if (attribute.enabled === false) continue;
          const name = String(attribute.name || "").trim();
          if (!name) continue;
          allowedNames.add(name);
        }
      }

      const nextAttributes: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(asset.attributes || {})) {
        if (!allowedNames.has(name)) continue;
        nextAttributes[name] = value;
      }
      return { ...asset, attributes: nextAttributes };
    });
    const historiansRaw = Array.isArray(source.historians) ? source.historians : [];
    const historians = [DEFAULT_HISTORIAN_TARGET, ...(historiansRaw.map(normalizeHistorian).filter(Boolean) as HistorianTarget[])].filter(
      (h, i, arr) => arr.findIndex((x) => x.id === h.id) === i
    );

    return { assets, attributeTemplates, historians };
  }

  buildEffectiveAttributeMap(asset: AssetDefinition, templateById: Map<string, AttributeTemplate>) {
    const map = new Map<
      string,
      {
        value: unknown;
        valueType?: string;
        defaultValue?: unknown;
        nullable?: boolean;
        unit?: string;
        ts?: string;
        numberAllowDecimal?: boolean;
        numberPrecision?: number;
        historianEnabled?: boolean;
        historianTimeSourcePath?: string;
        historianTargetId?: string;
      }
    >();

    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attribute of template.attributes || []) {
        if (attribute.enabled === false) continue;
        if (!map.has(attribute.name)) {
          map.set(attribute.name, {
            value: coerceAttributeValue(attribute.valueType, attribute.default, {
              defaultValue: attribute.default,
              nullable: attribute.nullable === true
            }),
            valueType: attribute.valueType,
            defaultValue: attribute.default,
            nullable: attribute.nullable === true,
            unit: attribute.unit ?? "",
            numberAllowDecimal: attribute.numberAllowDecimal !== false,
            numberPrecision: Math.max(0, Number(attribute.numberPrecision ?? 0) || 0),
            historianEnabled: attribute.historianEnabled === true,
            historianTimeSourcePath: String(attribute.historianTimeSourcePath ?? ""),
            historianTargetId: String(attribute.historianTargetId ?? "default")
          });
        }
      }
    }

    for (const [name, val] of Object.entries(asset.attributes || {})) {
      const item = val && typeof val === "object" ? (val as Record<string, unknown>) : null;
      map.set(name, {
        ...(map.get(name) || {}),
        value:
          item && Object.prototype.hasOwnProperty.call(item, "value")
            ? coerceAttributeValue(normalizeValueType(map.get(name)?.valueType ?? "string"), item.value, {
                defaultValue: map.get(name)?.defaultValue,
                nullable: map.get(name)?.nullable === true
              })
            : coerceAttributeValue(normalizeValueType(map.get(name)?.valueType ?? "string"), val, {
                defaultValue: map.get(name)?.defaultValue,
                nullable: map.get(name)?.nullable === true
              }),
        ts: item && Object.prototype.hasOwnProperty.call(item, "ts") ? String(item.ts) : undefined
      });
    }

    return map;
  }

  // Single-attribute counterpart to buildEffectiveAttributeMap(), used on the
  // write path so a single setAttribute() only recomputes the ONE attribute
  // that actually changed instead of re-deriving every attribute the asset
  // has (measured: writing 1 of 400 attributes cost ~24x more than writing 1
  // of 5, purely from this redundant recompute). Same coercion/precedence
  // rules as buildEffectiveAttributeMap, just scoped to one name -- keep the
  // two in lockstep if either changes.
  buildEffectiveAttributeForName(
    asset: AssetDefinition,
    templateById: Map<string, AttributeTemplate>,
    attributeName: string
  ):
    | {
        value: unknown;
        valueType?: string;
        defaultValue?: unknown;
        nullable?: boolean;
        unit?: string;
        ts?: string;
        numberAllowDecimal?: boolean;
        numberPrecision?: number;
        historianEnabled?: boolean;
        historianTimeSourcePath?: string;
        historianTargetId?: string;
      }
    | undefined {
    let base:
      | {
          value: unknown;
          valueType?: string;
          defaultValue?: unknown;
          nullable?: boolean;
          unit?: string;
          numberAllowDecimal?: boolean;
          numberPrecision?: number;
          historianEnabled?: boolean;
          historianTimeSourcePath?: string;
          historianTargetId?: string;
        }
      | undefined;

    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      const attribute = (template.attributes || []).find((a) => a.enabled !== false && a.name === attributeName);
      if (!attribute) continue;
      base = {
        value: coerceAttributeValue(attribute.valueType, attribute.default, {
          defaultValue: attribute.default,
          nullable: attribute.nullable === true
        }),
        valueType: attribute.valueType,
        defaultValue: attribute.default,
        nullable: attribute.nullable === true,
        unit: attribute.unit ?? "",
        numberAllowDecimal: attribute.numberAllowDecimal !== false,
        numberPrecision: Math.max(0, Number(attribute.numberPrecision ?? 0) || 0),
        historianEnabled: attribute.historianEnabled === true,
        historianTimeSourcePath: String(attribute.historianTimeSourcePath ?? ""),
        historianTargetId: String(attribute.historianTargetId ?? "default")
      };
      break; // first template (in asset.templateIds order) wins on name collision
    }

    const hasOverride = Object.prototype.hasOwnProperty.call(asset.attributes || {}, attributeName);
    if (!base && !hasOverride) return undefined;
    if (!hasOverride) return base;

    const val = (asset.attributes || {})[attributeName];
    const item = val && typeof val === "object" ? (val as Record<string, unknown>) : null;
    const valueType = normalizeValueType(base?.valueType ?? "string");
    return {
      ...(base || {}),
      value:
        item && Object.prototype.hasOwnProperty.call(item, "value")
          ? coerceAttributeValue(valueType, item.value, { defaultValue: base?.defaultValue, nullable: base?.nullable === true })
          : coerceAttributeValue(valueType, val, { defaultValue: base?.defaultValue, nullable: base?.nullable === true }),
      ts: item && Object.prototype.hasOwnProperty.call(item, "ts") ? String(item.ts) : undefined
    };
  }

  collectEffectiveAttributeMatches(section: AssetSection): Map<string, AttributeQueryMatch> {
    const templateById = new Map((section.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map((section.assets || []).map((asset) => [asset.id, asset]));
    const out = new Map<string, AttributeQueryMatch>();

    for (const asset of section.assets || []) {
      const assetPath = getAssetPath(asset.id, assetById);
      if (!assetPath) continue;
      const attributes = this.buildEffectiveAttributeMap(asset, templateById);
      for (const [name, attribute] of attributes.entries()) {
        out.set(`${asset.id}:${name}`, {
          kind: "attribute",
          path: `${assetPath}.${name}`,
          assetId: asset.id,
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

    return out;
  }

  attributeMatchChanged(prev: AttributeQueryMatch | undefined, next: AttributeQueryMatch): boolean {
    if (!prev) return true;
    if (!valuesEqual(prev.value, next.value)) return true;
    if ((prev.ts || "") !== (next.ts || "")) return true;
    if (prev.type !== next.type) return true;
    if (prev.unit !== next.unit) return true;
    if (prev.historianEnabled !== next.historianEnabled) return true;
    if (prev.historianTimeSourcePath !== next.historianTimeSourcePath) return true;
    if (prev.historianTargetId !== next.historianTargetId) return true;
    return false;
  }
}
