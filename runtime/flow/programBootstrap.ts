import Runtime from "../Runtime";
import { normalizeAssetSection } from "../asset/AssetStoreFactory";
import { RuntimeBootstrap } from "../composition/RuntimeBootstrap";
import { createProgramRuntimeComposition } from "../composition/ProgramRuntimeCompositionFactory";
import { RuntimeServiceRegistry } from "../composition/RuntimeServiceRegistry";
import type { DbConnectionManager } from "../db/dbConnectionManager";
import type { ProgramDefinition, RuntimeNodeHandler } from "../core/runtimeTypes";
import { buildProgramFlows, resolveFlowVariableValue } from "./ProgramFlowSupport";
import type {
  ProgramFlowNode,
  ProgramLink,
} from "./ProgramFlowContracts";
import { registerFlowNodes, registerLinks } from "./ProgramNodeRegistration";
import { startTriggers } from "./ProgramTriggerStarter";

export function startProgram(runtime: Runtime, program: ProgramDefinition): () => void {
  runtime.clearAllNodeStatuses();
  const assets = normalizeAssetSection(program.assets || {});
  const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
  const services = new RuntimeServiceRegistry({ runtime, dbConnectionManager });
  const bootstrap = new RuntimeBootstrap(runtime, services);
  bootstrap.initializeProgram(program);

  const programFlows = buildProgramFlows(program).filter((flow) => flow.enabled !== false);
  const flatNodes = programFlows.flatMap((flow) =>
    ((flow.nodes || []) as ProgramFlowNode[]).map((node) => ({
      ...node,
      config: {
        ...((node.config && typeof node.config === "object") ? node.config : {}),
        __flowId: flow.id,
      },
    }))
  );
  const flatLinks = programFlows.flatMap((flow) => (flow.links || []) as ProgramLink[]);
  const composition = createProgramRuntimeComposition(runtime, services, program, programFlows);

  const resolveFlowVariables = (flowId: string, context: Parameters<RuntimeNodeHandler>[2]) => {
    const flow = programFlows.find((item) => item.id === flowId);
    if (!flow) return {};
    const resolved: Record<string, unknown> = {};
    for (const [index, variable] of (flow.variables || []).entries()) {
      const key = String(variable?.name || "").trim();
      if (!key) continue;
      resolved[key] = resolveFlowVariableValue((flow.variables || [])[index] || {}, context);
    }
    return resolved;
  };
  composition.resolveFlowVariables = resolveFlowVariables;
  runtime.setProgramComposition(composition);

  registerFlowNodes(runtime, flatNodes, composition);
  registerLinks(runtime, flatLinks);

  const triggerNodes = flatNodes.filter((node) => node.kind === "trigger");
  const stops = startTriggers(runtime, triggerNodes, composition, program.triggers || []);

  return () => {
    void assets;
    for (const stop of stops) stop();
  };
}
