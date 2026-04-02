import type Runtime from "../Runtime";
import type { ProgramDefinition } from "../core/runtimeTypes";
import { normalizeAssetSection } from "../asset/AssetStoreFactory";
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
    this.services.asset.initialize(assets);
    this.services.event.initializeStore();
    this.services.asset.replaceState(assets);
    this.services.event.setTemplates(program.eventTemplates || []);
  }
}
