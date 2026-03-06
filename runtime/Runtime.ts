import { randomUUID } from "node:crypto";
import type {
  AssetStore,
  EventStore,
  FindAttributesResult,
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler,
} from "./types";
import type { DbConnectionManager } from "./dbConnectionManager";

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

  wire(from: string, to: string): void {
    if (!this.wires.has(from)) this.wires.set(from, []);
    this.wires.get(from)?.push(to);
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
        open: async (eventPath, ts, context, notes, severity, capturedDataOnOpen) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.open(eventPath, ts, context, notes, severity, capturedDataOnOpen);
        },
        close: async (pattern, ts, notes, capturedDataOnClose) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.close(pattern, ts, notes, capturedDataOnClose);
        },
        get: async (pattern, from, to, status, contextFilters, options) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore is not available");
          return await store.get(pattern, from, to, status, contextFilters, options);
        },
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
          const send = (outMsg: RuntimeMessage): void => {
            this.send(nodeId, outMsg);
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

  send(fromId: string, msg: unknown): void {
    if (this.shuttingDown) return;
    const normalized = this.normalizeMessage(msg);
    const nexts = this.wires.get(fromId) ?? [];
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
