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
    return {
      nodeId,
      global: {
        get: (key, defaultValue) => this.getGlobal(key, defaultValue),
        set: (key, value) => this.setGlobal(key, value),
        has: (key) => this.hasGlobal(key),
        delete: (key) => this.deleteGlobal(key),
      },
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

  send(fromId, msg) {
    const nexts = this.wires.get(fromId) || [];

    for (const nextId of nexts) {
      const msgClone = structuredClone(msg);
      this.enqueueNodeMessage(nextId, msgClone);
    }
  }
}

module.exports = Runtime;
