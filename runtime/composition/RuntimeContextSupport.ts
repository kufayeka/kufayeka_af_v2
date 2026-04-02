import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { ProgramRuntimeComposition } from "./RuntimeComposition";
import type {
  AssetStore,
  EventRow,
  EventStore,
  EventTemplateDefinition,
  FindAttributesResult,
  RuntimeDbApi,
  RuntimeEventApi,
  RuntimeNodeContext
} from "../core/runtimeTypes";
import {
  closeEventsWithAutoCapture,
  closeEventFromTemplate,
  normalizeEventTemplates,
  openEventFromTemplate
} from "../event/template/EventTemplateService";

export interface RuntimeContextResolvers {
  getAssetStorage: () => AssetStore | undefined;
  getEventStore: () => EventStore | undefined;
  getDbManager: () => DbConnectionManager | null;
  getEventTemplateMap: () => Map<string, EventTemplateDefinition>;
}

export interface RuntimeFlowContextConfig {
  flowId: string;
  flowDefinitionsById: Map<string, { id?: string; name?: string }>;
  resolveFlowVariables?: (flowId: string, context: RuntimeNodeContext) => Record<string, unknown>;
}

export interface RuntimeContextFactoryDeps {
  now?: () => string;
}

export function createRuntimeContextDeps(deps: RuntimeContextFactoryDeps = {}): Required<RuntimeContextFactoryDeps> {
  return {
    now: deps.now || (() => new Date().toISOString())
  };
}

export function createRuntimeContextResolvers(
  runtime: Runtime,
  composition: ProgramRuntimeComposition | null
): RuntimeContextResolvers {
  return {
    getAssetStorage: (): AssetStore | undefined =>
      composition?.assetStore,
    getEventStore: (): EventStore | undefined =>
      composition?.eventStore,
    getDbManager: (): DbConnectionManager | null =>
      composition?.dbConnectionManager || runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null),
    getEventTemplateMap: (): Map<string, EventTemplateDefinition> =>
      composition?.eventTemplatesById || new Map(normalizeEventTemplates(runtime.getGlobal("eventTemplates", [])).map((item) => [item.id, item]))
  };
}

export function buildEmptyFindAttributesResult(
  path: string,
  expectedValue: unknown,
  options?: { strict?: boolean }
): FindAttributesResult {
  return { path, expectedValue, strict: options?.strict === true, count: 0, assetCount: 0, matches: [], assets: [] };
}

export async function resolveEventRange(
  rows: EventRow[],
  deps: Required<RuntimeContextFactoryDeps>
): Promise<{ start_ts: string | null; end_ts: string | null; count: number }> {
  if (rows.length === 0) return { start_ts: null, end_ts: null, count: 0 };

  let earliestMs: number | null = null;
  let earliestTs: string | null = null;
  let latestMs: number | null = null;
  let latestTs: string | null = null;
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  for (const row of rows) {
    const startRaw = String(row.start_ts || "").trim();
    const startMs = startRaw ? Date.parse(startRaw) : Number.NaN;
    if (Number.isFinite(startMs) && (earliestMs == null || startMs < earliestMs)) {
      earliestMs = startMs;
      earliestTs = new Date(startMs).toISOString();
    }

    const endRaw = String(row.end_ts || "").trim();
    const endMs = endRaw ? Date.parse(endRaw) : nowMs;
    if (Number.isFinite(endMs) && (latestMs == null || endMs > latestMs)) {
      latestMs = endMs;
      latestTs = endRaw ? new Date(endMs).toISOString() : nowIso;
    }
  }

  return {
    start_ts: earliestTs,
    end_ts: latestTs,
    count: rows.length
  };
}

export function createAssetApi(
  resolvers: RuntimeContextResolvers,
  enqueueAssetWrite: <T>(fn: () => T | Promise<T>) => Promise<T>
): RuntimeNodeContext["asset"] {
  return {
    query: (path: string) => {
      const store = resolvers.getAssetStorage();
      if (!store) return [];
      return store.query(path);
    },
    get: <T = unknown>(path: string, defaultValue?: T): T => {
      const store = resolvers.getAssetStorage();
      if (!store) return defaultValue as T;
      return store.getValue(path, defaultValue) as T;
    },
    getValue: <T = unknown>(path: string, defaultValue?: T): T => {
      const store = resolvers.getAssetStorage();
      if (!store) return defaultValue as T;
      return store.getValue(path, defaultValue) as T;
    },
    getAll: (path: string) => {
      const store = resolvers.getAssetStorage();
      if (!store) return [];
      return store.getAttributes(path);
    },
    set: async (path: string, value: unknown) => {
      const store = resolvers.getAssetStorage();
      if (!store) return [];
      return await enqueueAssetWrite(() => store.setAttribute(path, value));
    },
    setMany: async (items: Array<{ path: string; value: unknown }>) => {
      const store = resolvers.getAssetStorage();
      if (!store) return [];
      return await enqueueAssetWrite(() => store.setAttributes(items));
    },
    findByValue: (path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult => {
      const store = resolvers.getAssetStorage();
      if (!store) return buildEmptyFindAttributesResult(path, expectedValue, options);
      return store.findAttributesByValue(path, expectedValue, options);
    },
    find: (path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult => {
      const store = resolvers.getAssetStorage();
      if (!store) return buildEmptyFindAttributesResult(path, expectedValue, options);
      return store.findAttributesByValue(path, expectedValue, options);
    },
    hierarchy: (options?: { populateAttributes?: boolean }) => {
      const store = resolvers.getAssetStorage();
      if (!store) return [];
      return store.getHierarchy(options);
    }
  };
}

export function createDbApi(resolvers: RuntimeContextResolvers): RuntimeDbApi {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const manager = resolvers.getDbManager();
      if (!manager) throw new Error("dbConnectionManager is not available");
      return await manager.query(sql, params);
    },
    executeSafe: async (sql: string) => {
      const manager = resolvers.getDbManager();
      if (!manager) throw new Error("dbConnectionManager is not available");
      return await manager.executeSql(sql);
    },
    testConnection: async () => {
      const manager = resolvers.getDbManager();
      if (!manager) throw new Error("dbConnectionManager is not available");
      return await manager.testConnection();
    }
  };
}

export function createEventApi(
  resolvers: RuntimeContextResolvers,
  deps: Required<RuntimeContextFactoryDeps>
): RuntimeEventApi {
  const getRequiredEventStore = (): EventStore => {
    const store = resolvers.getEventStore();
    if (!store) throw new Error("eventStore is not available");
    return store;
  };

  const getRequiredAssetStore = (): AssetStore => {
    const store = resolvers.getAssetStorage();
    if (!store) throw new Error("assetStorage is not available");
    return store;
  };

  const getEventRange = async (
    pattern?: string,
    from?: string,
    to?: string,
    status?: string,
    contextFilters?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ start_ts: string | null; end_ts: string | null; count: number }> => {
    const rows = await getRequiredEventStore().get(pattern, from, to, status, contextFilters, {
      limit: 5000,
      ...(options || {})
    });
    return await resolveEventRange(rows, deps);
  };

  return {
    open: async (eventPath, ts, contextValue, notes, severity, capturedDataOnOpen, eventMetadata) => {
      return await getRequiredEventStore().open(eventPath, ts, contextValue, notes, severity, capturedDataOnOpen, eventMetadata);
    },
    close: async (pattern, ts, notes, capturedDataOnClose) => {
      const store = getRequiredEventStore();
      const assetStore = getRequiredAssetStore();
      const rows = await store.get(pattern, "*", "*", "open", {}, { limit: 5000 });
      const templatedRows = rows.filter((row) => row.event_metadata && Object.keys(row.event_metadata).length > 0);
      if (templatedRows.length > 0) {
        const result = await closeEventsWithAutoCapture({
          assetStore,
          eventStore: store,
          templateMap: resolvers.getEventTemplateMap(),
          rows: templatedRows,
          notes,
          ts,
          explicitCaptured: capturedDataOnClose
        });
        if (templatedRows.length === rows.length) {
          return {
            pattern: String(pattern || "*"),
            closedCount: result.closedCount,
            ts: result.ts,
            notes_on_close: result.notes_on_close,
            captured_data_on_close: capturedDataOnClose ?? null
          };
        }
        const normalResult = await store.close(pattern, ts, notes, capturedDataOnClose);
        return {
          pattern: normalResult.pattern,
          closedCount: Number(normalResult.closedCount || 0) + result.closedCount,
          ts: result.ts || normalResult.ts,
          notes_on_close: normalResult.notes_on_close,
          captured_data_on_close: normalResult.captured_data_on_close
        };
      }
      return await store.close(pattern, ts, notes, capturedDataOnClose);
    },
    get: async (pattern, from, to, status, contextFilters, options) => {
      return await getRequiredEventStore().get(pattern, from, to, status, contextFilters, options);
    },
    getEarliestTs: async (pattern, from, to, status, contextFilters, options) => {
      const range = await getEventRange(pattern, from, to, status, contextFilters, options);
      return range.start_ts;
    },
    getLatestTs: async (pattern, from, to, status, contextFilters, options) => {
      const range = await getEventRange(pattern, from, to, status, contextFilters, options);
      return range.end_ts;
    },
    getRange: async (pattern, from, to, status, contextFilters, options) => {
      return await getEventRange(pattern, from, to, status, contextFilters, options);
    },
    openTemplate: async (templateId, options) => {
      return await openEventFromTemplate({
        assetStore: getRequiredAssetStore(),
        eventStore: getRequiredEventStore(),
        templateMap: resolvers.getEventTemplateMap(),
        templateId,
        openOptions: options
      });
    },
    closeTemplate: async (templateId, options) => {
      return await closeEventFromTemplate({
        assetStore: getRequiredAssetStore(),
        eventStore: getRequiredEventStore(),
        templateMap: resolvers.getEventTemplateMap(),
        templateId,
        closeOptions: options
      });
    }
  };
}

export function resolveFlowContext(
  config: RuntimeFlowContextConfig,
  context: RuntimeNodeContext
): RuntimeNodeContext["flow"] {
  const { flowId, flowDefinitionsById, resolveFlowVariables } = config;
  const flowDefinition = flowDefinitionsById.get(flowId);
  return {
    id: flowId,
    name: String(flowDefinition?.name || flowId),
    variables: flowId && typeof resolveFlowVariables === "function" ? resolveFlowVariables(flowId, context) || {} : {}
  };
}
