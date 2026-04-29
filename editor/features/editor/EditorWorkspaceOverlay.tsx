import { Alert, Snackbar } from "@mui/material";
import FlowInspectorPanel from "../../components/domains/FlowInspectorPanel";
import type { EditorWorkspaceState } from "./useEditorWorkspaceState";

interface EditorWorkspaceOverlayProps {
  state: EditorWorkspaceState;
}

export default function EditorWorkspaceOverlay({ state }: EditorWorkspaceOverlayProps) {
  const {
    activeFlowVariableNames,
    eventWatchPathOptions,
    handleCloseInspector,
    handleOpenEventTemplateManager,
    handleOpenScriptTemplateManager,
    handleRenameInspectorNode,
    handleToastClose,
    handleUpdateInspectorNode,
    inspectorTarget,
    program,
    toast,
    watchPathOptions
  } = state;

  return (
    <>
      <FlowInspectorPanel
        open={Boolean(inspectorTarget)}
        target={inspectorTarget}
        nodes={program.flows.nodes || []}
        scriptTemplates={program.scriptTemplates}
        eventTemplates={program.eventTemplates || []}
        assets={program.assets}
        watchPathOptions={watchPathOptions}
        eventWatchPathOptions={eventWatchPathOptions}
        flowVariableNames={activeFlowVariableNames}
        onOpenScriptTemplateManager={handleOpenScriptTemplateManager}
        onOpenEventTemplateManager={handleOpenEventTemplateManager}
        onClose={handleCloseInspector}
        onRenameNode={handleRenameInspectorNode}
        onUpdateNode={handleUpdateInspectorNode}
      />
      <Snackbar
        open={toast.open}
        autoHideDuration={2800}
        onClose={handleToastClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={handleToastClose}
          severity={toast.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}
