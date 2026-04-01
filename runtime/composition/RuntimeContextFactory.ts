import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../dbConnectionManager";
import type { RuntimeServiceRegistry } from "./RuntimeServiceRegistry";
import type { AssetDomainController } from "../asset/AssetDomainController";
import type { EventDomainController } from "../event/EventDomainController";
import type {
  AssetStore,
  EventStore,
  EventTemplateDefinition,
  FindAttributesResult,
  RuntimeNodeContext
} from "../types";
import {
  closeEventsWithAutoCapture,
  closeEventFromTemplate,
  normalizeEventTemplates,
  openEventFromTemplate
} from "../event/eventTemplateService";

export class RuntimeContextFactory {
  private readonly runtime: Runtime;

  constructor(runtime: Runtime) {
    this.runtime = runtime;
  }

  create(nodeId: string, enqueueAssetWrite: <T>(fn: () => T | Promise<T>) => Promise<T>): RuntimeNodeContext {
    const serviceRegistry = this.runtime.getGlobal<RuntimeServiceRegistry | null>("serviceRegistry", null);
    const getAssetDomain = (): AssetDomainController | null =>
      serviceRegistry?.asset || this.runtime.getGlobal<AssetDomainController | null>("assetDomainController", null);
    const getEventDomain = (): EventDomainController | null =>
      serviceRegistry?.event || this.runtime.getGlobal<EventDomainController | null>("eventDomainController", null);
    const getAssetStorage = (): AssetStore | undefined =>
      getAssetDomain()?.getStore() || this.runtime.getGlobal<AssetStore | undefined>("assetStorage");
    const getEventStore = (): EventStore | undefined =>
      getEventDomain()?.getStore() || this.runtime.getGlobal<EventStore | undefined>("eventStore");
    const getDbManager = (): DbConnectionManager | null => this.runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
    const getEventTemplateMap = (): Map<string, EventTemplateDefinition> => {
      const list = normalizeEventTemplates(getEventDomain()?.getTemplates() || this.runtime.getGlobal("eventTemplates", []));
      return new Map(list.map((item) => [item.id, item]));
    };
    const nodeConfigById = this.runtime.getGlobal<Record<string, Record<string, unknown>>>("flowNodeConfigById", {});
    const currentNodeConfig = nodeConfigById?.[nodeId] || {};
    const flowId = String(currentNodeConfig.__flowId || "").trim();
    const flowDefinitionsById = this.runtime.getGlobal<Record<string, { id?: string; name?: string }>>("flowDefinitionsById", {});
    const resolveFlowVariables = this.runtime.getGlobal<
      ((flowId: string, context: RuntimeNodeContext) => Record<string, unknown>) | undefined
    >("resolveFlowVariables", undefined);

    const resolveEventRange = async (
      pattern?: string,
      from?: string,
      to?: string,
      status?: string,
      contextFilters?: Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<{ start_ts: string | null; end_ts: string | null; count: number }> => {
      const store = getEventStore();
      if (!store) throw new Error("eventStore is not available");
      const rows = await store.get(pattern, from, to, status, contextFilters, {
        limit: 5000,
        ...(options || {})
      });
      if (rows.length === 0) return { start_ts: null, end_ts: null, count: 0 };

      let earliestMs: number | null = null;
      let earliestTs: string | null = null;
      let latestMs: number | null = null;
      let latestTs: string | null = null;
      const nowIso = new Date().toISOString();
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
    };

    const context = {
      nodeId,
      global: {
        get: <T = unknown>(key: string, defaultValue?: T): T => this.runtime.getGlobal<T>(key, defaultValue),
        set: <T = unknown>(key: string, value: T): T => this.runtime.setGlobal<T>(key, value),
        has: (key: string): boolean => this.runtime.hasGlobal(key),
        delete: (key: string): boolean => this.runtime.deleteGlobal(key)
      },
      asset: {
        query: (path: string) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.query(path);
        },
        get: <T = unknown>(path: string, defaultValue?: T): T => {
          const store = getAssetStorage();
          if (!store) return defaultValue as T;
          return store.getValue(path, defaultValue) as T;
        },
        getValue: <T = unknown>(path: string, defaultValue?: T): T => {
          const store = getAssetStorage();
          if (!store) return defaultValue as T;
          return store.getValue(path, defaultValue) as T;
        },
        getAll: (path: string) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.getAttributes(path);
        },
        set: async (path: string, value: unknown) => {
          const store = getAssetStorage();
          if (!store) return [];
          return await enqueueAssetWrite(() => store.setAttribute(path, value));
        },
        setMany: async (items: Array<{ path: string; value: unknown }>) => {
          const store = getAssetStorage();
          if (!store) return [];
          return await enqueueAssetWrite(() => store.setAttributes(items));
        },
        findByValue: (path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult => {
          const store = getAssetStorage();
          if (!store) {
            return { path, expectedValue, strict: options?.strict === true, count: 0, assetCount: 0, matches: [], assets: [] };
          }
          return store.findAttributesByValue(path, expectedValue, options);
        },
        find: (path: string, expectedValue: unknown, options?: { strict?: boolean }): FindAttributesResult => {
          const store = getAssetStorage();
          if (!store) {
            return { path, expectedValue, strict: options?.strict === true, count: 0, assetCount: 0, matches: [], assets: [] };
          }
          return store.findAttributesByValue(path, expectedValue, options);
        },
        hierarchy: (options?: { populateAttributes?: boolean }) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.getHierarchy(options);
        }
      },
      eventSys: {
        open: async (eventPath, ts, contextValue, notes, severity, capturedDataOnOpen, eventMetadata) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.open(eventPath, ts, contextValue, notes, severity, capturedDataOnOpen, eventMetadata);
        },
        close: async (pattern, ts, notes, capturedDataOnClose) => {
          const store = getEventStore();
          const assetStore = getAssetStorage();
          if (!store) throw new Error("eventStore is not available");
          if (!assetStore) throw new Error("assetStorage is not available");
          const rows = await store.get(pattern, "*", "*", "open", {}, { limit: 5000 });
          const templatedRows = rows.filter((row) => row.event_metadata && Object.keys(row.event_metadata).length > 0);
          if (templatedRows.length > 0) {
            const result = await closeEventsWithAutoCapture({
              assetStore,
              eventStore: store,
              templateMap: getEventTemplateMap(),
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
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.get(pattern, from, to, status, contextFilters, options);
        },
        getEarliestTs: async (pattern, from, to, status, contextFilters, options) => {
          const range = await resolveEventRange(pattern, from, to, status, contextFilters, options);
          return range.start_ts;
        },
        getLatestTs: async (pattern, from, to, status, contextFilters, options) => {
          const range = await resolveEventRange(pattern, from, to, status, contextFilters, options);
          return range.end_ts;
        },
        getRange: async (pattern, from, to, status, contextFilters, options) => {
          return await resolveEventRange(pattern, from, to, status, contextFilters, options);
        },
        openTemplate: async (templateId, options) => {
          const store = getEventStore();
          const assetStore = getAssetStorage();
          if (!store) throw new Error("eventStore is not available");
          if (!assetStore) throw new Error("assetStorage is not available");
          return await openEventFromTemplate({
            assetStore,
            eventStore: store,
            templateMap: getEventTemplateMap(),
            templateId,
            openOptions: options
          });
        },
        closeTemplate: async (templateId, options) => {
          const store = getEventStore();
          const assetStore = getAssetStorage();
          if (!store) throw new Error("eventStore is not available");
          if (!assetStore) throw new Error("assetStorage is not available");
          return await closeEventFromTemplate({
            assetStore,
            eventStore: store,
            templateMap: getEventTemplateMap(),
            templateId,
            closeOptions: options
          });
        }
      },
      db: {
        query: async (sql: string, params: unknown[] = []) => {
          const manager = getDbManager();
          if (!manager) throw new Error("dbConnectionManager is not available");
          return await manager.query(sql, params);
        },
        executeSafe: async (sql: string) => {
          const manager = getDbManager();
          if (!manager) throw new Error("dbConnectionManager is not available");
          return await manager.executeSql(sql);
        },
        testConnection: async () => {
          const manager = getDbManager();
          if (!manager) throw new Error("dbConnectionManager is not available");
          return await manager.testConnection();
        }
      }
    } as RuntimeNodeContext;

    context.flow = {
      id: flowId,
      name: String(flowDefinitionsById?.[flowId]?.name || flowId),
      variables: flowId && typeof resolveFlowVariables === "function" ? resolveFlowVariables(flowId, context) || {} : {}
    };

    return context;
  }
}
