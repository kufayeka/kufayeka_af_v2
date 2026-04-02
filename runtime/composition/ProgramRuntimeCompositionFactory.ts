import type Runtime from "../Runtime";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { EventTemplateDefinition, ProgramDefinition } from "../core/runtimeTypes";
import type { ProgramFlowDefinition, ProgramTriggerTemplate } from "../flow/ProgramFlowContracts";
import type { RuntimeServiceRegistry } from "./RuntimeServiceRegistry";
import type { ProgramRuntimeComposition } from "./RuntimeComposition";

function createScriptTemplateMap(scriptTemplates: unknown[]): Map<string, unknown> {
  return new Map(
    scriptTemplates.map((template) => [
      String((template as { id?: unknown }).id || ""),
      template,
    ])
  );
}

function createEventTemplateMap(eventTemplates: EventTemplateDefinition[]): Map<string, EventTemplateDefinition> {
  return new Map(
    eventTemplates.map((template) => [
      String((template as { id?: unknown }).id || ""),
      template,
    ])
  );
}

export function createProgramRuntimeComposition(
  runtime: Runtime,
  services: RuntimeServiceRegistry,
  program: ProgramDefinition,
  programFlows: ProgramFlowDefinition[]
): ProgramRuntimeComposition {
  const assetStore = services.asset.getStore();
  if (!assetStore) throw new Error("Asset domain failed to initialize");

  const eventStore = services.event.getStore();
  if (!eventStore) throw new Error("Event domain failed to initialize");

  const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);

  const scriptTemplates = Array.isArray(program.scriptTemplates) ? program.scriptTemplates : [];
  const eventTemplates = services.event.getTemplates();
  const triggerTemplates = Array.isArray(program.triggerTemplates)
    ? (program.triggerTemplates as ProgramTriggerTemplate[])
    : [];
  const flowDefinitionsById = new Map(programFlows.map((flow) => [flow.id, flow]));
  void runtime;

  return {
    services,
    dbConnectionManager,
    assetStore,
    eventStore,
    scriptTemplatesById: createScriptTemplateMap(scriptTemplates),
    eventTemplates,
    eventTemplatesById: createEventTemplateMap(eventTemplates),
    flowDefinitionsById,
    triggerTemplates,
    flowNodeConfigById: {}
  };
}
