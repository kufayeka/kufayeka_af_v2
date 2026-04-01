import type Runtime from "../Runtime";
import type { HistorianBridgeContract, HistorianDomainControllerContract } from "./contracts";
import { HistorianDomainService } from "./HistorianDomainService";

export class HistorianDomainController implements HistorianDomainControllerContract {
  readonly domain = "historian" as const;
  private readonly service: HistorianDomainService;

  constructor(runtime: Runtime) {
    this.service = new HistorianDomainService(runtime);
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
