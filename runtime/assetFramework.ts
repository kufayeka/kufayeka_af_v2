import type {
  AssetAttributeTemplate,
  AssetChangeMeta,
  AssetDefinition,
  AssetHierarchyNode,
  AssetSection,
  AssetStore,
  AttributeQueryMatch,
  AttributeTemplate,
  FindAttributesResult,
  HistorianTarget,
  QueryMatch,
  ValueType,
} from "./types";

const DEFAULT_HISTORIAN_TARGET: HistorianTarget = {
  id: "default",
  name: "Default Historian",
  udpHost: "127.0.0.1",
  udpPort: 9900,
  httpBaseUrl: "http://127.0.0.1:8080",
  timestampUnit: "us",
  enabled: true,
};

function normalizeValueType(rawType: unknown): ValueType {
  const t = String(rawType ?? "string");
  const types = new Set<ValueType>([
    "int8",
    "uint8",
    "int16",
    "uint16",
    "int32",
    "uint32",
    "float32",
    "float64",
    "boolean",
    "string",
    "array",
    "object",
  ]);
  if (types.has(t as ValueType)) return t as ValueType;
  if (t === "number") return "float64";
  return "string";
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeAsset(input: unknown): AssetDefinition {
  const src = toObject(input);
  return {
    id: String(src.id ?? ""),
    name: String(src.name ?? ""),
    parentId: src.parentId == null ? null : String(src.parentId),
    templateIds: Array.isArray(src.templateIds) ? src.templateIds.map((x) => String(x)) : [],
    attributes: toObject(src.attributes),
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
    numberPrecision: Math.max(0, Math.min(10, Number(src.numberPrecision ?? 2) || 0)),
  };
}

function normalizeTemplate(input: unknown): AttributeTemplate {
  const src = toObject(input);
  return {
    id: String(src.id ?? ""),
    name: String(src.name ?? ""),
    attributes: Array.isArray(src.attributes) ? src.attributes.map(normalizeAssetAttributeTemplate) : [],
  };
}

function normalizeHistorian(input: unknown): HistorianTarget | null {
  const src = toObject(input);
  const id = String(src.id ?? "");
  if (!id.length) return null;
  return {
    id,
    name: String(src.name ?? src.id ?? ""),
    udpHost: String(src.udpHost ?? "127.0.0.1"),
    udpPort: Math.max(1, Number(src.udpPort) || 9900),
    httpBaseUrl: String(src.httpBaseUrl ?? "http://127.0.0.1:8080"),
    timestampUnit: String(src.timestampUnit ?? "us") === "ns" ? "ns" : "us",
    enabled: src.enabled !== false,
  };
}

export function normalizeAssetSection(input: unknown = {}): AssetSection {
  const source = toObject(input);
  const assets = Array.isArray(source.assets) ? source.assets.map(normalizeAsset) : [];
  const attributeTemplates = Array.isArray(source.attributeTemplates)
    ? source.attributeTemplates.map(normalizeTemplate)
    : [];
  const historiansRaw = Array.isArray(source.historians) ? source.historians : [];
  const historians = [DEFAULT_HISTORIAN_TARGET, ...historiansRaw.map(normalizeHistorian).filter(Boolean) as HistorianTarget[]]
    .filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i);

  return { assets, attributeTemplates, historians };
}

function splitPath(pathValue: string): string[] {
  return String(pathValue || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getAssetPath(assetId: string, assetById: Map<string, AssetDefinition>): string {
  const asset = assetById.get(assetId);
  if (!asset) return "";
  const parts = [asset.name];
  let parentId = asset.parentId;
  while (parentId) {
    const parent = assetById.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(".");
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const leftType = typeof left;
  const rightType = typeof right;
  if (leftType !== "object" || rightType !== "object" || left === null || right === null) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function valuesLooselyEqual(left: unknown, right: unknown): boolean {
  if (valuesEqual(left, right)) return true;
  if (typeof left === "object" || typeof right === "object") {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  // eslint-disable-next-line eqeqeq
  return left == right;
}

function buildEffectiveAttributeMap(asset: AssetDefinition, templateById: Map<string, AttributeTemplate>) {
  const map = new Map<
    string,
    {
      value: unknown;
      valueType?: string;
      unit?: string;
      ts?: string;
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
          value: attribute.default,
          valueType: attribute.valueType,
          unit: attribute.unit ?? "",
          historianEnabled: attribute.historianEnabled === true,
          historianTimeSourcePath: String(attribute.historianTimeSourcePath ?? ""),
          historianTargetId: String(attribute.historianTargetId ?? "default"),
        });
      }
    }
  }

  for (const [name, val] of Object.entries(asset.attributes || {})) {
    const item = val && typeof val === "object" ? (val as Record<string, unknown>) : null;
    map.set(name, {
      ...(map.get(name) || {}),
      value: item && Object.prototype.hasOwnProperty.call(item, "value") ? item.value : val,
      ts: item && Object.prototype.hasOwnProperty.call(item, "ts") ? String(item.ts) : undefined,
    });
  }

  return map;
}

function collectEffectiveAttributeMatches(section: AssetSection): Map<string, AttributeQueryMatch> {
  const templateById = new Map((section.attributeTemplates || []).map((template) => [template.id, template]));
  const assetById = new Map((section.assets || []).map((asset) => [asset.id, asset]));
  const out = new Map<string, AttributeQueryMatch>();

  for (const asset of section.assets || []) {
    const assetPath = getAssetPath(asset.id, assetById);
    if (!assetPath) continue;
    const attributes = buildEffectiveAttributeMap(asset, templateById);
    for (const [name, attribute] of attributes.entries()) {
      const key = `${asset.id}:${name}`;
      out.set(key, {
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
        historianTargetId: attribute.historianTargetId || "default",
      });
    }
  }

  return out;
}

function attributeMatchChanged(prev: AttributeQueryMatch | undefined, next: AttributeQueryMatch): boolean {
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

function matches(pattern: string, value: string): boolean {
  return pattern === "*" || pattern === value;
}

export function createAssetFrameworkStore(initialSection: unknown = {}): AssetStore {
  let state = normalizeAssetSection(initialSection);
  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set<(state: AssetSection, meta: AssetChangeMeta) => void>();

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

  const getState = (): AssetSection => structuredClone(state);

  const resolve = (pathValue: string): QueryMatch[] => {
    const segments = splitPath(pathValue);
    const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const resolvedAssets = (state.assets || []).map((asset) => ({ asset, path: getAssetPath(asset.id, assetById) }));
    const results: QueryMatch[] = [];

    for (const node of resolvedAssets) {
      const pathSegments = splitPath(node.path);
      const isAssetQuery =
        segments.length === pathSegments.length &&
        segments.every((segment, index) => matches(segment, pathSegments[index]));
      if (isAssetQuery) {
        results.push({
          kind: "asset",
          path: node.path,
          assetId: node.asset.id,
          value: node.asset,
        });
      }

      const isAttributeQuery =
        segments.length === pathSegments.length + 1 &&
        segments
          .slice(0, -1)
          .every((segment, index) => matches(segment, pathSegments[index]));
      if (!isAttributeQuery) continue;

      const attrSegment = segments[segments.length - 1];
      const attributes = buildEffectiveAttributeMap(node.asset, templateById);
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
          historianTargetId: attribute.historianTargetId || "default",
        });
      }
    }
    return results;
  };

  const setAttributeByPath = (pathValue: string, value: unknown): AttributeQueryMatch[] => {
    let pathMatches = resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");

    if (pathMatches.length === 0) {
      const segments = splitPath(pathValue);
      if (segments.length < 2) return [];
      const attrName = segments[segments.length - 1];
      if (!attrName || attrName === "*") return [];

      const assetPattern = segments.slice(0, -1).join(".");
      const assetMatches = resolve(assetPattern).filter((item) => item.kind === "asset");
      if (assetMatches.length === 0) return [];

      const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
      const updatesByAssetId = new Map<string, string[]>();
      for (const item of assetMatches) {
        const targetAsset = state.assets.find((asset) => asset.id === item.assetId);
        if (!targetAsset) continue;
        const effectiveMap = buildEffectiveAttributeMap(targetAsset, templateById);
        // Strict mode: never create attribute outside effective (template/override) definition.
        if (!effectiveMap.has(attrName)) continue;
        const currentValue = effectiveMap.get(attrName)?.value;
        if (!valuesEqual(currentValue, value)) updatesByAssetId.set(item.assetId, [attrName]);
      }
      if (updatesByAssetId.size === 0) return [];

      state = {
        ...state,
        assets: state.assets.map((asset) => {
          const names = updatesByAssetId.get(asset.id);
          if (!names || names.length === 0) return asset;
          const nextAttributes = { ...(asset.attributes || {}) };
          for (const name of names) {
            nextAttributes[name] = { value, ts: new Date().toISOString() };
          }
          return { ...asset, attributes: nextAttributes };
        }),
      };
      pathMatches = resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
      const changedKeys = new Set(Array.from(updatesByAssetId.entries()).map(([assetId, names]) => `${assetId}:${names[0]}`));
      const changedMatches = pathMatches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
      emitChange({
        type: "attribute.set",
        pattern: pathValue,
        changes: changedMatches.map((item) => ({ ...item })),
      });
      return changedMatches;
    }

    const updatesByAssetId = new Map<string, string[]>();
    for (const item of pathMatches) {
      if (valuesEqual(item.value, value)) continue;
      if (!updatesByAssetId.has(item.assetId)) updatesByAssetId.set(item.assetId, []);
      updatesByAssetId.get(item.assetId)?.push(item.attributeName);
    }
    // Path exists but value is unchanged: return current matches for caller visibility.
    if (updatesByAssetId.size === 0) return pathMatches.map((item) => ({ ...item }));

    state = {
      ...state,
      assets: state.assets.map((asset) => {
        const names = updatesByAssetId.get(asset.id);
        if (!names || names.length === 0) return asset;
        const nextAttributes = { ...(asset.attributes || {}) };
        for (const name of names) {
          nextAttributes[name] = { value, ts: new Date().toISOString() };
        }
        return { ...asset, attributes: nextAttributes };
      }),
    };

    const nextMatches = resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
    const changedKeys = new Set<string>();
    for (const [assetId, names] of updatesByAssetId.entries()) {
      for (const name of names) changedKeys.add(`${assetId}:${name}`);
    }
    const changedMatches = nextMatches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
    emitChange({
      type: "attribute.set",
      pattern: pathValue,
      changes: changedMatches.map((item) => ({ ...item })),
    });
    return changedMatches;
  };

  const buildHierarchy = (options: { populateAttributes?: boolean } = {}): AssetHierarchyNode[] => {
    const populateAttributes = options.populateAttributes !== false;
    const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const childrenByParentId = new Map<string | null, AssetDefinition[]>();

    for (const asset of state.assets || []) {
      const key = asset.parentId ?? null;
      const list = childrenByParentId.get(key) || [];
      list.push(asset);
      childrenByParentId.set(key, list);
    }

    for (const [, list] of childrenByParentId) {
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    const toNode = (asset: AssetDefinition): AssetHierarchyNode => {
      const path = getAssetPath(asset.id, assetById);
      const children = (childrenByParentId.get(asset.id) || []).map(toNode);
      const baseNode: AssetHierarchyNode = {
        id: asset.id,
        name: asset.name,
        path,
        parentId: asset.parentId ?? null,
        templateIds: Array.isArray(asset.templateIds) ? [...asset.templateIds] : [],
        attributes: structuredClone(asset.attributes || {}),
        children,
      };
      if (!populateAttributes) return baseNode;

      const effectiveAttributes = Array.from(buildEffectiveAttributeMap(asset, templateById).entries()).map(([name, attribute]) => {
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
          source: isOverride ? "override" : "template",
        } as const;
      });
      effectiveAttributes.sort((a, b) => a.name.localeCompare(b.name));
      return { ...baseNode, effectiveAttributes };
    };

    return (childrenByParentId.get(null) || []).map(toNode);
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
      const previousState = state;
      const normalizedNext = normalizeAssetSection(nextState);
      const prevMap = collectEffectiveAttributeMatches(previousState);
      const nextMap = collectEffectiveAttributeMatches(normalizedNext);
      const changed: AttributeQueryMatch[] = [];

      for (const [key, nextAttr] of nextMap.entries()) {
        const prevAttr = prevMap.get(key);
        if (attributeMatchChanged(prevAttr, nextAttr)) {
          changed.push(nextAttr);
        }
      }

      state = normalizedNext;
      if (changed.length > 0) {
        emitChange({ type: "attribute.set", pattern: "*", changes: changed });
      } else {
        emitChange({ type: "state.replace", changes: [] });
      }
      return getState();
    },
    query(pathValue: string) {
      return resolve(pathValue);
    },
    getAttribute(pathValue, defaultValue = undefined) {
      const matches = resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
      if (matches.length === 0) return defaultValue;
      if (matches.length === 1) return matches[0].value;
      return matches.map((item) => item.value);
    },
    getAttributes(pathValue) {
      return resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
    },
    setAttribute(pathValue, value) {
      return setAttributeByPath(pathValue, value);
    },
    setAttributes(items: Array<{ path: string; value: unknown }> = []) {
      const results: Array<{ path: string; count: number; matches: AttributeQueryMatch[] }> = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (!Object.prototype.hasOwnProperty.call(item, "path")) continue;
        if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
        const matches = setAttributeByPath(item.path, item.value);
        results.push({ path: item.path, count: matches.length, matches });
      }
      return results;
    },
    findAttributesByValue(pathValue, expectedValue, options = {}) {
      const strict = options && options.strict === true;
      const matches = resolve(pathValue).filter((item): item is AttributeQueryMatch => item.kind === "attribute");
      const filtered = matches.filter((item) =>
        strict ? valuesEqual(item.value, expectedValue) : valuesLooselyEqual(item.value, expectedValue)
      );
      const assetsMap = new Map<string, { assetId: string; path: string }>();
      for (const item of filtered) {
        if (assetsMap.has(item.assetId)) continue;
        const pathSegments = splitPath(item.path);
        const assetPath = pathSegments.slice(0, -1).join(".");
        assetsMap.set(item.assetId, { assetId: item.assetId, path: assetPath });
      }
      const result: FindAttributesResult = {
        path: pathValue,
        expectedValue,
        strict,
        count: filtered.length,
        assetCount: assetsMap.size,
        matches: filtered,
        assets: Array.from(assetsMap.values()),
      };
      return result;
    },
    getHierarchy(options) {
      return buildHierarchy(options);
    },
  };
}
