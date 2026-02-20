function normalizeAssetSection(input = {}) {
  const assets = Array.isArray(input.assets) ? input.assets : [];
  const attributeTemplates = Array.isArray(input.attributeTemplates)
    ? input.attributeTemplates
    : [];

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
            name: attribute.name,
            type: attribute.type,
            defaultValue: attribute.defaultValue,
            unit: attribute.unit ?? "",
            dashboardVisible: attribute.dashboardVisible === true,
            dashboardEditable: attribute.dashboardEditable !== false,
            nullable: attribute.nullable === true,
            inputMode: attribute.inputMode ?? "text",
            optionsSource: attribute.optionsSource ?? "static",
            options: Array.isArray(attribute.options) ? attribute.options : [],
            optionsApiUrl: attribute.optionsApiUrl ?? "",
            optionsLabelPath: attribute.optionsLabelPath ?? "",
            optionsValuePath: attribute.optionsValuePath ?? "",
          }))
        : [],
    })),
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

  function buildEffectiveAttributeMap(asset, templateById) {
    const map = new Map();

    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attribute of template.attributes || []) {
        if (!map.has(attribute.name)) {
          map.set(attribute.name, {
            value: attribute.defaultValue,
            type: attribute.type,
            unit: attribute.unit ?? "",
          });
        }
      }
    }

    for (const [name, val] of Object.entries(asset.attributes || {})) {
      map.set(name, {
        ...(map.get(name) || {}),
        value: val && Object.prototype.hasOwnProperty.call(val, "value") ? val.value : val,
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
          type: attribute.type || "custom",
          unit: attribute.unit || "",
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
          type: attribute.type || "custom",
          unit: attribute.unit || "",
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

      const updatesByAssetId = new Map();
      for (const item of assetMatches) {
        updatesByAssetId.set(item.assetId, [attrName]);
      }

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
      return matches;
    }

    const updatesByAssetId = new Map();
    for (const item of matches) {
      if (!updatesByAssetId.has(item.assetId)) {
        updatesByAssetId.set(item.assetId, []);
      }
      updatesByAssetId.get(item.assetId).push(item.attributeName);
    }

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

    return resolve(path).filter((item) => item.kind === "attribute");
  }

  return {
    getState() {
      return structuredClone(state);
    },
    replace(nextState) {
      state = normalizeAssetSection(nextState);
      return this.getState();
    },
    query(path) {
      return resolve(path);
    },
    setAttribute(path, value) {
      return setAttributeByPath(path, value);
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
