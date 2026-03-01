export const INTERNAL_GLOBAL_KEYS = new Set<string>([
  "assetStorage",
  "assetFramework",
  "assetFrameworkMeta",
  "dbConnectionManager",
  "dbConfig",
  "eventStore",
  "eventStoreMeta",
  "historianStore",
  "historianBridge",
  "historianBridgeStats",
  "historianIngestStats",
  "scriptTemplates",
  "__runtime.globalValuePersistence",
]);

export function isInternalGlobalKey(key: string): boolean {
  const normalized = String(key || "").trim();
  if (!normalized) return true;
  if (INTERNAL_GLOBAL_KEYS.has(normalized)) return true;
  return normalized.startsWith("__runtime.");
}

export function toSerializableJsonValue(value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof value === "undefined") {
    return { ok: false, error: "undefined is not JSON serializable" };
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") {
      return { ok: false, error: "value is not JSON serializable" };
    }
    return { ok: true, value: JSON.parse(json) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function filterSerializableGlobalEntries(
  input: Record<string, unknown>,
  options: { includeInternal?: boolean } = {}
): Record<string, unknown> {
  const includeInternal = options.includeInternal === true;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!includeInternal && isInternalGlobalKey(key)) continue;
    const serializable = toSerializableJsonValue(value);
    if (!serializable.ok) continue;
    out[key] = serializable.value;
  }
  return out;
}
