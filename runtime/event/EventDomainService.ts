import type Runtime from "../Runtime";
import { normalizeEventTemplates } from "./template/EventTemplateExports";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { EventStore, EventTemplateDefinition } from "../core/runtimeTypes";
import type { EventDomainServiceContract, EventStoreMeta } from "./EventContracts";
import { OpenEventCache } from "./store/OpenEventCache";
import { PostgresEventRepository } from "./store/PostgresEventRepository";
import { EventStoreService } from "./store/EventStoreService";

interface EventDomainServiceDeps {
  dbConnectionManager?: DbConnectionManager | null;
}

export class EventDomainService implements EventDomainServiceContract {
  private runtime: Runtime | null;
  private dbConnectionManager: DbConnectionManager | null;
  private store: EventStore | null = null;
  private templates: EventTemplateDefinition[] = [];

  constructor(runtime: Runtime, deps: EventDomainServiceDeps = {}) {
    this.runtime = runtime;
    this.dbConnectionManager = deps.dbConnectionManager ?? null;
  }

  bindRuntime(runtime: Runtime): void {
    this.runtime = runtime;
    this.syncRuntimeMirrors();
  }

  initializeStore(): EventStore {
    if (this.store) return this.store;

    const dbConnectionManager = this.resolveDbConnectionManager();
    if (!dbConnectionManager) throw new Error("DB connection manager is required for af_event store");

    this.store = new EventStoreService(
      new PostgresEventRepository(dbConnectionManager),
      new OpenEventCache()
    );
    this.syncRuntimeMirrors();
    return this.store;
  }

  getStore(): EventStore | null {
    return this.store;
  }

  setTemplates(definitions: unknown[]): EventTemplateDefinition[] {
    this.templates = normalizeEventTemplates(definitions || []);
    this.syncRuntimeMirrors();
    return this.templates;
  }

  getTemplates(): EventTemplateDefinition[] {
    return [...this.templates];
  }

  getMeta(): EventStoreMeta | null {
    return this.store ? this.store.getMeta() : null;
  }

  private requireRuntime(): Runtime {
    if (!this.runtime) throw new Error("EventDomainService is not bound to a runtime");
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
    if (this.store) {
      this.runtime.setGlobal("eventStore", this.store);
      this.runtime.setGlobal("eventStoreMeta", this.store.getMeta());
    }
    this.runtime.setGlobal("eventTemplates", [...this.templates]);
  }
}
