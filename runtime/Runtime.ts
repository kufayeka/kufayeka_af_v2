import { randomUUID } from "node:crypto";
import type {
  RuntimeMessage,
  RuntimeNodeHandler,
} from "./types";
import type { RuntimeNodeContext } from "./types";
import { RuntimeContextFactory } from "./composition/RuntimeContextFactory";

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
  private readonly contextFactory: RuntimeContextFactory;

  constructor(options: RuntimeOptions = {}) {
    this.maxInflightPerNode = options.maxInflightPerNode ?? 50;
    this.maxQueuePerNode = options.maxQueuePerNode ?? 5000;
    this.nodeExecutionTimeoutMs = Math.max(0, Number(options.nodeExecutionTimeoutMs ?? 30000));
    this.contextFactory = new RuntimeContextFactory(this);
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
    return this.contextFactory.create(nodeId, <T>(fn: () => T | Promise<T>) => this.enqueueAssetWrite(fn));
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
          const nodeConfig = this.getGlobal<Record<string, Record<string, unknown>>>("flowNodeConfigById", {});
          const outputLabels = Array.isArray(nodeConfig?.[nodeId]?.outputs)
            ? (nodeConfig[nodeId].outputs as unknown[]).map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          const resolvePorts = (targets: Array<string | number>): string[] => {
            const resolved = new Set<string>();
            for (const target of targets) {
              if (typeof target === "number" && Number.isFinite(target)) {
                const index = Math.trunc(target) - 1;
                const port = outputLabels[index];
                if (port) resolved.add(port);
                continue;
              }
              const raw = String(target || "").trim();
              if (!raw) continue;
              if (/^\d+$/.test(raw)) {
                const index = Number(raw) - 1;
                const port = outputLabels[index];
                if (port) resolved.add(port);
                continue;
              }
              resolved.add(raw);
            }
            return Array.from(resolved);
          };
          const send = (msgOrPorts: RuntimeMessage | string[] | number[], msgOrPort?: RuntimeMessage | string, maybePort?: string): void => {
            if (Array.isArray(msgOrPorts)) {
              const ports = resolvePorts(msgOrPorts as Array<string | number>);
              const outMsg = msgOrPort as RuntimeMessage;
              for (const port of ports) {
                this.send(nodeId, outMsg, port);
              }
              return;
            }
            const outMsg = msgOrPorts as RuntimeMessage;
            if (typeof msgOrPort === "string") {
              this.send(nodeId, outMsg, msgOrPort);
              return;
            }
            if (typeof maybePort === "string") {
              this.send(nodeId, outMsg, maybePort);
              return;
            }
            const ports = outputLabels.length > 0 ? outputLabels : ["default"];
            for (const port of ports) {
              this.send(nodeId, outMsg, port);
            }
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
