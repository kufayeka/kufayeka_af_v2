import { randomUUID } from "node:crypto";
import type {
  AssetStore,
  EventTemplateDefinition,
  EventStore,
  FindAttributesResult,
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler,
} from "./types";
import type { DbConnectionManager } from "./dbConnectionManager";
import {
  closeEventsWithAutoCapture,
  closeEventFromTemplate,
  normalizeEventTemplates,
  openEventFromTemplate
} from "./eventTemplateRuntime";

interface RuntimeOptions {
  maxInflightPerNode?: number;
  maxQueuePerNode?: number;
  nodeExecutionTimeoutMs?: number;
}

interface NodeExecutionState {
  inflight: number;
  queue: RuntimeMessage[];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class Runtime {
  private readonly wires = new Map<string, string[]>();
  private readonly nodes = new Map<string, RuntimeNodeHandler>();
  private readonly globalStore = new Map<string, unknown>();
  private globalRevision = 0;
  private readonly maxInflightPerNode: number;
  private readonly maxQueuePerNode: number;
  private readonly nodeExecutionTimeoutMs: number;
  private readonly nodeState = new Map<string, NodeExecutionState>();
  private assetWriteChain: Promise<void> = Promise.resolve();
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: RuntimeOptions = {}) {
    this.maxInflightPerNode = options.maxInflightPerNode ?? 50;
    this.maxQueuePerNode = options.maxQueuePerNode ?? 5000;
    this.nodeExecutionTimeoutMs = Math.max(0, Number(options.nodeExecutionTimeoutMs ?? 30000));
  }

  addNode(id: string, handler: RuntimeNodeHandler): void {
    this.nodes.set(id, handler);
  }

  wire(from: string, to: string, fromPort = "default"): void {
    const wireKey = `${from}::${String(fromPort || "default")}`;
    if (!this.wires.has(wireKey)) this.wires.set(wireKey, []);
    this.wires.get(wireKey)?.push(to);
  }

  getGlobal<T = unknown>(key: string, defaultValue?: T): T {
    if (!this.globalStore.has(key)) return defaultValue as T;
    return this.globalStore.get(key) as T;
  }

  setGlobal<T = unknown>(key: string, value: T): T {
    this.globalStore.set(key, value);
    this.globalRevision += 1;
    return value;
  }

  hasGlobal(key: string): boolean {
    return this.globalStore.has(key);
  }

  deleteGlobal(key: string): boolean {
    const deleted = this.globalStore.delete(key);
    if (deleted) this.globalRevision += 1;
    return deleted;
  }

  getGlobalEntries(): Record<string, unknown> {
    return Object.fromEntries(this.globalStore.entries());
  }

  getGlobalRevision(): number {
    return this.globalRevision;
  }

  private enqueueAssetWrite<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.assetWriteChain.then(() => Promise.resolve(fn()));
    this.assetWriteChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  createNodeContext(nodeId: string): RuntimeNodeContext {
    const getAssetStorage = (): AssetStore | undefined => this.getGlobal<AssetStore | undefined>("assetStorage");
    const getEventStore = (): EventStore | undefined => this.getGlobal<EventStore | undefined>("eventStore");
    const getDbManager = (): DbConnectionManager | null => this.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
    const getEventTemplateMap = (): Map<string, EventTemplateDefinition> => {
      const list = normalizeEventTemplates(this.getGlobal("eventTemplates", []));
      return new Map(list.map((item) => [item.id, item]));
    };
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
      if (rows.length === 0) {
        return { start_ts: null, end_ts: null, count: 0 };
      }

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

    return {
      nodeId,
      global: {
        get: <T = unknown>(key: string, defaultValue?: T): T => this.getGlobal<T>(key, defaultValue),
        set: <T = unknown>(key: string, value: T): T => this.setGlobal<T>(key, value),
        has: (key: string): boolean => this.hasGlobal(key),
        delete: (key: string): boolean => this.deleteGlobal(key),
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
          return store.getAttribute(path, defaultValue) as T;
        },
        getAll: (path: string) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.getAttributes(path);
        },
        set: async (path: string, value: unknown) => {
          const store = getAssetStorage();
          if (!store) return [];
          return await this.enqueueAssetWrite(() => store.setAttribute(path, value));
        },
        setMany: async (items: Array<{ path: string; value: unknown }>) => {
          const store = getAssetStorage();
          if (!store) return [];
          return await this.enqueueAssetWrite(() => store.setAttributes(items));
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
        },
      },
      eventSys: {
        open: async (eventPath, ts, context, notes, severity, capturedDataOnOpen, eventMetadata) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.open(eventPath, ts, context, notes, severity, capturedDataOnOpen, eventMetadata);
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
      },
    };
  }

  private getNodeState(nodeId: string): NodeExecutionState {
    if (!this.nodeState.has(nodeId)) {
      this.nodeState.set(nodeId, { inflight: 0, queue: [] });
    }
    return this.nodeState.get(nodeId) as NodeExecutionState;
  }

  private enqueueNodeMessage(nodeId: string, msg: RuntimeMessage): void {
    if (this.shuttingDown) return;
    const state = this.getNodeState(nodeId);
    if (state.queue.length >= this.maxQueuePerNode) {
      console.warn(`Node queue "${nodeId}" is full (${this.maxQueuePerNode}); dropping message`);
      return;
    }
    state.queue.push(msg);
    this.drainNodeQueue(nodeId);
  }

  private drainNodeQueue(nodeId: string): void {
    const state = this.getNodeState(nodeId);
    const handler = this.nodes.get(nodeId);
    if (!handler) {
      console.warn(`Node "${nodeId}" not found`);
      state.queue.length = 0;
      return;
    }

    while (state.inflight < this.maxInflightPerNode && state.queue.length > 0) {
      const msg = state.queue.shift();
      if (!msg) continue;
      state.inflight += 1;

      setImmediate(async () => {
        try {
          const send = (outMsg: RuntimeMessage, port = "default"): void => {
            this.send(nodeId, outMsg, port);
          };
          const context = this.createNodeContext(nodeId);
          if (this.nodeExecutionTimeoutMs > 0) {
            await withTimeout(
              Promise.resolve(handler(msg, send, context)),
              this.nodeExecutionTimeoutMs,
              `Node execution timeout after ${this.nodeExecutionTimeoutMs}ms`
            );
          } else {
            await handler(msg, send, context);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error in node "${nodeId}":`, message);
        } finally {
          state.inflight -= 1;
          this.drainNodeQueue(nodeId);
        }
      });
    }
  }

  private normalizeMessage(msg: unknown): RuntimeMessage {
    const source: Record<string, unknown> =
      msg && typeof msg === "object" && !Array.isArray(msg) ? (msg as Record<string, unknown>) : { payload: msg };
    const normalized: Record<string, unknown> = { ...source };
    if (typeof normalized.id !== "string" || !normalized.id.trim()) {
      normalized.id = randomUUID();
    }
    if (typeof normalized.ts !== "string" || !normalized.ts.trim()) {
      normalized.ts = new Date().toISOString();
    }
    return normalized as RuntimeMessage;
  }

  send(fromId: string, msg: unknown, fromPort = "default"): void {
    if (this.shuttingDown) return;
    const normalized = this.normalizeMessage(msg);
    const wireKey = `${fromId}::${String(fromPort || "default")}`;
    const nexts = this.wires.get(wireKey) ?? [];
    for (const nextId of nexts) {
      const msgClone = structuredClone(normalized);
      this.enqueueNodeMessage(nextId, msgClone);
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      this.shuttingDown = true;
      for (const state of this.nodeState.values()) {
        state.queue.length = 0;
      }

      const deadlineMs = Math.max(
        500,
        Number(process.env.RUNTIME_SHUTDOWN_DRAIN_TIMEOUT_MS || 5000)
      );
      const started = Date.now();
      while (Date.now() - started < deadlineMs) {
        let inflight = 0;
        for (const state of this.nodeState.values()) {
          inflight += state.inflight;
        }
        if (inflight <= 0) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      console.warn(
        `[runtime] shutdown drain timeout (${deadlineMs}ms), forcing close with in-flight handlers`
      );
    })();
    return this.shutdownPromise;
  }
}

export default Runtime;
