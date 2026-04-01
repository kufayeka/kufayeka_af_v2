import Runtime from "../Runtime";
import { normalizeAssetSection } from "../assetFramework";
import { RuntimeBootstrap } from "../composition/RuntimeBootstrap";
import { RuntimeServiceRegistry } from "../composition/RuntimeServiceRegistry";
import type { ProgramDefinition, RuntimeNodeHandler } from "../types";
import { buildProgramFlows, resolveFlowVariableValue } from "./programFlowUtils";
import type {
  ProgramFlowNode,
  ProgramLink,
  ProgramTriggerTemplate,
} from "./programFlowTypes";
import { registerFlowNodes, registerLinks } from "./programNodeRegistration";
import { startTriggers } from "./programTriggerUtils";

export function startProgram(runtime: Runtime, program: ProgramDefinition): () => void {
  const assets = normalizeAssetSection(program.assets || {});
  const services = new RuntimeServiceRegistry(runtime);
  const bootstrap = new RuntimeBootstrap(runtime, services);
  runtime.setGlobal("serviceRegistry", services);
  bootstrap.initializeProgram(program);
  const assetStorage = services.asset.getStore();
  if (!assetStorage) throw new Error("Asset domain failed to initialize");

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

  runtime.setGlobal(
    "flowDefinitionsById",
    Object.fromEntries(programFlows.map((flow) => [flow.id, flow]))
  );
  runtime.setGlobal(
    "resolveFlowVariables",
    (flowId: string, context: Parameters<RuntimeNodeHandler>[2]) => {
      const flow = programFlows.find((item) => item.id === flowId);
      if (!flow) return {};
      const resolved: Record<string, unknown> = {};
      for (const [index, variable] of (flow.variables || []).entries()) {
        const key = String(variable?.name || "").trim();
        if (!key) continue;
        resolved[key] = resolveFlowVariableValue((flow.variables || [])[index] || {}, context);
      }
      return resolved;
    }
  );

  registerFlowNodes(runtime, flatNodes);
  registerLinks(runtime, flatLinks);

  const triggerNodes = flatNodes.filter((node) => node.kind === "trigger");
  const stops = startTriggers(
    runtime,
    triggerNodes,
    Array.isArray(program.triggerTemplates) ? (program.triggerTemplates as ProgramTriggerTemplate[]) : [],
    program.triggers || []
  );

  return () => {
    void assets;
    void assetStorage;
    for (const stop of stops) stop();
  };
}
