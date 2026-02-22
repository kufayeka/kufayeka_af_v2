function normalizeAssetSection(input = {}) {
  const normalizeValueType = (rawType) => {
    const t = String(rawType || "string");
    if (
      t === "int8" ||
      t === "uint8" ||
      t === "int16" ||
      t === "uint16" ||
      t === "int32" ||
      t === "uint32" ||
      t === "float32" ||
      t === "float64" ||
      t === "boolean" ||
      t === "string" ||
      t === "array" ||
      t === "object"
    ) {
      return t;
    }
    if (t === "number") return "float64";
    return "string";
  };
  const assets = Array.isArray(input.assets) ? input.assets : [];
  const attributeTemplates = Array.isArray(input.attributeTemplates)
    ? input.attributeTemplates
    : [];
  const historians = Array.isArray(input.historians) ? input.historians : [];

  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      parentId: asset.parentId ?? null,
      templateIds: Array.isArray(asset.templateIds) ? asset.templateIds : [],
      attributes: asset.attributes && typeof asset.attributes === "object" ? asset.attributes : {},
    })),
    attributeTemplates: attributeTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      attributes: Array.isArray(template.attributes)
        ? template.attributes.map((attribute) => ({
            enabled: attribute.enabled !== false,
            name: attribute.name,
            valueType: normalizeValueType(attribute.valueType || attribute.type || "string"),
            default:
              Object.prototype.hasOwnProperty.call(attribute, "default")
                ? attribute.default
                : attribute.defaultValue,
            unit: attribute.unit ?? "",
            historianEnabled: attribute.historianEnabled === true,
            historianTimeSourcePath: String(attribute.historianTimeSourcePath ?? ""),
            historianTargetId: String(attribute.historianTargetId ?? "default"),
            dashboardVisible: attribute.dashboardVisible === true,
            dashboardEditable: attribute.dashboardEditable !== false,
            nullable: attribute.nullable === true,
            inputType: attribute.inputType ?? attribute.inputMode ?? "text",
            options: Array.isArray(attribute.options) ? attribute.options : [],
            optionsScript: attribute.optionsScript ?? attribute.optionsTransformScript ?? "",
            numberMin: typeof attribute.numberMin === "number" ? attribute.numberMin : null,
            numberMax: typeof attribute.numberMax === "number" ? attribute.numberMax : null,
            numberAllowNegative: attribute.numberAllowNegative !== false,
            numberUseThousandSeparator: attribute.numberUseThousandSeparator === true,
            numberPrefix: String(attribute.numberPrefix ?? ""),
            numberSuffix: String(attribute.numberSuffix ?? ""),
            numberAllowDecimal: attribute.numberAllowDecimal !== false,
            numberPrecision: Math.max(0, Math.min(10, Number(attribute.numberPrecision ?? 2) || 0)),
          }))
        : [],
    })),
    historians: [
      {
        id: "default",
        name: "Default Historian",
        udpHost: "127.0.0.1",
        udpPort: 9900,
        httpBaseUrl: "http://127.0.0.1:8080",
        timestampUnit: "us",
        enabled: true
      },
      ...historians.map((h) => ({
        id: String(h.id ?? ""),
        name: String(h.name ?? h.id ?? ""),
        udpHost: String(h.udpHost ?? "127.0.0.1"),
        udpPort: Math.max(1, Number(h.udpPort) || 9900),
        httpBaseUrl: String(h.httpBaseUrl ?? "http://127.0.0.1:8080"),
        timestampUnit: String(h.timestampUnit ?? "us") === "ns" ? "ns" : "us",
        enabled: h.enabled !== false,
      })).filter((h) => h.id.length > 0)
    ].filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i),
  };
}

function splitPath(path) {
  return String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function createAssetFrameworkStore(initialSection = {}) {
  let state = normalizeAssetSection(initialSection);
  let revision = 0;
  let updatedAt = new Date().toISOString();
  const listeners = new Set();

  function emitChange(change = { type: "state.replace", changes: [] }) {
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
  }

  function getState() {
    return structuredClone(state);
  }

  function getAssetPath(assetId, assetById) {
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

  function matches(pattern, value) {
    return pattern === "*" || pattern === value;
  }

  function valuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    const leftType = typeof left;
    const rightType = typeof right;
    if (leftType !== "object" || rightType !== "object" || left === null || right === null) {
      return false;
    }
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function buildEffectiveAttributeMap(asset, templateById) {
    const map = new Map();

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
      map.set(name, {
        ...(map.get(name) || {}),
        value: val && Object.prototype.hasOwnProperty.call(val, "value") ? val.value : val,
        ts:
          val &&
          typeof val === "object" &&
          Object.prototype.hasOwnProperty.call(val, "ts")
            ? val.ts
            : undefined,
      });
    }

    return map;
  }

  function buildHierarchy(options = {}) {
    const populateAttributes = options.populateAttributes !== false;
    const templateById = new Map(
      (state.attributeTemplates || []).map((template) => [template.id, template])
    );
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const childrenByParentId = new Map();

    for (const asset of state.assets || []) {
      const key = asset.parentId ?? null;
      const list = childrenByParentId.get(key) || [];
      list.push(asset);
      childrenByParentId.set(key, list);
    }

    for (const [, list] of childrenByParentId) {
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    function toNode(asset) {
      const path = getAssetPath(asset.id, assetById);
      const children = (childrenByParentId.get(asset.id) || []).map(toNode);
      const baseNode = {
        id: asset.id,
        name: asset.name,
        path,
        parentId: asset.parentId ?? null,
        templateIds: Array.isArray(asset.templateIds) ? [...asset.templateIds] : [],
        attributes: structuredClone(asset.attributes || {}),
        children,
      };

      if (!populateAttributes) return baseNode;

      const effectiveAttributes = Array.from(
        buildEffectiveAttributeMap(asset, templateById).entries()
      ).map(([name, attribute]) => {
        const isOverride = Object.prototype.hasOwnProperty.call(
          asset.attributes || {},
          name
        );
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
        };
      });

      effectiveAttributes.sort((a, b) => a.name.localeCompare(b.name));
      return { ...baseNode, effectiveAttributes };
    }

    return (childrenByParentId.get(null) || []).map(toNode);
  }

  function resolve(path) {
    const segments = splitPath(path);
    const templateById = new Map(
      (state.attributeTemplates || []).map((template) => [template.id, template])
    );
    const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const resolvedAssets = (state.assets || []).map((asset) => ({
      asset,
      path: getAssetPath(asset.id, assetById),
    }));
    const results = [];

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
  }

  function setAttributeByPath(path, value) {
    let matches = resolve(path).filter((item) => item.kind === "attribute");

    if (matches.length === 0) {
      const segments = splitPath(path);
      if (segments.length < 2) return [];
      const attrName = segments[segments.length - 1];
      if (!attrName || attrName === "*") return [];

      const assetPattern = segments.slice(0, -1).join(".");
      const assetMatches = resolve(assetPattern).filter((item) => item.kind === "asset");
      if (assetMatches.length === 0) return [];
      const templateById = new Map(
        (state.attributeTemplates || []).map((template) => [template.id, template])
      );

      const updatesByAssetId = new Map();
      for (const item of assetMatches) {
        const targetAsset = state.assets.find((asset) => asset.id === item.assetId);
        if (!targetAsset) continue;
        const effectiveMap = buildEffectiveAttributeMap(targetAsset, templateById);
        const currentValue = effectiveMap.get(attrName)?.value;
        if (!valuesEqual(currentValue, value)) {
          updatesByAssetId.set(item.assetId, [attrName]);
        }
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
      matches = resolve(path).filter((item) => item.kind === "attribute");
      const changedKeys = new Set(
        Array.from(updatesByAssetId.entries()).map(([assetId, names]) => `${assetId}:${names[0]}`)
      );
      const changedMatches = matches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
      emitChange({
        type: "attribute.set",
        pattern: path,
        changes: changedMatches.map((item) => ({ ...item }))
      });
      return changedMatches;
    }

    const updatesByAssetId = new Map();
    for (const item of matches) {
      if (valuesEqual(item.value, value)) continue;
      if (!updatesByAssetId.has(item.assetId)) {
        updatesByAssetId.set(item.assetId, []);
      }
      updatesByAssetId.get(item.assetId).push(item.attributeName);
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
    const nextMatches = resolve(path).filter((item) => item.kind === "attribute");
    const changedKeys = new Set();
    for (const [assetId, names] of updatesByAssetId.entries()) {
      for (const name of names) changedKeys.add(`${assetId}:${name}`);
    }
    const changedMatches = nextMatches.filter((item) => changedKeys.has(`${item.assetId}:${item.attributeName}`));
    emitChange({
      type: "attribute.set",
      pattern: path,
      changes: changedMatches.map((item) => ({ ...item }))
    });

    return changedMatches;
  }

  return {
    getState,
    getSnapshot() {
      return {
        state: getState(),
        revision,
        updatedAt,
      };
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
      state = normalizeAssetSection(nextState);
      emitChange({ type: "state.replace", changes: [] });
      return getState();
    },
    query(path) {
      return resolve(path);
    },
    getAttribute(path, defaultValue = undefined) {
      const matches = resolve(path).filter((item) => item.kind === "attribute");
      if (matches.length === 0) return defaultValue;
      if (matches.length === 1) return matches[0].value;
      return matches.map((item) => item.value);
    },
    getAttributes(path) {
      return resolve(path).filter((item) => item.kind === "attribute");
    },
    setAttribute(path, value) {
      return setAttributeByPath(path, value);
    },
    setAttributes(items = []) {
      const results = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (!Object.prototype.hasOwnProperty.call(item, "path")) continue;
        if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
        const matches = setAttributeByPath(item.path, item.value);
        results.push({
          path: item.path,
          count: matches.length,
          matches,
        });
      }
      return results;
    },
    getHierarchy(options) {
      return buildHierarchy(options);
    },
  };
}

module.exports = {
  normalizeAssetSection,
  createAssetFrameworkStore,
};
