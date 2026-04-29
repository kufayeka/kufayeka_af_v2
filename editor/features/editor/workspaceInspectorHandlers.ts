import type {
  EventNodeSummary,
  FlowDefinition,
  FlowNodeDefinition,
  ScriptNodeSummary
} from "../../types/program";
import type { EditorInspectorTarget } from "./workspaceTypes";

interface WorkspaceInspectorHandlersArgs {
  nodes: FlowNodeDefinition[];
  applyActiveFlowUpdate: (updater: (flow: FlowDefinition) => FlowDefinition) => void;
  renameAction: (oldId: string, newId: string) => void;
  renameEventAction: (oldId: string, newId: string) => void;
  updateAction: (id: string, patch: Partial<ScriptNodeSummary>) => void;
  updateEventAction: (id: string, patch: Partial<EventNodeSummary>) => void;
  setSelectedScriptTemplateId: (id: string) => void;
  setSelectedEventTemplateId: (id: string) => void;
  setInspectorTarget: (target: EditorInspectorTarget | null) => void;
  setTab: (tab: number) => void;
}

export function createWorkspaceInspectorHandlers({
  nodes,
  applyActiveFlowUpdate,
  renameAction,
  renameEventAction,
  updateAction,
  updateEventAction,
  setSelectedScriptTemplateId,
  setSelectedEventTemplateId,
  setInspectorTarget,
  setTab
}: WorkspaceInspectorHandlersArgs) {
  const handleOpenScriptTemplateManager = (templateId: string) => {
    setSelectedScriptTemplateId(templateId);
    setInspectorTarget(null);
    setTab(2);
  };

  const handleOpenEventTemplateManager = (templateId: string) => {
    setSelectedEventTemplateId(templateId);
    setInspectorTarget(null);
    setTab(3);
  };

  const handleCloseInspector = () => setInspectorTarget(null);

  const handleRenameInspectorNode = (oldId: string, newId: string) => {
    const targetNode = nodes.find((node) => node.id === oldId);
    if (!targetNode) return;
    if (targetNode.kind === "action") {
      renameAction(oldId, newId);
      return;
    }
    if (targetNode.kind === "event_open" || targetNode.kind === "event_close") {
      renameEventAction(targetNode.refId, newId);
    }
  };

  const handleUpdateInspectorNode = (id: string, patch: Partial<FlowNodeDefinition>) => {
    const targetNode = nodes.find((node) => node.id === id);
    if (!targetNode) return;

    if (targetNode.kind === "trigger") {
      const config = (patch.config || {}) as Record<string, unknown>;
      applyActiveFlowUpdate((flow) => ({
        ...flow,
        nodes: (flow.nodes || []).map((node) =>
          node.id === id && node.kind === "trigger"
            ? {
                ...node,
                label: Object.prototype.hasOwnProperty.call(patch, "label") ? String(patch.label ?? "") : node.label,
                enabled: Object.prototype.hasOwnProperty.call(patch, "enabled") ? patch.enabled !== false : node.enabled,
                config: {
                  ...(node.config || {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "intervalMs") ? { intervalMs: Math.max(1, Number(config.intervalMs) || 1) } : {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "activeFrom") ? { activeFrom: String(config.activeFrom ?? "") } : {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "activeTo") ? { activeTo: String(config.activeTo ?? "") } : {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "watchPath") ? { watchPath: String(config.watchPath ?? "") } : {}),
                  ...(Object.prototype.hasOwnProperty.call(config, "message") ? { message: config.message } : {})
                }
              }
            : node
        )
      }));
      return;
    }

    if (targetNode.kind === "action") {
      const config = (patch.config || {}) as Record<string, unknown>;
      updateAction(id, {
        ...(Object.prototype.hasOwnProperty.call(patch, "label") ? { label: patch.label } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "enabled") ? { enabled: patch.enabled } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "templateId") ? { templateId: patch.templateId } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "script") ? { script: String(config.script ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "templateBindingOverrides")
          ? { templateBindingOverrides: (config.templateBindingOverrides as Record<string, any>) || {} }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "eventTemplateId")
          ? { eventTemplateId: String(config.eventTemplateId ?? "") }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "eventTemplateOverrides")
          ? { eventTemplateOverrides: (config.eventTemplateOverrides as Record<string, any>) || {} }
          : {})
      });
      return;
    }

    if (targetNode.kind === "event_open" || targetNode.kind === "event_close") {
      const config = (patch.config || {}) as Record<string, unknown>;
      updateEventAction(targetNode.refId, {
        ...(Object.prototype.hasOwnProperty.call(patch, "label")
          ? { label: String(patch.label ?? "") }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "enabled") ? { enabled: patch.enabled } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "templateId") ? { templateId: patch.templateId } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "templateOverrides")
          ? { templateOverrides: (config.templateOverrides as Record<string, any>) || {} }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "bindings")
          ? { bindings: (config.bindings as Record<string, any>) || {} }
          : {}),
        ...(targetNode.kind === "event_open" && Object.prototype.hasOwnProperty.call(config, "openNotes")
          ? { openNotes: String(config.openNotes ?? "") }
          : {}),
        ...(targetNode.kind === "event_close" && Object.prototype.hasOwnProperty.call(config, "closeNotes")
          ? { closeNotes: String(config.closeNotes ?? "") }
          : {})
      });
    }
  };

  return {
    handleCloseInspector,
    handleOpenEventTemplateManager,
    handleOpenScriptTemplateManager,
    handleRenameInspectorNode,
    handleUpdateInspectorNode
  };
}
