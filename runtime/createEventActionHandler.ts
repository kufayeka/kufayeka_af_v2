import type {
  EventActionBinding,
  EventActionDefinition,
  EventTemplateDefinition,
  RuntimeMessage,
  RuntimeNodeContext,
  RuntimeNodeHandler
} from "./types";

type EventNodeMode = "open" | "close";

interface EventRequestPayload {
  mode?: string;
  vars?: Record<string, unknown>;
  notes?: string;
  templateId?: string;
  templateOverrides?: Record<string, unknown>;
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function getAtPath(source: unknown, path: string): unknown {
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

async function resolveEventBindingValue(
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

async function resolveBindings(
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

function validateResolvedBindings(
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

function hasResolvedBindingValue(
  source: string,
  value: unknown,
  resolved: Record<string, unknown>
): boolean {
  if (hasValue(value)) return true;
  if (source !== "asset") return false;
  return hasValue(resolved.asset) || hasValue(resolved.assetPath);
}

function renderTextTemplate(template: string, vars: Record<string, unknown>): string {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function getEventActionOpenNodeId(id: string): string {
  return `event.open.${id}`;
}

export function getEventActionCloseNodeId(id: string): string {
  return `event.close.${id}`;
}

export default function createEventActionHandler(
  action: EventActionDefinition,
  mode: EventNodeMode,
  options: { eventTemplateById?: Map<string, EventTemplateDefinition> } = {}
): RuntimeNodeHandler {
  const eventTemplateById = options.eventTemplateById || new Map<string, EventTemplateDefinition>();

  return async (msg, send, context) => {
    const request =
      msg && typeof msg === "object" && msg.eventRequest && typeof msg.eventRequest === "object"
        ? (msg.eventRequest as EventRequestPayload)
        : undefined;
    if (request?.mode && request.mode !== mode) {
      return;
    }

    const templateId = String(request?.templateId || action.templateId || "").trim();
    if (!templateId) throw new Error(`Event action "${action.id}" has no templateId`);
    if (!eventTemplateById.has(templateId)) {
      throw new Error(`Event action "${action.id}" references missing event template "${templateId}"`);
    }

    const template = eventTemplateById.get(templateId) as EventTemplateDefinition;
    const resolvedBindings = await resolveBindings(template, action.bindings, context, msg);
    const vars = {
      ...resolvedBindings,
      ...(request?.vars && typeof request.vars === "object" ? request.vars : {})
    };
    validateResolvedBindings(action.id, template, vars);
    const notesTemplate = request?.notes ?? (mode === "open" ? action.openNotes : action.closeNotes);
    const notes = String(notesTemplate || "").trim() ? renderTextTemplate(String(notesTemplate || ""), vars) : undefined;
    const overrides =
      request?.templateOverrides && typeof request.templateOverrides === "object"
        ? request.templateOverrides
        : action.templateOverrides && typeof action.templateOverrides === "object"
          ? action.templateOverrides
        : undefined;

    try {
      if (mode === "open") {
        const row = await context.eventSys.openTemplate(templateId, {
          vars,
          notes,
          templateOverrides: overrides
        });
        const next = {
          ...msg,
          eventAction: {
            id: action.id,
            node: getEventActionOpenNodeId(action.id),
            mode,
            templateId,
            vars,
            success: true,
            row
          }
        };
        send(next as RuntimeMessage, "onSuccess");
        return;
      }

      const result = await context.eventSys.closeTemplate(templateId, {
        vars,
        notes,
        templateOverrides: overrides
      });
      const success = Number(result?.closedCount || 0) > 0;
      const next = {
        ...msg,
        eventAction: {
          id: action.id,
          node: getEventActionCloseNodeId(action.id),
          mode,
          templateId,
          vars,
          success,
          result
        }
      };
      if (success) {
        send(next as RuntimeMessage, "onSuccess");
        return;
      }
      send(
        {
          ...next,
          eventAction: {
            ...next.eventAction,
            error: {
              message: `Event action "${action.id}" close matched no open event`
            }
          }
        } as RuntimeMessage,
        "onFail"
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(
        {
          ...msg,
          eventAction: {
            id: action.id,
            node: mode === "open" ? getEventActionOpenNodeId(action.id) : getEventActionCloseNodeId(action.id),
            mode,
            templateId,
            vars,
            success: false,
            error: {
              message
            }
          }
        } as RuntimeMessage,
        "onFail"
      );
    }
  };
}
