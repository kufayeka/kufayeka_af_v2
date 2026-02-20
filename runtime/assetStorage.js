const { createAssetFrameworkStore, normalizeAssetSection } = require("./assetFramework");

function isAssetStore(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.getState === "function" &&
    typeof value.query === "function" &&
    typeof value.setAttribute === "function"
  );
}

function ensureAssetStorage(runtime, initialSection = {}) {
  const existing = runtime.getGlobal("assetStorage");
  if (isAssetStore(existing)) {
    return existing;
  }

  const seed = normalizeAssetSection(
    runtime.getGlobal("assetFramework", initialSection)
  );
  const store = createAssetFrameworkStore(seed);

  store.subscribe((nextState, meta) => {
    runtime.setGlobal("assetFramework", nextState);
    runtime.setGlobal("assetFrameworkMeta", meta);
  });

  runtime.setGlobal("assetStorage", store);
  runtime.setGlobal("assetFramework", store.getState());
  runtime.setGlobal("assetFrameworkMeta", {
    revision: store.getRevision(),
    updatedAt: store.getUpdatedAt(),
  });

  return store;
}

module.exports = {
  ensureAssetStorage,
};
