export interface EditorInspectorTarget {
  kind: "trigger" | "action" | "event";
  id: string;
}
