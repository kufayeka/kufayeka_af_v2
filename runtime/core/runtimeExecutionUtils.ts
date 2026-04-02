import { randomUUID } from "node:crypto";
import type { RuntimeMessage } from "./runtimeTypes";

export interface RuntimeOptions {
  maxInflightPerNode?: number;
  maxQueuePerNode?: number;
  nodeExecutionTimeoutMs?: number;
}

export interface NodeExecutionState {
  inflight: number;
  queue: RuntimeMessage[];
}

export interface RuntimeDeps {
  now?: () => string;
  generateId?: () => string;
  cloneMessage?: <T>(value: T) => T;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export function createRuntimeDeps(deps: RuntimeDeps = {}): Required<RuntimeDeps> {
  return {
    now: deps.now || (() => new Date().toISOString()),
    generateId: deps.generateId || randomUUID,
    cloneMessage: deps.cloneMessage || (<T>(value: T) => structuredClone(value)),
    setTimeoutImpl: deps.setTimeoutImpl || setTimeout,
    clearTimeoutImpl: deps.clearTimeoutImpl || clearTimeout
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  deps: Pick<Required<RuntimeDeps>, "setTimeoutImpl" | "clearTimeoutImpl">
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = deps.setTimeoutImpl(() => reject(new Error(timeoutMessage)), timeoutMs) as NodeJS.Timeout;
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) deps.clearTimeoutImpl(timer);
  }
}

export function getOrCreateNodeState(
  nodeState: Map<string, NodeExecutionState>,
  nodeId: string
): NodeExecutionState {
  if (!nodeState.has(nodeId)) {
    nodeState.set(nodeId, { inflight: 0, queue: [] });
  }
  return nodeState.get(nodeId) as NodeExecutionState;
}

export async function waitForInflightToDrain(
  nodeState: Map<string, NodeExecutionState>,
  deadlineMs: number,
  deps: Pick<Required<RuntimeDeps>, "setTimeoutImpl" | "clearTimeoutImpl">
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    let inflight = 0;
    for (const state of nodeState.values()) {
      inflight += state.inflight;
    }
    if (inflight <= 0) return true;
    await new Promise<void>((resolve) => {
      const timer = deps.setTimeoutImpl(resolve, 25) as NodeJS.Timeout;
      timer.unref?.();
    });
  }
  return false;
}
