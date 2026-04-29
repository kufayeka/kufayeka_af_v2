import type { MutableRefObject } from "react";
import type { Program } from "../../types/program";
import {
  buildProgramForExport as buildProgramForExportPayload,
  buildWorkspaceProgramForSave as buildWorkspaceProgramForSavePayload,
  downloadProgramJsonFile,
  importProgramFromFile,
  saveProgramToWorkspace
} from "../../domains/program/io";

interface WorkspacePersistenceArgs {
  program: Program;
  selectedFlowId: string;
  latestActionScriptsRef: MutableRefObject<Record<string, string>>;
  loadProgramIntoEditor: (program: Program, toastMessage?: string) => void;
  setStatus: (message: string) => void;
  setTab: (tab: number) => void;
}

export function createWorkspacePersistenceHandlers({
  program,
  selectedFlowId,
  latestActionScriptsRef,
  loadProgramIntoEditor,
  setStatus,
  setTab
}: WorkspacePersistenceArgs) {
  const buildWorkspaceProgramForSave = (): Program =>
    buildWorkspaceProgramForSavePayload(program, selectedFlowId, latestActionScriptsRef.current);

  const saveProgram = async (): Promise<void> => {
    const programForSave = buildWorkspaceProgramForSave();
    try {
      const data = await saveProgramToWorkspace(programForSave);
      setStatus(`Program saved to ${data.path ?? "programs/main.af.json"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Save error: ${message}`);
    }
  };

  const buildProgramForExport = (): Program =>
    buildProgramForExportPayload(program, selectedFlowId, latestActionScriptsRef.current);

  const downloadProgramJson = (): void => {
    try {
      const programForExport = buildProgramForExport();
      const filename = downloadProgramJsonFile(programForExport, program.meta.name || "program");
      setStatus(`Downloaded ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Download error: ${message}`);
    }
  };

  const importProgramJson = async (file: File): Promise<void> => {
    try {
      const normalized = await importProgramFromFile(file);
      loadProgramIntoEditor(normalized, `Imported program from ${file.name}`);
      setTab(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Import error: ${message}`);
    }
  };

  return {
    buildProgramForExport,
    buildWorkspaceProgramForSave,
    downloadProgramJson,
    importProgramJson,
    saveProgram
  };
}
