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

  if (source === "msg_path") {
    if (!path) return null;
    return getAtPath(msg, path);
  }

  return coerceStaticValue(bindingSourceToStaticType(source), binding?.staticValue);
}

async function resolveBindings(
  bindings: Record<string, EventActionBinding> | undefined,
  context: RuntimeNodeContext,
  msg: RuntimeMessage
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings || {})) {
    resolved[key] = await resolveEventBindingValue(binding, context, msg);
  }
  return resolved;
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
      send(msg);
      return;
    }

    const templateId = String(request?.templateId || action.templateId || "").trim();
    if (!templateId) throw new Error(`Event action "${action.id}" has no templateId`);
    if (!eventTemplateById.has(templateId)) {
      throw new Error(`Event action "${action.id}" references missing event template "${templateId}"`);
    }

    const resolvedBindings = await resolveBindings(action.bindings, context, msg);
    const vars = {
      ...resolvedBindings,
      ...(request?.vars && typeof request.vars === "object" ? request.vars : {})
    };
    const notesTemplate = request?.notes ?? (mode === "open" ? action.openNotes : action.closeNotes);
    const notes = String(notesTemplate || "").trim() ? renderTextTemplate(String(notesTemplate || ""), vars) : undefined;
    const overrides =
      request?.templateOverrides && typeof request.templateOverrides === "object"
        ? request.templateOverrides
        : action.templateOverrides && typeof action.templateOverrides === "object"
          ? action.templateOverrides
        : undefined;

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
          row
        }
      };
      send(next);
      return;
    }

    const result = await context.eventSys.closeTemplate(templateId, {
      vars,
      notes,
      templateOverrides: overrides
    });
    const next = {
      ...msg,
      eventAction: {
        id: action.id,
        node: getEventActionCloseNodeId(action.id),
        mode,
        templateId,
        vars,
        result
      }
    };
    send(next);
  };
}
