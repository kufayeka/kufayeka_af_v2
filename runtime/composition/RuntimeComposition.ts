import type { AssetStore, EventTemplateDefinition, EventStore, RuntimeNodeContext } from "../core/runtimeTypes";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { ProgramFlowDefinition, ProgramTriggerTemplate } from "../flow/ProgramFlowContracts";
import type { RuntimeServiceRegistry } from "./RuntimeServiceRegistry";

export interface ProgramRuntimeComposition {
  services: RuntimeServiceRegistry;
  dbConnectionManager: DbConnectionManager | null;
  assetStore: AssetStore;
  eventStore: EventStore;
  scriptTemplatesById: Map<string, unknown>;
  eventTemplates: EventTemplateDefinition[];
  eventTemplatesById: Map<string, EventTemplateDefinition>;
  flowDefinitionsById: Map<string, ProgramFlowDefinition>;
  triggerTemplates: ProgramTriggerTemplate[];
  flowNodeConfigById: Record<string, Record<string, unknown>>;
  resolveFlowVariables?: (flowId: string, context: RuntimeNodeContext) => Record<string, unknown>;
}
