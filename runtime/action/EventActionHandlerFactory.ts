import type { EventTemplateDefinition, EventActionDefinition, RuntimeMessage, RuntimeNodeHandler } from "../core/runtimeTypes";
import {
  renderTextTemplate,
  resolveBindings,
  validateResolvedBindings,
  type EventActionFactoryOptions,
  type EventRequestPayload
} from "./EventActionSupport";

type EventNodeMode = "open" | "close";

export function getEventActionOpenNodeId(id: string): string {
  return `event.open.${id}`;
}

export function getEventActionCloseNodeId(id: string): string {
  return `event.close.${id}`;
}

export function createEventActionHandler(
  action: EventActionDefinition,
  mode: EventNodeMode,
  options: EventActionFactoryOptions = {}
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
