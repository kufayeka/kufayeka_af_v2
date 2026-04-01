import type Runtime from "../Runtime";
import { createHistorianBridge } from "../historianBridge";
import type { DbConnectionManager } from "../dbConnectionManager";
import type { HistorianTarget } from "../types";
import type { HistorianBridgeContract, HistorianDomainServiceContract } from "./contracts";

export class HistorianDomainService implements HistorianDomainServiceContract {
  private runtime: Runtime | null;

  constructor(runtime: Runtime) {
    this.runtime = runtime;
  }

  bindRuntime(runtime: Runtime): void {
    this.runtime = runtime;
  }

  initializeBridge(targets: unknown[] = []): HistorianBridgeContract {
    const runtime = this.requireRuntime();
    const existing = runtime.getGlobal<HistorianBridgeContract | null>("historianBridge", null);
    if (existing) {
      existing.updateTargets(targets);
      runtime.setGlobal("historianBridgeStats", existing.stats());
      return existing;
    }

    const bridge = createHistorianBridge({
      enabled: process.env.HISTORIAN_ENABLED !== "0",
      timestampUnit: process.env.HISTORIAN_TIMESTAMP_UNIT || "us",
      maxQueue: Number(process.env.HISTORIAN_MAX_QUEUE || 100000),
      targets,
      enqueueHistorianRows: (rows) => {
        const db = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
        if (!db) return;
        for (const row of rows) {
          db.enqueueHistorian(row);
        }
      }
    }) as HistorianBridgeContract;

    runtime.setGlobal("historianBridge", bridge);
    runtime.setGlobal("historianBridgeStats", bridge.stats());
    return bridge;
  }

  getBridge(): HistorianBridgeContract | null {
    return this.requireRuntime().getGlobal<HistorianBridgeContract | null>("historianBridge", null);
  }

  getStats(): Record<string, unknown> {
    return this.requireRuntime().getGlobal<Record<string, unknown>>("historianBridgeStats", {});
  }

  updateTargets(targets: HistorianTarget[] | unknown[] = []): void {
    const bridge = this.initializeBridge(targets);
    bridge.updateTargets(targets);
    this.requireRuntime().setGlobal("historianBridgeStats", bridge.stats());
  }

  private requireRuntime(): Runtime {
    if (!this.runtime) throw new Error("HistorianDomainService is not bound to a runtime");
    return this.runtime;
  }
}
