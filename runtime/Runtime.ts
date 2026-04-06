import type {
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler,
  RuntimeNodeStatus,
  RuntimeNodeStatusInput,
  RuntimeNodeStatusItem
} from "./core/runtimeTypes";
import type { ProgramRuntimeComposition } from "./composition/RuntimeComposition";
import { RuntimeContextFactory } from "./composition/RuntimeContextFactory";
import {
  createRuntimeDeps,
  getOrCreateNodeState,
  waitForInflightToDrain,
  withTimeout,
  type NodeExecutionState,
  type RuntimeDeps,
  type RuntimeOptions
} from "./core/runtimeExecutionUtils";
import {
  buildWireKey,
  normalizeMessage,
  resolveOutputLabels,
  resolvePorts
} from "./core/runtimeMessageUtils";
import { formatRuntimeDisplayText } from "./core/runtimeNumberUtils";

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
  private readonly deps: Required<RuntimeDeps>;
  private programComposition: ProgramRuntimeComposition | null = null;
  private readonly nodeStatuses = new Map<string, RuntimeNodeStatus>();
  private nodeStatusRevision = 0;
  private nodeStatusMonitoringEnabled = false;
  private readonly nodeStatusListeners = new Set<
    (event: { revision: number; nodeId: string; status: RuntimeNodeStatus | null }) => void
  >();

  constructor(options: RuntimeOptions = {}, deps: RuntimeDeps = {}) {
    this.maxInflightPerNode = options.maxInflightPerNode ?? 50;
    this.maxQueuePerNode = options.maxQueuePerNode ?? 5000;
    this.nodeExecutionTimeoutMs = Math.max(0, Number(options.nodeExecutionTimeoutMs ?? 30000));
    this.deps = createRuntimeDeps(deps);
    this.contextFactory = new RuntimeContextFactory(this, { now: this.deps.now });
  }

  addNode(id: string, handler: RuntimeNodeHandler): void {
    this.nodes.set(id, handler);
  }

  wire(from: string, to: string, fromPort = "default"): void {
    const wireKey = buildWireKey(from, fromPort);
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

  setProgramComposition(composition: ProgramRuntimeComposition | null): ProgramRuntimeComposition | null {
    this.programComposition = composition;
    return this.programComposition;
  }

  getProgramComposition(): ProgramRuntimeComposition | null {
    return this.programComposition;
  }

  setNodeStatus(nodeId: string, status: RuntimeNodeStatusInput): RuntimeNodeStatus {
    if (!this.nodeStatusMonitoringEnabled) return [];
    const sourceItems = Array.isArray(status) ? status : [status];
    const normalized: RuntimeNodeStatus = sourceItems
      .filter((item): item is RuntimeNodeStatusItem => !!item && typeof item === "object" && typeof item.level === "string")
      .map((item) => ({
        level: item.level,
        text: formatRuntimeDisplayText(String(item.text || "").trim()),
        position: item.position === "top" ? "top" : "bottom",
        ts: String(item.ts || this.deps.now())
      }));
    if (normalized.length === 0) {
      this.clearNodeStatus(nodeId);
      return [];
    }
    this.nodeStatuses.set(nodeId, normalized);
    this.nodeStatusRevision += 1;
    this.emitNodeStatusChange(nodeId, normalized);
    return normalized;
  }

  clearNodeStatus(nodeId: string): boolean {
    const deleted = this.nodeStatuses.delete(nodeId);
    if (deleted) {
      this.nodeStatusRevision += 1;
      this.emitNodeStatusChange(nodeId, null);
    }
    return deleted;
  }

  clearAllNodeStatuses(): void {
    if (this.nodeStatuses.size === 0) return;
    const previousNodeIds = Array.from(this.nodeStatuses.keys());
    this.nodeStatuses.clear();
    this.nodeStatusRevision += 1;
    for (const nodeId of previousNodeIds) {
      this.emitNodeStatusChange(nodeId, null);
    }
  }

  getNodeStatus(nodeId: string): RuntimeNodeStatus | null {
    return this.nodeStatuses.get(nodeId) || null;
  }

  getNodeStatuses(): Record<string, RuntimeNodeStatus> {
    return Object.fromEntries(this.nodeStatuses.entries());
  }

  getNodeStatusRevision(): number {
    return this.nodeStatusRevision;
  }

  setNodeStatusMonitoringEnabled(enabled: boolean): boolean {
    const nextValue = enabled === true;
    if (this.nodeStatusMonitoringEnabled === nextValue) return this.nodeStatusMonitoringEnabled;
    this.nodeStatusMonitoringEnabled = nextValue;
    if (!nextValue) {
      this.clearAllNodeStatuses();
    }
    return this.nodeStatusMonitoringEnabled;
  }

  isNodeStatusMonitoringEnabled(): boolean {
    return this.nodeStatusMonitoringEnabled;
  }

  subscribeNodeStatus(
    listener: (event: { revision: number; nodeId: string; status: RuntimeNodeStatus | null }) => void
  ): () => void {
    this.nodeStatusListeners.add(listener);
    return () => this.nodeStatusListeners.delete(listener);
  }

  private emitNodeStatusChange(nodeId: string, status: RuntimeNodeStatus | null): void {
    const event = {
      revision: this.nodeStatusRevision,
      nodeId,
      status
    };
    for (const listener of this.nodeStatusListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[runtime] node status listener error for "${nodeId}":`, error);
      }
    }
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
    return getOrCreateNodeState(this.nodeState, nodeId);
  }

  private getOutputLabels(nodeId: string): string[] {
    const nodeConfig = this.getGlobal<Record<string, Record<string, unknown>>>("flowNodeConfigById", {});
    return resolveOutputLabels(nodeConfig?.[nodeId]);
  }

  private createSend(nodeId: string) {
    const outputLabels = this.getOutputLabels(nodeId);
    return (msgOrPorts: RuntimeMessage | string[] | number[], msgOrPort?: RuntimeMessage | string, maybePort?: string): void => {
      if (Array.isArray(msgOrPorts)) {
        const ports = resolvePorts(outputLabels, msgOrPorts as Array<string | number>);
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

  private executeNodeMessage(nodeId: string, handler: RuntimeNodeHandler, msg: RuntimeMessage, state: NodeExecutionState): void {
    setImmediate(async () => {
      try {
        const send = this.createSend(nodeId);
        const context = this.createNodeContext(nodeId);
        if (this.nodeExecutionTimeoutMs > 0) {
          await withTimeout(
            Promise.resolve(handler(msg, send, context)),
            this.nodeExecutionTimeoutMs,
            `Node execution timeout after ${this.nodeExecutionTimeoutMs}ms`,
            this.deps
          );
        } else {
          await handler(msg, send, context);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setNodeStatus(nodeId, {
          level: "error",
          text: message,
          position: "bottom"
        });
        console.error(`Error in node "${nodeId}":`, message);
      } finally {
        state.inflight -= 1;
        this.drainNodeQueue(nodeId);
      }
    });
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
      this.executeNodeMessage(nodeId, handler, msg, state);
    }
  }

  send(fromId: string, msg: unknown, fromPort = "default"): void {
    if (this.shuttingDown) return;
    const normalized = normalizeMessage(msg, this.deps);
    const wireKey = buildWireKey(fromId, fromPort);
    const nexts = this.wires.get(wireKey) ?? [];
    for (const nextId of nexts) {
      const msgClone = this.deps.cloneMessage(normalized);
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

      const deadlineMs = Math.max(500, Number(process.env.RUNTIME_SHUTDOWN_DRAIN_TIMEOUT_MS || 5000));
      const drained = await waitForInflightToDrain(this.nodeState, deadlineMs, this.deps);
      if (drained) return;
      console.warn(`[runtime] shutdown drain timeout (${deadlineMs}ms), forcing close with in-flight handlers`);
    })();
    return this.shutdownPromise;
  }
}

export default Runtime;
