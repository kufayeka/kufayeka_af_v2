import type { EventActionBinding, EventTemplateDefinition, RuntimeMessage, RuntimeNodeContext } from "../core/runtimeTypes";

export interface EventRequestPayload {
  mode?: string;
  vars?: Record<string, unknown>;
  notes?: string;
  templateId?: string;
  templateOverrides?: Record<string, unknown>;
}

export interface EventActionFactoryOptions {
  eventTemplateById?: Map<string, EventTemplateDefinition>;
}

export function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function getAtPath(source: unknown, path: string): unknown {
  const parts = String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

export async function resolveEventBindingValue(
  binding: EventActionBinding,
  context: RuntimeNodeContext,
  msg: RuntimeMessage
): Promise<unknown> {
  const source = binding?.source || "static_string";
  const path = String(binding?.attributePath || "").trim();

  if (source === "asset") {
    return path || null;
  }

  if (source === "attribute") {
    if (!path) return null;
    return context.asset.get(path, null);
  }

  if (source === "flow_variable") {
    if (!path) return null;
    return context.flow?.variables?.[path] ?? null;
  }

  if (source === "msg_path") {
    if (!path) return null;
    return getAtPath(msg, path);
  }

  return coerceStaticValue(bindingSourceToStaticType(source), binding?.staticValue);
}

export async function resolveBindings(
  template: EventTemplateDefinition,
  bindings: Record<string, EventActionBinding> | undefined,
  context: RuntimeNodeContext,
  msg: RuntimeMessage
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  const requiredBindings = Array.isArray(template.bindings) ? template.bindings : [];
  for (const item of requiredBindings) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    const explicitBinding = bindings?.[name];
    const fallbackBinding: EventActionBinding | undefined = explicitBinding
      ? undefined
      : item.source.startsWith("static_")
        ? { source: item.source, staticValue: item.defaultValue }
        : undefined;
    const effectiveBinding = explicitBinding || fallbackBinding;
    resolved[name] = effectiveBinding
      ? await resolveEventBindingValue(effectiveBinding, context, msg)
      : item.defaultValue;
  }
  for (const [key, binding] of Object.entries(bindings || {})) {
    if (Object.prototype.hasOwnProperty.call(resolved, key)) continue;
    resolved[key] = await resolveEventBindingValue(binding, context, msg);
  }
  return resolved;
}

export function hasResolvedBindingValue(source: string, value: unknown, resolved: Record<string, unknown>): boolean {
  if (hasValue(value)) return true;
  if (source !== "asset") return false;
  return hasValue(resolved.asset) || hasValue(resolved.assetPath);
}

export function validateResolvedBindings(
  actionId: string,
  template: EventTemplateDefinition,
  resolved: Record<string, unknown>
): void {
  const missing: string[] = [];
  for (const item of template.bindings || []) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    if (hasResolvedBindingValue(item.source, resolved[name], resolved)) continue;
    missing.push(name);
  }
  if (missing.length === 0) return;
  throw new Error(
    `Event action "${actionId}" is missing required binding value(s) for template "${template.id}": ${missing.join(", ")}`
  );
}

export function renderTextTemplate(template: string, vars: Record<string, unknown>): string {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}
