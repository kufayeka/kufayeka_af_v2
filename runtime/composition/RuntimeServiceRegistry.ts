import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import { ActionDomainController } from "../action/ActionDomainController";
import { AssetDomainController } from "../asset/AssetDomainController";
import { EventDomainController } from "../event/EventDomainController";
import { HistorianDomainController } from "../historian/HistorianDomainController";

export interface RuntimeServiceRegistryDeps {
  runtime: Runtime;
  dbConnectionManager?: DbConnectionManager | null;
}

export class RuntimeServiceRegistry {
  readonly asset: AssetDomainController;
  readonly event: EventDomainController;
  readonly historian: HistorianDomainController;
  readonly action: ActionDomainController;

  constructor(deps: RuntimeServiceRegistryDeps) {
    const dbConnectionManager = deps.dbConnectionManager ?? null;
    this.historian = new HistorianDomainController(deps.runtime, { dbConnectionManager });
    this.asset = new AssetDomainController(deps.runtime, { historianController: this.historian });
    this.event = new EventDomainController(deps.runtime, { dbConnectionManager });
    this.action = new ActionDomainController();
  }
}
