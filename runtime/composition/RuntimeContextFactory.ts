import type Runtime from "../Runtime";
import type { RuntimeNodeContext } from "../core/runtimeTypes";
import {
  createAssetApi,
  createDbApi,
  createEventApi,
  createRuntimeContextDeps,
  createRuntimeContextResolvers,
  resolveFlowContext,
  type RuntimeContextFactoryDeps
} from "./RuntimeContextSupport";

export class RuntimeContextFactory {
  private readonly runtime: Runtime;
  private readonly deps: Required<RuntimeContextFactoryDeps>;

  constructor(runtime: Runtime, deps: RuntimeContextFactoryDeps = {}) {
    this.runtime = runtime;
    this.deps = createRuntimeContextDeps(deps);
  }

  create(nodeId: string, enqueueAssetWrite: <T>(fn: () => T | Promise<T>) => Promise<T>): RuntimeNodeContext {
    const composition = this.runtime.getProgramComposition();
    const resolvers = createRuntimeContextResolvers(this.runtime, composition);
    const nodeConfigById = composition?.flowNodeConfigById || this.runtime.getGlobal<Record<string, Record<string, unknown>>>("flowNodeConfigById", {});
    const currentNodeConfig = nodeConfigById[nodeId] || {};
    const flowId = String(currentNodeConfig.__flowId || "").trim();
    const flowDefinitionsById = composition?.flowDefinitionsById || new Map();
    const resolveFlowVariables = composition?.resolveFlowVariables;

    const context = {
      nodeId,
      global: {
        get: <T = unknown>(key: string, defaultValue?: T): T => this.runtime.getGlobal<T>(key, defaultValue),
        set: <T = unknown>(key: string, value: T): T => this.runtime.setGlobal<T>(key, value),
        has: (key: string): boolean => this.runtime.hasGlobal(key),
        delete: (key: string): boolean => this.runtime.deleteGlobal(key)
      },
      asset: createAssetApi(resolvers, enqueueAssetWrite),
      eventSys: createEventApi(resolvers, this.deps),
      db: createDbApi(resolvers)
    } as RuntimeNodeContext;

    context.flow = resolveFlowContext(
      {
        flowId,
        flowDefinitionsById,
        resolveFlowVariables
      },
      context
    );

    return context;
  }
}
