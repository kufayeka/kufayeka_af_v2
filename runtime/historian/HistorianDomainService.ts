import type Runtime from "../Runtime";
import { createHistorianBridge } from "./HistorianBridgeFactory";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { HistorianTarget } from "../core/runtimeTypes";
import type { HistorianBridgeContract, HistorianDomainServiceContract } from "./HistorianContracts";

interface HistorianDomainServiceDeps {
  dbConnectionManager?: DbConnectionManager | null;
}

export class HistorianDomainService implements HistorianDomainServiceContract {
  private runtime: Runtime | null;
  private dbConnectionManager: DbConnectionManager | null;
  private bridge: HistorianBridgeContract | null = null;

  constructor(runtime: Runtime, deps: HistorianDomainServiceDeps = {}) {
    this.runtime = runtime;
    this.dbConnectionManager = deps.dbConnectionManager ?? null;
  }

  bindRuntime(runtime: Runtime): void {
    this.runtime = runtime;
    this.syncRuntimeMirrors();
  }

  initializeBridge(targets: unknown[] = []): HistorianBridgeContract {
    if (this.bridge) {
      this.bridge.updateTargets(targets);
      this.syncRuntimeMirrors();
      return this.bridge;
    }

    this.bridge = createHistorianBridge({
      enabled: process.env.HISTORIAN_ENABLED !== "0",
      timestampUnit: process.env.HISTORIAN_TIMESTAMP_UNIT || "us",
      maxQueue: Number(process.env.HISTORIAN_MAX_QUEUE || 100000),
      targets,
      enqueueHistorianRows: (rows) => {
        const db = this.resolveDbConnectionManager();
        if (!db) return;
        for (const row of rows) {
          db.enqueueHistorian(row);
        }
      }
    }) as HistorianBridgeContract;

    this.syncRuntimeMirrors();
    return this.bridge;
  }

  getBridge(): HistorianBridgeContract | null {
    return this.bridge;
  }

  getStats(): Record<string, unknown> {
    return this.bridge ? this.bridge.stats() : {};
  }

  updateTargets(targets: HistorianTarget[] | unknown[] = []): void {
    const bridge = this.initializeBridge(targets);
    bridge.updateTargets(targets);
    this.syncRuntimeMirrors();
  }

  private requireRuntime(): Runtime {
    if (!this.runtime) throw new Error("HistorianDomainService is not bound to a runtime");
    return this.runtime;
  }

  private resolveDbConnectionManager(): DbConnectionManager | null {
    if (this.dbConnectionManager) return this.dbConnectionManager;
    if (!this.runtime) return null;
    this.dbConnectionManager = this.runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
    return this.dbConnectionManager;
  }

  private syncRuntimeMirrors(): void {
    if (!this.runtime) return;
    if (this.bridge) {
      this.runtime.setGlobal("historianBridge", this.bridge);
      this.runtime.setGlobal("historianBridgeStats", this.bridge.stats());
      return;
    }
    this.runtime.setGlobal("historianBridgeStats", {});
  }
}
