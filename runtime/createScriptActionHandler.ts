import type { RuntimeNodeContext, RuntimeNodeHandler } from "./types";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

interface VariableBinding {
  name?: string;
  source?: string;
  attributePath?: string;
  staticValue?: unknown;
  allowOverride?: boolean;
}

interface ScriptTemplate {
  id: string;
  script?: string;
  variableBindings?: VariableBinding[];
}

interface ScriptAction {
  id: string;
  templateId?: string;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, Partial<VariableBinding>>;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function coerceStaticValue(type: string, value: unknown): unknown {
  if (type === "number") return Number(value || 0);
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  }
  if (type === "array") return Array.isArray(value) ? value : value == null ? [] : [value];
  if (type === "object") return value && typeof value === "object" ? value : {};
  return value == null ? "" : String(value);
}

function bindingSourceToStaticType(source: string): string {
  if (source === "static_number") return "number";
  if (source === "static_boolean") return "boolean";
  if (source === "static_array") return "array";
  if (source === "static_object") return "object";
  return "string";
}

async function resolveBindingValue(binding: VariableBinding, context: RuntimeNodeContext): Promise<unknown> {
  const source = binding?.source || "static_string";
  const path = binding?.attributePath || "";

  if (source === "asset") {
    if (!path) return null;
    const matches = context.asset.query(path).filter((item) => item.kind === "asset");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }

  if (source === "attribute") {
    if (!path) return null;
    const matches = context.asset.query(path).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }

  const staticType = bindingSourceToStaticType(source);
  return coerceStaticValue(staticType, binding?.staticValue);
}

async function buildResolvedBindings(
  action: ScriptAction,
  context: RuntimeNodeContext,
  options: { templateById?: Map<string, ScriptTemplate> } = {}
): Promise<Record<string, unknown>> {
  const templateById = options.templateById || new Map<string, ScriptTemplate>();
  const template = action.templateId ? templateById.get(action.templateId) : null;
  const bindings = Array.isArray(template?.variableBindings) ? template.variableBindings : [];
  const overrideMap =
    action.templateBindingOverrides && typeof action.templateBindingOverrides === "object"
      ? action.templateBindingOverrides
      : {};

  const resolved: Record<string, unknown> = {};
  for (const binding of bindings) {
    const key = String(binding?.name || "").trim();
    if (!key) continue;
    const overrideCandidate = overrideMap[key];
    const canOverride = binding.allowOverride === true;
    const effectiveBinding: VariableBinding =
      canOverride && overrideCandidate && typeof overrideCandidate === "object"
        ? { ...binding, ...overrideCandidate, name: key }
        : binding;
    resolved[key] = await resolveBindingValue(effectiveBinding, context);
  }
  return resolved;
}

export default function createScriptActionHandler(
  action: ScriptAction,
  options: { templateById?: Map<string, ScriptTemplate> } = {}
): RuntimeNodeHandler {
  const templateById = options.templateById || new Map<string, ScriptTemplate>();
  const template = action.templateId ? templateById.get(action.templateId) : null;
  const script = (template && template.script) || action.script || "send(msg);";
  const scriptWithBindings = `
const __bindings = bindings && typeof bindings === "object" ? bindings : {};
const global = context && context.global ? context.global : null;
const asset = context && context.asset ? context.asset : null;
const eventSys = context && context.eventSys ? context.eventSys : null;
with (__bindings) {
${script}
}
`;
  const compiled = new AsyncFunction(
    "msg",
    "send",
    "context",
    "helpers",
    "config",
    "bindings",
    scriptWithBindings
  );

  return async (msg, send, context) => {
    const helpers = {
      log: (...args: unknown[]) => console.log(`[${action.id}]`, ...args),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
      now: () => new Date().toISOString(),
    };

    const bindings = await buildResolvedBindings(action, context, options);
    const timeoutMs = Math.max(
      0,
      Number((action.config && action.config.timeoutMs) ?? process.env.RUNTIME_SCRIPT_TIMEOUT_MS ?? 0) || 0
    );
    const runPromise = Promise.resolve(
      compiled(msg, send, context, helpers, action.config || {}, bindings)
    ) as Promise<unknown>;
    if (timeoutMs > 0) {
      await withTimeout(runPromise, timeoutMs, `Script action "${action.id}" timeout after ${timeoutMs}ms`);
    } else {
      await runPromise;
    }
  };
}
