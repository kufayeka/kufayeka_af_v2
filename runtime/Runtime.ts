import type {
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler,
  RuntimeNodeProfilingChangeEvent,
  RuntimeNodeProfilingSnapshot,
  RuntimeNodeStatus,
  RuntimeNodeStatusChangeEvent,
  RuntimeNodeStatusInput,
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
import { NodeProfilingMonitor } from "./monitor/NodeProfilingMonitor";
import { NodeStatusMonitor } from "./monitor/NodeStatusMonitor";

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
  private readonly nodeStatusMonitor: NodeStatusMonitor;
  private readonly nodeProfilingMonitor: NodeProfilingMonitor;

  constructor(options: RuntimeOptions = {}, deps: RuntimeDeps = {}) {
    this.maxInflightPerNode = options.maxInflightPerNode ?? 50;
    this.maxQueuePerNode = options.maxQueuePerNode ?? 5000;
    this.nodeExecutionTimeoutMs = Math.max(0, Number(options.nodeExecutionTimeoutMs ?? 30000));
    this.deps = createRuntimeDeps(deps);
    this.nodeStatusMonitor = new NodeStatusMonitor({ now: this.deps.now });
    this.nodeProfilingMonitor = new NodeProfilingMonitor({ now: this.deps.now });
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
    return this.nodeStatusMonitor.set(nodeId, status);
  }

  clearNodeStatus(nodeId: string): boolean {
    return this.nodeStatusMonitor.clear(nodeId);
  }

  clearAllNodeStatuses(): void {
    this.nodeStatusMonitor.clearAll();
  }

  getNodeStatus(nodeId: string): RuntimeNodeStatus | null {
    return this.nodeStatusMonitor.get(nodeId);
  }

  getNodeStatuses(): Record<string, RuntimeNodeStatus> {
    return this.nodeStatusMonitor.getAll();
  }

  getNodeStatusRevision(): number {
    return this.nodeStatusMonitor.getRevision();
  }

  setNodeStatusMonitoringEnabled(enabled: boolean): boolean {
    return this.nodeStatusMonitor.setEnabled(enabled);
  }

  isNodeStatusMonitoringEnabled(): boolean {
    return this.nodeStatusMonitor.isEnabled();
  }

  subscribeNodeStatus(listener: (event: RuntimeNodeStatusChangeEvent) => void): () => void {
    return this.nodeStatusMonitor.subscribe(listener);
  }

  getNodeProfiling(nodeId: string): RuntimeNodeProfilingSnapshot | null {
    return this.nodeProfilingMonitor.get(nodeId);
  }

  getNodeProfilings(): Record<string, RuntimeNodeProfilingSnapshot> {
    return this.nodeProfilingMonitor.getAll();
  }

  getNodeProfilingRevision(): number {
    return this.nodeProfilingMonitor.getRevision();
  }

  setNodeProfilingEnabled(enabled: boolean): boolean {
    return this.nodeProfilingMonitor.setEnabled(enabled);
  }

  isNodeProfilingEnabled(): boolean {
    return this.nodeProfilingMonitor.isEnabled();
  }

  subscribeNodeProfiling(listener: (event: RuntimeNodeProfilingChangeEvent) => void): () => void {
    return this.nodeProfilingMonitor.subscribe(listener);
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
      this.nodeProfilingMonitor.onMessageDropped(nodeId, state.queue.length, state.inflight);
      return;
    }
    state.queue.push({
      msg,
      enqueuedAt: Date.now()
    });
    this.nodeProfilingMonitor.onMessageEnqueued(nodeId, state.queue.length, state.inflight);
    this.drainNodeQueue(nodeId);
  }

  private executeNodeMessage(
    nodeId: string,
    handler: RuntimeNodeHandler,
    msg: RuntimeMessage,
    state: NodeExecutionState,
    queueWaitMs: number
  ): void {
    setImmediate(async () => {
      const startedAtMs = Date.now();
      this.nodeProfilingMonitor.onExecutionStarted(nodeId, {
        queueLength: state.queue.length,
        inflight: state.inflight,
        queueWaitMs
      });
      let succeeded = false;
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
        succeeded = true;
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
        this.nodeProfilingMonitor.onExecutionCompleted(nodeId, {
          queueLength: state.queue.length,
          inflight: state.inflight,
          execMs: Date.now() - startedAtMs,
          ok: succeeded
        });
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
      const queued = state.queue.shift();
      if (!queued) continue;
      state.inflight += 1;
      const queueWaitMs = Math.max(0, Date.now() - queued.enqueuedAt);
      this.executeNodeMessage(nodeId, handler, queued.msg, state, queueWaitMs);
    }
  }

  send(fromId: string, msg: unknown, fromPort = "default"): void {
    if (this.shuttingDown) return;
    const normalized = normalizeMessage(msg, this.deps);
    const wireKey = buildWireKey(fromId, fromPort);
    const nexts = this.wires.get(wireKey) ?? [];
    if (nexts.length === 1) {
      // Single destination: no sibling node can ever observe this object, so
      // there is no one left to protect with a clone -- hand it off directly.
      // Mirrors Node-RED's single-wire fast path (Node.prototype.send's
      // `this._wire` case, which also skips cloning). Most flow topologies
      // are linear chains, so this is the common case, not the exception.
      this.enqueueNodeMessage(nexts[0], normalized);
      return;
    }
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
