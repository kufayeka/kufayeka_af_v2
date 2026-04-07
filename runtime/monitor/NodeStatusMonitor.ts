import type {
  RuntimeNodeStatus,
  RuntimeNodeStatusChangeEvent,
  RuntimeNodeStatusInput,
  RuntimeNodeStatusItem
} from "../core/runtimeTypes";
import { formatRuntimeDisplayText } from "../core/runtimeNumberUtils";

export interface NodeStatusMonitorDeps {
  now: () => string;
}

export class NodeStatusMonitor {
  private readonly statuses = new Map<string, RuntimeNodeStatus>();
  private revision = 0;
  private enabled = false;
  private readonly listeners = new Set<(event: RuntimeNodeStatusChangeEvent) => void>();

  constructor(private readonly deps: NodeStatusMonitorDeps) {}

  set(nodeId: string, status: RuntimeNodeStatusInput): RuntimeNodeStatus {
    if (!this.enabled) return [];
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
      this.clear(nodeId);
      return [];
    }
    this.statuses.set(nodeId, normalized);
    this.revision += 1;
    this.emit(nodeId, normalized);
    return normalized;
  }

  clear(nodeId: string): boolean {
    const deleted = this.statuses.delete(nodeId);
    if (!deleted) return false;
    this.revision += 1;
    this.emit(nodeId, null);
    return true;
  }

  clearAll(): void {
    if (this.statuses.size === 0) return;
    const previousNodeIds = Array.from(this.statuses.keys());
    this.statuses.clear();
    this.revision += 1;
    for (const nodeId of previousNodeIds) {
      this.emit(nodeId, null);
    }
  }

  get(nodeId: string): RuntimeNodeStatus | null {
    return this.statuses.get(nodeId) || null;
  }

  getAll(): Record<string, RuntimeNodeStatus> {
    return Object.fromEntries(this.statuses.entries());
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

  subscribe(listener: (event: RuntimeNodeStatusChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(nodeId: string, status: RuntimeNodeStatus | null): void {
    const event: RuntimeNodeStatusChangeEvent = {
      revision: this.revision,
      nodeId,
      status
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[runtime] node status listener error for "${nodeId}":`, error);
      }
    }
  }
}
