import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { EventStore, EventTemplateDefinition } from "../core/runtimeTypes";
import { EventDomainService } from "./EventDomainService";
import type { EventStoreMeta } from "./EventContracts";

interface EventDomainControllerDeps {
  dbConnectionManager?: DbConnectionManager | null;
}

export class EventDomainController {
  readonly domain = "event" as const;
  private readonly service: EventDomainService;

  constructor(runtime: Runtime, deps: EventDomainControllerDeps = {}) {
    this.service = new EventDomainService(runtime, deps);
  }

  bindRuntime(runtime: Runtime): void {
    this.service.bindRuntime(runtime);
  }

  initializeStore(): EventStore {
    return this.service.initializeStore();
  }

  setTemplates(definitions: unknown[]): EventTemplateDefinition[] {
    return this.service.setTemplates(definitions);
  }

  getTemplates(): EventTemplateDefinition[] {
    return this.service.getTemplates();
  }

  getStore(): EventStore | null {
    return this.service.getStore();
  }

  getMeta(): EventStoreMeta | null {
    return this.service.getMeta();
  }
}
