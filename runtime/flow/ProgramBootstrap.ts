import Runtime from "../Runtime";
import { RuntimeBootstrap } from "../composition/RuntimeBootstrap";
import { createProgramRuntimeComposition } from "../composition/ProgramRuntimeCompositionFactory";
import type { ProgramRuntimeComposition } from "../composition/RuntimeComposition";
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

function buildEnabledProgramFlows(program: ProgramDefinition) {
  return buildProgramFlows(program).filter((flow) => flow.enabled !== false);
}

function readConfigWithFlowId(node: ProgramFlowNode, flowId: string): Record<string, unknown> {
  const config = node.config && typeof node.config === "object"
    ? (node.config as Record<string, unknown>)
    : {};
  return {
    ...config,
    __flowId: flowId
  };
}

function flattenFlowNodes(programFlows: ReturnType<typeof buildEnabledProgramFlows>): ProgramFlowNode[] {
  return programFlows.flatMap((flow) =>
    ((flow.nodes || []) as ProgramFlowNode[]).map((node) => ({
      ...node,
      config: readConfigWithFlowId(node, flow.id)
    }))
  );
}

function flattenFlowLinks(programFlows: ReturnType<typeof buildEnabledProgramFlows>): ProgramLink[] {
  return programFlows.flatMap((flow) => (flow.links || []) as ProgramLink[]);
}

function createFlowVariableResolver(
  programFlows: ReturnType<typeof buildEnabledProgramFlows>
): ProgramRuntimeComposition["resolveFlowVariables"] {
  return (flowId: string, context: Parameters<RuntimeNodeHandler>[2]) => {
    const flow = programFlows.find((item) => item.id === flowId);
    if (!flow) return {};

    const resolvedVariables: Record<string, unknown> = {};
    for (const variable of flow.variables || []) {
      const variableName = String(variable?.name || "").trim();
      if (!variableName) continue;
      resolvedVariables[variableName] = resolveFlowVariableValue(variable || {}, context);
    }
    return resolvedVariables;
  };
}

function stopAll(stops: Array<() => void>): void {
  for (const stop of stops) stop();
}

/**
 * Runtime entrypoint for a program definition.
 *
 * This function wires the domain services, flattens enabled flows into runtime
 * nodes/links, registers handlers, and starts trigger subscriptions/timers.
 */
export function startProgram(runtime: Runtime, program: ProgramDefinition): () => void {
  runtime.clearAllNodeStatuses();

  const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
  const services = new RuntimeServiceRegistry({ runtime, dbConnectionManager });
  const bootstrap = new RuntimeBootstrap(runtime, services);
  bootstrap.initializeProgram(program);

  const programFlows = buildEnabledProgramFlows(program);
  const flatNodes = flattenFlowNodes(programFlows);
  const flatLinks = flattenFlowLinks(programFlows);
  const composition = createProgramRuntimeComposition(runtime, services, program, programFlows);

  composition.resolveFlowVariables = createFlowVariableResolver(programFlows);
  runtime.setProgramComposition(composition);

  registerFlowNodes(runtime, flatNodes, composition);
  registerLinks(runtime, flatLinks);

  const triggerNodes = flatNodes.filter((node) => node.kind === "trigger");
  const stops = startTriggers(runtime, triggerNodes, composition, program.triggers || []);

  return () => {
    stopAll(stops);
  };
}
