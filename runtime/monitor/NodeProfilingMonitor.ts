import type {
  RuntimeNodeProfilingChangeEvent,
  RuntimeNodeProfilingSnapshot
} from "../core/runtimeTypes";

export interface NodeProfilingMonitorDeps {
  now: () => string;
}

function createEmptySnapshot(nodeId: string, enabledAt: string): RuntimeNodeProfilingSnapshot {
  return {
    nodeId,
    enabledAt,
    updatedAt: enabledAt,
    queueLength: 0,
    inflight: 0,
    receivedCount: 0,
    startedCount: 0,
    completedCount: 0,
    successCount: 0,
    errorCount: 0,
    droppedCount: 0,
    lastEnqueuedAt: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastQueueWaitMs: null,
    avgQueueWaitMs: null,
    maxQueueWaitMs: null,
    lastExecMs: null,
    avgExecMs: null,
    maxExecMs: null
  };
}

function computeAverage(total: number, count: number): number | null {
  if (count <= 0) return null;
  return total / count;
}

type ProfilingState = RuntimeNodeProfilingSnapshot & {
  totalQueueWaitMs: number;
  totalExecMs: number;
};

export class NodeProfilingMonitor {
  private readonly states = new Map<string, ProfilingState>();
  private revision = 0;
  private enabled = false;
  private readonly listeners = new Set<(event: RuntimeNodeProfilingChangeEvent) => void>();

  constructor(private readonly deps: NodeProfilingMonitorDeps) {}

  onMessageEnqueued(nodeId: string, queueLength: number, inflight: number, ts = this.deps.now()): void {
    if (!this.enabled) return;
    const state = this.getOrCreate(nodeId, ts);
    state.receivedCount += 1;
    state.queueLength = queueLength;
    state.inflight = inflight;
    state.lastEnqueuedAt = ts;
    state.updatedAt = ts;
    this.touch(nodeId, state);
  }

  onMessageDropped(nodeId: string, queueLength: number, inflight: number, ts = this.deps.now()): void {
    if (!this.enabled) return;
    const state = this.getOrCreate(nodeId, ts);
    state.droppedCount += 1;
    state.queueLength = queueLength;
    state.inflight = inflight;
    state.updatedAt = ts;
    this.touch(nodeId, state);
  }

  onExecutionStarted(
    nodeId: string,
    metrics: { queueLength: number; inflight: number; queueWaitMs: number },
    ts = this.deps.now()
  ): void {
    if (!this.enabled) return;
    const state = this.getOrCreate(nodeId, ts);
    state.startedCount += 1;
    state.queueLength = metrics.queueLength;
    state.inflight = metrics.inflight;
    state.lastStartedAt = ts;
    state.lastQueueWaitMs = metrics.queueWaitMs;
    state.totalQueueWaitMs += metrics.queueWaitMs;
    state.avgQueueWaitMs = computeAverage(state.totalQueueWaitMs, state.startedCount);
    state.maxQueueWaitMs = Math.max(state.maxQueueWaitMs || 0, metrics.queueWaitMs);
    state.updatedAt = ts;
    this.touch(nodeId, state);
  }

  onExecutionCompleted(
    nodeId: string,
    metrics: { queueLength: number; inflight: number; execMs: number; ok: boolean },
    ts = this.deps.now()
  ): void {
    if (!this.enabled) return;
    const state = this.getOrCreate(nodeId, ts);
    state.completedCount += 1;
    state.queueLength = metrics.queueLength;
    state.inflight = metrics.inflight;
    state.lastCompletedAt = ts;
    state.lastExecMs = metrics.execMs;
    state.totalExecMs += metrics.execMs;
    state.avgExecMs = computeAverage(state.totalExecMs, state.completedCount);
    state.maxExecMs = Math.max(state.maxExecMs || 0, metrics.execMs);
    if (metrics.ok) state.successCount += 1;
    else state.errorCount += 1;
    state.updatedAt = ts;
    this.touch(nodeId, state);
  }

  clear(nodeId: string): boolean {
    const deleted = this.states.delete(nodeId);
    if (!deleted) return false;
    this.revision += 1;
    this.emit(nodeId, null);
    return true;
  }

  clearAll(): void {
    if (this.states.size === 0) return;
    const previousNodeIds = Array.from(this.states.keys());
    this.states.clear();
    this.revision += 1;
    for (const nodeId of previousNodeIds) {
      this.emit(nodeId, null);
    }
  }

  get(nodeId: string): RuntimeNodeProfilingSnapshot | null {
    const state = this.states.get(nodeId);
    return state ? this.toSnapshot(state) : null;
  }

  getAll(): Record<string, RuntimeNodeProfilingSnapshot> {
    return Object.fromEntries(Array.from(this.states.entries()).map(([nodeId, state]) => [nodeId, this.toSnapshot(state)]));
  }

  getRevision(): number {
    return this.revision;
  }

  setEnabled(enabled: boolean): boolean {
    const nextValue = enabled === true;
    if (this.enabled === nextValue) return this.enabled;
    this.enabled = nextValue;
    if (!nextValue) this.clearAll();
    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(listener: (event: RuntimeNodeProfilingChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private getOrCreate(nodeId: string, ts: string): ProfilingState {
    const current = this.states.get(nodeId);
    if (current) return current;
    const created: ProfilingState = {
      ...createEmptySnapshot(nodeId, ts),
      totalQueueWaitMs: 0,
      totalExecMs: 0
    };
    this.states.set(nodeId, created);
    return created;
  }

  private toSnapshot(state: ProfilingState): RuntimeNodeProfilingSnapshot {
    const { totalExecMs: _totalExecMs, totalQueueWaitMs: _totalQueueWaitMs, ...snapshot } = state;
    return { ...snapshot };
  }

  private touch(nodeId: string, state: ProfilingState): void {
    this.revision += 1;
    this.emit(nodeId, this.toSnapshot(state));
  }

  private emit(nodeId: string, snapshot: RuntimeNodeProfilingSnapshot | null): void {
    const event: RuntimeNodeProfilingChangeEvent = {
      revision: this.revision,
      nodeId,
      profiling: snapshot
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[runtime] node profiling listener error for "${nodeId}":`, error);
      }
    }
  }
}
