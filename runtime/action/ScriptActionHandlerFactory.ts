import type { RuntimeNodeHandler } from "../core/runtimeTypes";
import {
  buildResolvedBindings,
  buildScriptSource,
  createScriptActionRuntimeDeps,
  httpRequest,
  prepareScriptSource,
  resolveFlowVariableMap,
  type FlowDefinition,
  type HttpRequestOptions,
  type ScriptAction,
  type ScriptActionRuntimeDeps,
  type ScriptTemplate,
  withTimeout
} from "./ScriptActionSupport";

export function createScriptActionHandler(
  action: ScriptAction,
  options: {
    templateById?: Map<string, ScriptTemplate>;
    flowById?: Map<string, FlowDefinition>;
    runtimeDeps?: ScriptActionRuntimeDeps;
  } = {}
): RuntimeNodeHandler {
  const runtimeDeps = createScriptActionRuntimeDeps(options.runtimeDeps);
  const templateById = options.templateById || new Map<string, ScriptTemplate>();
  const template = action.templateId ? templateById.get(action.templateId) : null;
  const rawScript = (template && template.script) || action.script || "send(msg);";
  const script = prepareScriptSource(rawScript);
  const compiled = runtimeDeps.createAsyncFunction(
    "msg",
    "send",
    "context",
    "helpers",
    "config",
    "bindings",
    "__flow",
    buildScriptSource(script)
  );

  return async (msg, send, context) => {
    const helpers = {
      log: (...args: unknown[]) => runtimeDeps.log(action.id, ...args),
      sleep: (ms: number) => new Promise((resolve) => runtimeDeps.setTimeoutImpl(resolve, ms)),
      fetch: (...args: Parameters<typeof fetch>) => runtimeDeps.fetchImpl(...args),
      axios: runtimeDeps.axiosInstance,
      http: async (requestOptions: HttpRequestOptions) => await httpRequest(requestOptions, runtimeDeps),
      now: runtimeDeps.now
    };

    const flowId = String((action.config && action.config.__flowId) || "").trim();
    const flowVars = await resolveFlowVariableMap(flowId, context, options);
    const bindings = await buildResolvedBindings(action, context, options);
    const timeoutMs = Math.max(
      0,
      Number((action.config && action.config.timeoutMs) ?? process.env.RUNTIME_SCRIPT_TIMEOUT_MS ?? 0) || 0
    );
    const runPromise = Promise.resolve(
      compiled(
        msg,
        send,
        context,
        helpers,
        {
          ...(action.config || {}),
          __eventTemplateId: action.eventTemplateId || "",
          __eventTemplateOverrides:
            action.eventTemplateOverrides && typeof action.eventTemplateOverrides === "object"
              ? action.eventTemplateOverrides
              : undefined
        },
        bindings,
        {
          id: flowId,
          name: String(context.flow?.name || flowId),
          variables: flowVars
        }
      )
    ) as Promise<unknown>;

    if (timeoutMs > 0) {
      await withTimeout(runPromise, timeoutMs, `Script action "${action.id}" timeout after ${timeoutMs}ms`, runtimeDeps);
      return;
    }

    await runPromise;
  };
}
