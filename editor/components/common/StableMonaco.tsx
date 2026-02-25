import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import {
  SCRIPT_EDITOR_SETTINGS,
  buildBindingExtraLibSource,
  buildScriptEditorOptions,
  configureScriptEditorMonaco,
  type ScriptEditorProfile
} from "../../lib/scriptEditorConfig";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface StableMonacoProps {
  path: string;
  language: string;
  height: string;
  value: string;
  onChangeText: (next: string) => void;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  readOnly?: boolean;
  profile?: ScriptEditorProfile;
  bindingNames?: string[];
}

export default function StableMonaco({
  path,
  language,
  height,
  value,
  onChangeText,
  options,
  readOnly,
  profile = "script",
  bindingNames = []
}: StableMonacoProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const isFocusedRef = useRef(false);
  const bindingLibRef = useRef<{ dispose: () => void } | null>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    if (profile === "script") {
      const provider = monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: [".", "("],
        provideCompletionItems: () => ({
          suggestions: SCRIPT_EDITOR_SETTINGS.completion.runtime.map((item, index) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: item.detail,
            documentation: item.documentation,
            sortText: `00_runtime_${String(index).padStart(3, "0")}`
          }))
        })
      });
      completionProviderRef.current = provider;
    }

    editor.onDidFocusEditorText(() => {
      isFocusedRef.current = true;
    });
    editor.onDidBlurEditorText(() => {
      isFocusedRef.current = false;
    });
  };
  const beforeMount: BeforeMount = (monaco) => {
    configureScriptEditorMonaco(monaco);
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || profile !== "script") return;

    if (bindingLibRef.current) {
      bindingLibRef.current.dispose();
      bindingLibRef.current = null;
    }

    const source = buildBindingExtraLibSource(bindingNames);
    if (!source.trim()) return;

    const tsLang = (monaco.languages as unknown as { typescript?: any }).typescript;
    if (!tsLang) return;

    bindingLibRef.current = tsLang.javascriptDefaults.addExtraLib(
      source,
      `ts:kufayeka-script-bindings-${path}.d.ts`
    );
  }, [bindingNames, path, profile]);

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

  useEffect(() => {
    return () => {
      if (bindingLibRef.current) {
        bindingLibRef.current.dispose();
      }
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
      }
    };
  }, []);

  const mergedOptions = useMemo(
    () => buildScriptEditorOptions(profile, !!readOnly, options),
    [options, profile, readOnly]
  );

  return (
    <MonacoEditor
      path={path}
      height={height}
      beforeMount={beforeMount}
      theme={SCRIPT_EDITOR_SETTINGS.theme.name}
      defaultLanguage={language}
      defaultValue={value}
      onMount={onMount}
      onChange={(next) => onChangeText(next ?? "")}
      options={mergedOptions}
    />
  );
}
