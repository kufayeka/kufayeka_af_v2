import type Runtime from "../Runtime";
import type { ProgramDefinition } from "../types";
import { normalizeAssetSection } from "../assetFramework";
import type { RuntimeServiceRegistry } from "./RuntimeServiceRegistry";

export class RuntimeBootstrap {
  private readonly runtime: Runtime;
  private readonly services: RuntimeServiceRegistry;

  constructor(runtime: Runtime, services: RuntimeServiceRegistry) {
    this.runtime = runtime;
    this.services = services;
  }

  initializeProgram(program: ProgramDefinition): void {
    const assets = normalizeAssetSection(program.assets || {});
    this.runtime.setGlobal("assetDomainController", this.services.asset);
    this.runtime.setGlobal("eventDomainController", this.services.event);
    this.runtime.setGlobal("historianDomainController", this.services.historian);
    this.services.asset.initialize(assets);
    this.services.event.initializeStore();
    this.services.asset.replaceState(assets);
    this.services.event.setTemplates(program.eventTemplates || []);
    this.runtime.setGlobal("scriptTemplates", Array.isArray(program.scriptTemplates) ? program.scriptTemplates : []);
  }
}
