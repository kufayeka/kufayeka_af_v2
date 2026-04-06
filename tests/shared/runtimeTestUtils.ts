import type {
  EventRow,
  QueryMatch,
  RuntimeDbApi,
  RuntimeEventApi,
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeStatus,
  RuntimeNodeStatusInput
} from "../../runtime/core/runtimeTypes";

export interface TestContextOptions {
  assetValues?: Record<string, unknown>;
  assetQueryMatches?: Record<string, QueryMatch[]>;
  flowId?: string;
  flowName?: string;
  flowVariables?: Record<string, unknown>;
  eventSys?: Partial<RuntimeEventApi>;
  db?: Partial<RuntimeDbApi>;
}

export interface SendCapture {
  items: Array<{ msg: RuntimeMessage; port: string }>;
  send: (msgOrPorts: RuntimeMessage | string[] | number[], msgOrPort?: RuntimeMessage | string, maybePort?: string) => void;
}

function createDefaultEventRow(id = "evt-1"): EventRow {
  return {
    id,
    event_path: "Plant.Line1.Machine01.Alarm",
    start_ts: "2026-01-01T00:00:00.000Z",
    end_ts: null,
    status: "open",
    severity: "info",
    context: {},
    is_acknowledge: false,
    acknowledged_ts: null,
    notes_on_open: null,
    notes_on_close: null,
    event_metadata: null,
    captured_data_on_open: null,
    captured_data_on_close: null
  };
}

export function createSendCapture(): SendCapture {
  const items: Array<{ msg: RuntimeMessage; port: string }> = [];
  return {
    items,
    send: (msgOrPorts, msgOrPort, maybePort) => {
      if (Array.isArray(msgOrPorts)) {
        const msg = msgOrPort as RuntimeMessage;
        for (const port of msgOrPorts.map((item) => String(item))) {
          items.push({ msg, port });
        }
        return;
      }

      const msg = msgOrPorts as RuntimeMessage;
      const port = typeof msgOrPort === "string" ? msgOrPort : typeof maybePort === "string" ? maybePort : "default";
      items.push({ msg, port });
    }
  };
}

export function createTestNodeContext(options: TestContextOptions = {}): RuntimeNodeContext & { statuses: RuntimeNodeStatus[] } {
  const assetValues = { ...(options.assetValues || {}) };
  const assetQueryMatches = { ...(options.assetQueryMatches || {}) };
  const statuses: RuntimeNodeStatus[] = [];

  const eventSysBase: RuntimeEventApi = {
    open: async () => createDefaultEventRow("open-1"),
    close: async (pattern = "*", ts = "2026-01-01T00:00:00.000Z", notes = "", captured = null) => ({
      pattern,
      closedCount: 1,
      ts,
      notes_on_close: notes,
      captured_data_on_close: captured
    }),
    get: async () => [],
    getEarliestTs: async () => null,
    getLatestTs: async () => null,
    getRange: async () => ({ start_ts: null, end_ts: null, count: 0 }),
    openTemplate: async () => createDefaultEventRow("tmpl-open-1"),
    closeTemplate: async (_templateId, optionsArg) => ({
      pattern: optionsArg?.pattern || "*",
      closedCount: 1,
      ts: optionsArg?.ts || "2026-01-01T00:00:00.000Z",
      notes_on_close: optionsArg?.notes || null,
      rows: [createDefaultEventRow("tmpl-close-1")]
    })
  };

  const dbBase: RuntimeDbApi = {
    query: async () => ({ rows: [], rowCount: 0 }),
    executeSafe: async () => ({ rows: [], rowCount: 0 }),
    testConnection: async () => ({ ok: true, message: "ok", latencyMs: 1 })
  };

  return {
    nodeId: "node-test",
    global: {
      get: <T = unknown>(_key: string, defaultValue?: T) => defaultValue as T,
      set: <T = unknown>(_key: string, value: T) => value,
      has: () => false,
      delete: () => false
    },
    asset: {
      query: (path: string) => assetQueryMatches[path] || [],
      get: <T = unknown>(path: string, defaultValue?: T) => (Object.prototype.hasOwnProperty.call(assetValues, path) ? (assetValues[path] as T) : (defaultValue as T)),
      getValue: <T = unknown>(path: string, defaultValue?: T) => (Object.prototype.hasOwnProperty.call(assetValues, path) ? (assetValues[path] as T) : (defaultValue as T)),
      getAll: (path: string) => (assetQueryMatches[path] || []).filter((item) => String(item.kind) === "attribute") as any,
      set: async (path: string, value: unknown) => {
        assetValues[path] = value;
        return [];
      },
      setMany: async (items) => {
        for (const item of items) assetValues[item.path] = item.value;
        return [];
      },
      findByValue: () => ({ path: "", expectedValue: null, strict: false, count: 0, assetCount: 0, matches: [], assets: [] }),
      find: () => ({ path: "", expectedValue: null, strict: false, count: 0, assetCount: 0, matches: [], assets: [] }),
      hierarchy: () => []
    },
    eventSys: { ...eventSysBase, ...(options.eventSys || {}) },
    db: { ...dbBase, ...(options.db || {}) },
    action: {
      status: (status: RuntimeNodeStatusInput) => {
        const normalized = Array.isArray(status) ? status : [status];
        statuses.push(normalized as RuntimeNodeStatus);
        return normalized as RuntimeNodeStatus;
      }
    },
    flow: {
      id: options.flowId || "flow-test",
      name: options.flowName || "Flow Test",
      variables: { ...(options.flowVariables || {}) }
    },
    statuses
  };
}

export class FakeFlowRuntime {
  readonly nodes = new Map<string, unknown>();
  readonly wires: Array<{ from: string; to: string; fromPort: string }> = [];
  readonly globals = new Map<string, unknown>();
  readonly sent: Array<{ nodeId: string; msg: unknown; port: string }> = [];

  addNode(id: string, handler: unknown): void {
    this.nodes.set(id, handler);
  }

  wire(from: string, to: string, fromPort = "default"): void {
    this.wires.push({ from, to, fromPort });
  }

  setGlobal<T = unknown>(key: string, value: T): T {
    this.globals.set(key, value);
    return value;
  }

  getGlobal<T = unknown>(key: string, defaultValue?: T): T {
    return (this.globals.has(key) ? this.globals.get(key) : defaultValue) as T;
  }

  send(nodeId: string, msg: unknown, port = "default"): void {
    this.sent.push({ nodeId, msg, port });
  }
}

export class FakeSubscribable<T> {
  private listeners = new Set<(payload: T) => void>();

  subscribe(listener: (payload: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: T): void {
    for (const listener of this.listeners) listener(payload);
  }
}
