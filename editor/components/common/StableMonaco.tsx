import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { OnMount } from "@monaco-editor/react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface StableMonacoProps {
  path: string;
  language: string;
  height: string;
  value: string;
  onChangeText: (next: string) => void;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  readOnly?: boolean;
}

export default function StableMonaco({
  path,
  language,
  height,
  value,
  onChangeText,
  options,
  readOnly
}: StableMonacoProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const isFocusedRef = useRef(false);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidFocusEditorText(() => {
      isFocusedRef.current = true;
    });
    editor.onDidBlurEditorText(() => {
      isFocusedRef.current = false;
    });
  };

  // Always adopt external content when switching document path.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    const current = model?.getValue() ?? "";
    if (current !== value) {
      model?.setValue(value);
    }
  }, [path]);

  // Sync from parent only while editor is not focused to avoid cursor jump.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (isFocusedRef.current) return;
    const model = editor.getModel();
    const current = model?.getValue() ?? "";
    if (current !== value) {
      model?.setValue(value);
    }
  }, [value]);

  const mergedOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on" as const,
      fontSize: 14,
      readOnly: !!readOnly,
      ...(options || {})
    }),
    [options, readOnly]
  );

  return (
    <MonacoEditor
      path={path}
      height={height}
      defaultLanguage={language}
      defaultValue={value}
      onMount={onMount}
      onChange={(next) => onChangeText(next ?? "")}
      options={mergedOptions}
    />
  );
}
