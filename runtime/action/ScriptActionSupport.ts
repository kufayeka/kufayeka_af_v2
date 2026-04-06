import axios from "axios";
import type { RuntimeNodeContext } from "../core/runtimeTypes";

export interface VariableBinding {
  name?: string;
  source?: string;
  attributePath?: string;
  staticValue?: unknown;
  allowOverride?: boolean;
}

export interface ScriptTemplate {
  id: string;
  script?: string;
  variableBindings?: VariableBinding[];
}

export interface FlowDefinition {
  id: string;
  name?: string;
  variables?: VariableBinding[];
}

export interface ScriptAction {
  id: string;
  templateId?: string;
  eventTemplateId?: string;
  eventTemplateOverrides?: Record<string, unknown>;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, Partial<VariableBinding>>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type HttpHeaders = Record<string, string>;
export type HttpCookies = Record<string, string | number | boolean>;
export type HttpParams = Record<string, string | number | boolean | null | undefined>;
export type HttpBody = unknown;

export interface HttpRequestOptions {
  url: string;
  method?: HttpMethod | string;
  params?: HttpParams;
  query?: HttpParams;
  headers?: HttpHeaders;
  cookies?: HttpCookies;
  body?: HttpBody;
  data?: HttpBody;
  timeoutMs?: number;
  responseType?: "json" | "text" | "arraybuffer";
}

export interface ScriptActionRuntimeDeps {
  axiosInstance?: typeof axios;
  fetchImpl?: typeof fetch;
  now?: () => string;
  log?: (actionId: string, ...args: unknown[]) => void;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  createAsyncFunction?: (...args: string[]) => (...runtimeArgs: unknown[]) => Promise<unknown>;
}

const DefaultAsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export function createScriptActionRuntimeDeps(deps: ScriptActionRuntimeDeps = {}): Required<ScriptActionRuntimeDeps> {
  return {
    axiosInstance: deps.axiosInstance || axios,
    fetchImpl: deps.fetchImpl || fetch,
    now: deps.now || (() => new Date().toISOString()),
    log: deps.log || ((actionId: string, ...args: unknown[]) => console.log(`[${actionId}]`, ...args)),
    setTimeoutImpl: deps.setTimeoutImpl || setTimeout,
    clearTimeoutImpl: deps.clearTimeoutImpl || clearTimeout,
    createAsyncFunction: deps.createAsyncFunction || ((...args: string[]) => new DefaultAsyncFunction(...args))
  };
}

export function buildCookieHeader(cookies: HttpCookies | undefined): string {
  if (!cookies || typeof cookies !== "object") return "";
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(cookies)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.join("; ");
}

export async function httpRequest(
  rawOptions: HttpRequestOptions,
  deps: Pick<Required<ScriptActionRuntimeDeps>, "axiosInstance">
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, unknown>;
  request: { method: string; url: string };
}> {
  const options = rawOptions && typeof rawOptions === "object" ? rawOptions : ({} as HttpRequestOptions);
  const url = String(options.url || "").trim();
  if (!url) throw new Error("helpers.http: url is required");

  const method = String(options.method || "GET").toUpperCase();
  const headers: Record<string, string> = { ...(options.headers || {}) };
  const cookieHeader = buildCookieHeader(options.cookies);
  if (cookieHeader) {
    headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${cookieHeader}` : cookieHeader;
  }

  const timeout = Math.max(0, Number(options.timeoutMs || 0)) || undefined;
  const res = await deps.axiosInstance.request({
    url,
    method,
    params: options.query || options.params,
    headers,
    data: Object.prototype.hasOwnProperty.call(options, "body") ? options.body : options.data,
    timeout,
    responseType: options.responseType || "json",
    withCredentials: true,
    validateStatus: () => true
  });

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: res.statusText,
    data: res.data,
    headers: (res.headers || {}) as Record<string, unknown>,
    request: { method, url }
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  deps: Pick<Required<ScriptActionRuntimeDeps>, "setTimeoutImpl" | "clearTimeoutImpl">
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = deps.setTimeoutImpl(() => reject(new Error(timeoutMessage)), timeoutMs) as NodeJS.Timeout;
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) deps.clearTimeoutImpl(timer);
  }
}

export function coerceStaticValue(type: string, value: unknown): unknown {
  if (type === "number") return Number(value || 0);
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  }
  if (type === "array") return Array.isArray(value) ? value : value == null ? [] : [value];
  if (type === "object") return value && typeof value === "object" ? value : {};
  return value == null ? "" : String(value);
}

export function bindingSourceToStaticType(source: string): string {
  if (source === "static_number") return "number";
  if (source === "static_boolean") return "boolean";
  if (source === "static_array") return "array";
  if (source === "static_object") return "object";
  return "string";
}

export async function resolveBindingValue(binding: VariableBinding, context: RuntimeNodeContext): Promise<unknown> {
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

export async function resolveFlowVariableMap(
  flowId: string,
  context: RuntimeNodeContext,
  options: { flowById?: Map<string, FlowDefinition> } = {}
): Promise<Record<string, unknown>> {
  const flow = flowId ? options.flowById?.get(flowId) : null;
  if (!flow || !Array.isArray(flow.variables)) return {};
  const resolved: Record<string, unknown> = {};
  for (const variable of flow.variables) {
    const key = String(variable?.name || "").trim();
    if (!key) continue;
    resolved[key] = await resolveBindingValue(variable, context);
  }
  return resolved;
}

export async function buildResolvedBindings(
  action: ScriptAction,
  context: RuntimeNodeContext,
  options: { templateById?: Map<string, ScriptTemplate>; flowById?: Map<string, FlowDefinition> } = {}
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
    if (effectiveBinding.source === "flow_variable") {
      const currentFlowId = String((action.config && action.config.__flowId) || "").trim();
      const flowVars = await resolveFlowVariableMap(currentFlowId, context, options);
      resolved[key] = flowVars[String(effectiveBinding.attributePath || "").trim()] ?? null;
    } else {
      resolved[key] = await resolveBindingValue(effectiveBinding, context);
    }
  }
  return resolved;
}

export function prepareScriptSource(rawScript: string): string {
  return rawScript
    .replace(/(?<!\bawait\s)eventSys\.(openTemplateFromAction|closeTemplateFromAction|openTemplate|closeTemplate|open|close|get|getEarliestTs|getLatestTs|getRange)\s*\(/g, "await eventSys.$1(")
    .replace(/(?<!\bawait\s)asset\.(set|setMany)\s*\(/g, "await asset.$1(")
    .replace(/(?<!\bawait\s)db\.(query|executeSafe|testConnection)\s*\(/g, "await db.$1(")
    .replace(/(?<!\bawait\s)helpers\.http\s*\(/g, "await helpers.http(");
}

export function buildScriptSource(script: string): string {
  return `
const __bindings = bindings && typeof bindings === "object" ? bindings : {};
const flow = __flow && typeof __flow === "object" ? __flow : { id: "", name: "", variables: {} };
const flowVars = flow && flow.variables && typeof flow.variables === "object" ? flow.variables : {};
const global = context && context.global ? context.global : null;
const asset = context && context.asset ? context.asset : null;
const __eventSysRaw = context && context.eventSys ? context.eventSys : null;
const db = context && context.db ? context.db : null;
const action = context && context.action ? context.action : null;
const __actionEventTemplateId = config && typeof config.__eventTemplateId === "string" ? config.__eventTemplateId : "";
const __actionEventTemplateOverrides = config && config.__eventTemplateOverrides && typeof config.__eventTemplateOverrides === "object"
  ? config.__eventTemplateOverrides
  : undefined;
const eventSys = __eventSysRaw
  ? {
      ...__eventSysRaw,
      openTemplateFromAction: async (options = {}) => {
        if (!__actionEventTemplateId) throw new Error("eventTemplateId is not configured on this action");
        const src = options && typeof options === "object" ? options : {};
        return await __eventSysRaw.openTemplate(__actionEventTemplateId, {
          ...src,
          templateOverrides:
            src.templateOverrides && typeof src.templateOverrides === "object"
              ? { ...__actionEventTemplateOverrides, ...src.templateOverrides }
              : __actionEventTemplateOverrides
        });
      },
      closeTemplateFromAction: async (options = {}) => {
        if (!__actionEventTemplateId) throw new Error("eventTemplateId is not configured on this action");
        const src = options && typeof options === "object" ? options : {};
        return await __eventSysRaw.closeTemplate(__actionEventTemplateId, {
          ...src,
          templateOverrides:
            src.templateOverrides && typeof src.templateOverrides === "object"
              ? { ...__actionEventTemplateOverrides, ...src.templateOverrides }
              : __actionEventTemplateOverrides
        });
      }
    }
  : null;
with (flowVars) {
with (__bindings) {
${script}
}
}
`;
}
