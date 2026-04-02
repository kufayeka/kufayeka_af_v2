import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { HistorianBridgeContract, HistorianDomainControllerContract } from "./HistorianContracts";
import { HistorianDomainService } from "./HistorianDomainService";

interface HistorianDomainControllerDeps {
  dbConnectionManager?: DbConnectionManager | null;
}

export class HistorianDomainController implements HistorianDomainControllerContract {
  readonly domain = "historian" as const;
  private readonly service: HistorianDomainService;

  constructor(runtime: Runtime, deps: HistorianDomainControllerDeps = {}) {
    this.service = new HistorianDomainService(runtime, deps);
  }

  bindRuntime(runtime: Runtime): void {
    this.service.bindRuntime(runtime);
  }

  initializeBridge(targets: unknown[] = []): HistorianBridgeContract {
    return this.service.initializeBridge(targets);
  }

  getBridge(): HistorianBridgeContract | null {
    return this.service.getBridge();
  }

  getStats(): Record<string, unknown> {
    return this.service.getStats();
  }
}
