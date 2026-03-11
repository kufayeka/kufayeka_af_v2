import type { RuntimeNodeContext, RuntimeNodeHandler } from "./types";
import axios from "axios";

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
  eventTemplateId?: string;
  eventTemplateOverrides?: Record<string, unknown>;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, Partial<VariableBinding>>;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type HttpHeaders = Record<string, string>;
type HttpCookies = Record<string, string | number | boolean>;
type HttpParams = Record<string, string | number | boolean | null | undefined>;
type HttpBody = unknown;

interface HttpRequestOptions {
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

function buildCookieHeader(cookies: HttpCookies | undefined): string {
  if (!cookies || typeof cookies !== "object") return "";
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(cookies)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.join("; ");
}

async function httpRequest(rawOptions: HttpRequestOptions): Promise<{
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
  const res = await axios.request({
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
  const rawScript = (template && template.script) || action.script || "send(msg);";
  const script = rawScript
    .replace(/(?<!\bawait\s)eventSys\.(openTemplateFromAction|closeTemplateFromAction|openTemplate|closeTemplate|open|close|get|getEarliestTs|getLatestTs|getRange)\s*\(/g, "await eventSys.$1(")
    .replace(/(?<!\bawait\s)asset\.(set|setMany)\s*\(/g, "await asset.$1(")
    .replace(/(?<!\bawait\s)db\.(query|executeSafe|testConnection)\s*\(/g, "await db.$1(")
    .replace(/(?<!\bawait\s)helpers\.http\s*\(/g, "await helpers.http(");
const scriptWithBindings = `
const __bindings = bindings && typeof bindings === "object" ? bindings : {};
const global = context && context.global ? context.global : null;
const asset = context && context.asset ? context.asset : null;
const __eventSysRaw = context && context.eventSys ? context.eventSys : null;
const db = context && context.db ? context.db : null;
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
      axios,
      http: async (options: HttpRequestOptions) => await httpRequest(options),
      now: () => new Date().toISOString(),
    };

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
          __eventTemplateOverrides: action.eventTemplateOverrides && typeof action.eventTemplateOverrides === "object"
            ? action.eventTemplateOverrides
            : undefined
        },
        bindings
      )
    ) as Promise<unknown>;
    if (timeoutMs > 0) {
      await withTimeout(runPromise, timeoutMs, `Script action "${action.id}" timeout after ${timeoutMs}ms`);
    } else {
      await runPromise;
    }
  };
}
