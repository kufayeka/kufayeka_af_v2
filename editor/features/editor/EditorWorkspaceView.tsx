import { Box } from "@mui/material";
import ProgramHeader from "../../components/domains/ProgramHeader";
import EditorWorkspaceContent from "./EditorWorkspaceContent";
import EditorWorkspaceOverlay from "./EditorWorkspaceOverlay";
import type { EditorWorkspaceState } from "./useEditorWorkspaceState";

interface EditorWorkspaceViewProps {
  state: EditorWorkspaceState;
}

export default function EditorWorkspaceView({ state }: EditorWorkspaceViewProps) {
  const {
    canRedo,
    canUndo,
    downloadProgramJson,
    handleOpenImport,
    handleProgramNameChange,
    handleRedo,
    handleUndo,
    importInputRef,
    importProgramJson,
    program,
    saveProgram,
    setTab,
    tab,
  } = state;

  return (
    <Box sx={{ minHeight: "100vh", background: "linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%)" }}>
      <ProgramHeader
        programName={program.meta.name}
        tab={tab}
        canUndo={canUndo}
        canRedo={canRedo}
        importInputRef={importInputRef}
        onProgramNameChange={handleProgramNameChange}
        onTabChange={setTab}
        onImportFile={importProgramJson}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={saveProgram}
        onOpenImport={handleOpenImport}
        onExport={downloadProgramJson}
      />
      <EditorWorkspaceContent state={state} />
      <EditorWorkspaceOverlay state={state} />
    </Box>
  );
}
