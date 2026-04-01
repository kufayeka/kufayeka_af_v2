import type Runtime from "../Runtime";
import { normalizeEventTemplates } from "../eventTemplateRuntime";
import type { DbConnectionManager } from "../dbConnectionManager";
import type { EventStore, EventTemplateDefinition } from "../types";
import type { EventDomainServiceContract, EventStoreMeta } from "./contracts";
import { OpenEventCache } from "./OpenEventCache";
import { PostgresEventRepository } from "./PostgresEventRepository";
import { EventStoreService } from "./EventStoreService";

export class EventDomainService implements EventDomainServiceContract {
  private runtime: Runtime | null;

  constructor(runtime: Runtime) {
    this.runtime = runtime;
  }

  bindRuntime(runtime: Runtime): void {
    this.runtime = runtime;
  }

  initializeStore(): EventStore {
    const runtime = this.requireRuntime();
    const existing = runtime.getGlobal<EventStore | null>("eventStore", null);
    if (existing) return existing;
    const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
    if (!dbConnectionManager) throw new Error("DB connection manager is required for af_event store");
    const store = new EventStoreService(new PostgresEventRepository(dbConnectionManager), new OpenEventCache());
    runtime.setGlobal("eventStore", store);
    runtime.setGlobal("eventStoreMeta", store.getMeta());
    return store;
  }

  getStore(): EventStore | null {
    return this.requireRuntime().getGlobal<EventStore | null>("eventStore", null);
  }

  setTemplates(definitions: unknown[]): EventTemplateDefinition[] {
    const runtime = this.requireRuntime();
    const normalized = normalizeEventTemplates(definitions || []);
    runtime.setGlobal("eventTemplates", normalized);
    return normalized;
  }

  getTemplates(): EventTemplateDefinition[] {
    return this.requireRuntime().getGlobal<EventTemplateDefinition[]>("eventTemplates", []);
  }

  getMeta(): EventStoreMeta | null {
    const store = this.getStore();
    return store ? store.getMeta() : null;
  }

  private requireRuntime(): Runtime {
    if (!this.runtime) throw new Error("EventDomainService is not bound to a runtime");
    return this.runtime;
  }
}
