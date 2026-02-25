import { randomUUID } from "node:crypto";
import type {
  AssetStore,
  EventStore,
  FindAttributesResult,
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler,
} from "./types";

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
  private readonly maxInflightPerNode: number;
  private readonly maxQueuePerNode: number;
  private readonly nodeExecutionTimeoutMs: number;
  private readonly nodeState = new Map<string, NodeExecutionState>();
  private shuttingDown = false;

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
    return value;
  }

  hasGlobal(key: string): boolean {
    return this.globalStore.has(key);
  }

  deleteGlobal(key: string): boolean {
    return this.globalStore.delete(key);
  }

  getGlobalEntries(): Record<string, unknown> {
    return Object.fromEntries(this.globalStore.entries());
  }

  createNodeContext(nodeId: string): RuntimeNodeContext {
    const getAssetStorage = (): AssetStore | undefined => this.getGlobal<AssetStore | undefined>("assetStorage");
    const getEventStore = (): EventStore | undefined => this.getGlobal<EventStore | undefined>("eventStore");

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
        set: (path: string, value: unknown) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.setAttribute(path, value);
        },
        setMany: (items: Array<{ path: string; value: unknown }>) => {
          const store = getAssetStorage();
          if (!store) return [];
          return store.setAttributes(items);
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
        open: (eventPath, ts, context, notes, severity) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore belum tersedia");
          return store.open(eventPath, ts, context, notes, severity);
        },
        close: (pattern, ts, notes) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore belum tersedia");
          return store.close(pattern, ts, notes);
        },
        get: (pattern, from, to, status, contextFilters, options) => {
          const store = getEventStore();
          if (!store) throw new Error("eventStore belum tersedia");
          return store.get(pattern, from, to, status, contextFilters, options);
        },
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
      console.warn(`Queue node "${nodeId}" penuh (${this.maxQueuePerNode}); msg dibuang`);
      return;
    }
    state.queue.push(msg);
    this.drainNodeQueue(nodeId);
  }

  private drainNodeQueue(nodeId: string): void {
    const state = this.getNodeState(nodeId);
    const handler = this.nodes.get(nodeId);
    if (!handler) {
      console.warn(`Node "${nodeId}" tidak ditemukan`);
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
          console.error(`Error di node "${nodeId}":`, message);
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

  shutdown(): void {
    this.shuttingDown = true;
    for (const state of this.nodeState.values()) {
      state.queue.length = 0;
    }
  }
}

export default Runtime;
