const { createAssetFrameworkStore, normalizeAssetSection } = require("./assetFramework");
const { createHistorianBridge } = require("./historianBridge");

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
  const historianBridge =
    runtime.getGlobal("historianBridge") ||
    createHistorianBridge({
      enabled: process.env.HISTORIAN_ENABLED !== "0",
      host: process.env.HISTORIAN_HOST || "127.0.0.1",
      port: Number(process.env.HISTORIAN_UDP_PORT || 9900),
      timestampUnit: process.env.HISTORIAN_TIMESTAMP_UNIT || "us",
      flushIntervalMs: Number(process.env.HISTORIAN_FLUSH_INTERVAL_MS || 20),
      maxQueue: Number(process.env.HISTORIAN_MAX_QUEUE || 100000),
    });
  runtime.setGlobal("historianBridge", historianBridge);

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
    if (meta?.change?.type === "attribute.set") {
      historianBridge.enqueueChanges(meta.change.changes || [], store);
    }
  });

  runtime.setGlobal("assetStorage", store);
  runtime.setGlobal("assetFramework", store.getState());
  runtime.setGlobal("assetFrameworkMeta", {
    revision: store.getRevision(),
    updatedAt: store.getUpdatedAt(),
  });
  runtime.setGlobal("historianBridgeStats", historianBridge.stats());

  return store;
}

module.exports = {
  ensureAssetStorage,
};
