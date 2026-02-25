const { randomUUID } = require("node:crypto");

class Runtime {
  constructor(options = {}) {
    this.wires = new Map();
    this.nodes = new Map();
    this.globalStore = new Map();
    this.maxInflightPerNode = options.maxInflightPerNode ?? 50;
    this.maxQueuePerNode = options.maxQueuePerNode ?? 5000;
    this.nodeState = new Map(); // nodeId -> { inflight, queue }
  }

  addNode(id, handler) {
    this.nodes.set(id, handler);
  }

  wire(from, to) {
    if (!this.wires.has(from)) this.wires.set(from, []);
    this.wires.get(from).push(to);
  }

  getGlobal(key, defaultValue) {
    if (!this.globalStore.has(key)) return defaultValue;
    return this.globalStore.get(key);
  }

  setGlobal(key, value) {
    this.globalStore.set(key, value);
    return value;
  }

  hasGlobal(key) {
    return this.globalStore.has(key);
  }

  deleteGlobal(key) {
    return this.globalStore.delete(key);
  }

  getGlobalEntries() {
    return Object.fromEntries(this.globalStore.entries());
  }

  createNodeContext(nodeId) {
    const getAssetStorage = () => this.getGlobal("assetStorage");
    const getEventStore = () => this.getGlobal("eventStore");

    return {
      nodeId,
      global: {
        get: (key, defaultValue) => this.getGlobal(key, defaultValue),
        set: (key, value) => this.setGlobal(key, value),
        has: (key) => this.hasGlobal(key),
        delete: (key) => this.deleteGlobal(key),
      },
      asset: {
        query: (path) => {
          const store = getAssetStorage();
          if (!store || typeof store.query !== "function") return [];
          return store.query(path);
        },
        get: (path, defaultValue) => {
          const store = getAssetStorage();
          if (!store || typeof store.getAttribute !== "function") return defaultValue;
          return store.getAttribute(path, defaultValue);
        },
        getAll: (path) => {
          const store = getAssetStorage();
          if (!store || typeof store.getAttributes !== "function") return [];
          return store.getAttributes(path);
        },
        set: (path, value) => {
          const store = getAssetStorage();
          if (!store || typeof store.setAttribute !== "function") return [];
          return store.setAttribute(path, value);
        },
        setMany: (items) => {
          const store = getAssetStorage();
          if (!store || typeof store.setAttributes !== "function") return [];
          return store.setAttributes(items);
        },
        findByValue: (path, expectedValue, options) => {
          const store = getAssetStorage();
          if (!store || typeof store.findAttributesByValue !== "function") {
            return { path, expectedValue, strict: options?.strict === true, count: 0, assetCount: 0, matches: [], assets: [] };
          }
          return store.findAttributesByValue(path, expectedValue, options);
        },
        find: (path, expectedValue, options) => {
          const store = getAssetStorage();
          if (!store || typeof store.findAttributesByValue !== "function") {
            return { path, expectedValue, strict: options?.strict === true, count: 0, assetCount: 0, matches: [], assets: [] };
          }
          return store.findAttributesByValue(path, expectedValue, options);
        },
        hierarchy: (options) => {
          const store = getAssetStorage();
          if (!store || typeof store.getHierarchy !== "function") return [];
          return store.getHierarchy(options);
        },
      },
      eventSys: {
        open: (eventPath, ts, context, notes, severity) => {
          const store = getEventStore();
          if (!store || typeof store.open !== "function") {
            throw new Error("eventStore belum tersedia");
          }
          return store.open(eventPath, ts, context, notes, severity);
        },
        close: (pattern, ts, notes) => {
          const store = getEventStore();
          if (!store || typeof store.close !== "function") {
            throw new Error("eventStore belum tersedia");
          }
          return store.close(pattern, ts, notes);
        },
        get: (pattern, from, to, status, contextFilters, options) => {
          const store = getEventStore();
          if (!store || typeof store.get !== "function") {
            throw new Error("eventStore belum tersedia");
          }
          return store.get(pattern, from, to, status, contextFilters, options);
        }
      }
    };
  }

  getNodeState(nodeId) {
    if (!this.nodeState.has(nodeId)) {
      this.nodeState.set(nodeId, { inflight: 0, queue: [] });
    }
    return this.nodeState.get(nodeId);
  }

  enqueueNodeMessage(nodeId, msg) {
    const state = this.getNodeState(nodeId);
    if (state.queue.length >= this.maxQueuePerNode) {
      console.warn(
        `Queue node "${nodeId}" penuh (${this.maxQueuePerNode}); msg dibuang`
      );
      return;
    }
    state.queue.push(msg);
    this.drainNodeQueue(nodeId);
  }

  drainNodeQueue(nodeId) {
    const state = this.getNodeState(nodeId);
    const handler = this.nodes.get(nodeId);
    if (!handler) {
      console.warn(`Node "${nodeId}" tidak ditemukan`);
      state.queue.length = 0;
      return;
    }

    while (
      state.inflight < this.maxInflightPerNode &&
      state.queue.length > 0
    ) {
      const msg = state.queue.shift();
      state.inflight += 1;

      // Event-loop dispatch biar antar node tetap async.
      setImmediate(async () => {
        try {
          const send = (outMsg) => {
            this.send(nodeId, outMsg);
          };
          const context = this.createNodeContext(nodeId);

          await handler(msg, send, context);
        } catch (error) {
          console.error(`Error di node "${nodeId}":`, error.message);
        } finally {
          state.inflight -= 1;
          this.drainNodeQueue(nodeId);
        }
      });
    }
  }

  normalizeMessage(msg) {
    const source =
      msg && typeof msg === "object" && !Array.isArray(msg)
        ? msg
        : { payload: msg };
    const normalized = { ...source };
    if (typeof normalized.id !== "string" || !normalized.id.trim()) {
      normalized.id = randomUUID();
    }
    if (typeof normalized.ts !== "string" || !normalized.ts.trim()) {
      normalized.ts = new Date().toISOString();
    }
    return normalized;
  }

  send(fromId, msg) {
    const normalized = this.normalizeMessage(msg);
    const nexts = this.wires.get(fromId) || [];

    for (const nextId of nexts) {
      const msgClone = structuredClone(normalized);
      this.enqueueNodeMessage(nextId, msgClone);
    }
  }
}

module.exports = Runtime;
