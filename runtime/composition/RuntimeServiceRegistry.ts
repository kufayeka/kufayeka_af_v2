import type Runtime from "../Runtime";
import { ActionDomainController } from "../action/ActionDomainController";
import { AssetDomainController } from "../asset/AssetDomainController";
import { EventDomainController } from "../event/EventDomainController";
import { HistorianDomainController } from "../historian/HistorianDomainController";

export class RuntimeServiceRegistry {
  readonly asset: AssetDomainController;
  readonly event: EventDomainController;
  readonly historian: HistorianDomainController;
  readonly action: ActionDomainController;

  constructor(runtime: Runtime) {
    this.asset = new AssetDomainController(runtime);
    this.event = new EventDomainController(runtime);
    this.historian = new HistorianDomainController(runtime);
    this.action = new ActionDomainController();
  }
}
