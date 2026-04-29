import EditorWorkspaceView from "./EditorWorkspaceView";
import { useEditorWorkspaceState } from "./useEditorWorkspaceState";

export default function EditorWorkspace() {
  const state = useEditorWorkspaceState();

  return <EditorWorkspaceView state={state} />;
}
