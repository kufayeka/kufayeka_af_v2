import type * as Monaco from "monaco-editor";

export type ScriptEditorProfile = "script" | "jsonMini";
export interface ScriptRuntimeCompletion {
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
}

export const SCRIPT_EDITOR_SETTINGS = {
  theme: {
    name: "kufayeka-script-monokai",
    definition: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "75715e", fontStyle: "italic" },
        { token: "keyword", foreground: "B50E0E" },
        { token: "number", foreground: "ae81ff" },
        { token: "string", foreground: "e6db74" },
        { token: "delimiter.bracket", foreground: "f8f8f2" },
        { token: "type", foreground: "66d9ef" },
        { token: "identifier", foreground: "f8f8f2" },
      ],
      colors: {
        "editor.background": "#000000",
        "editor.foreground": "#f8f8f2",
        "editorLineNumber.foreground": "#90908a",
        "editorLineNumber.activeForeground": "#f8f8f2",
        "editorCursor.foreground": "#f8f8f0",
        "editor.selectionBackground": "#49483e",
        "editor.inactiveSelectionBackground": "#3e3d32",
        "editorIndentGuide.background1": "#3b3a32",
        "editorIndentGuide.activeBackground1": "#75715e",
        "editor.lineHighlightBackground": "#3e3d32"
      }
    } as Monaco.editor.IStandaloneThemeData
  },
  options: {
    base: {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      fontSize: 20,
      lineHeight: 22,
      letterSpacing: 0.1,
      lineNumbers: "on",
      renderLineHighlight: "all",
      renderWhitespace: "selection",
      rulers: [100],
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      wordWrap: "on",
      wrappingIndent: "indent",
      autoIndent: "advanced",
      formatOnPaste: true,
      formatOnType: true,
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true
      },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "smart",
      parameterHints: { enabled: true },
      inlayHints: { enabled: "on" },
      autoClosingBrackets: "always",
      autoClosingQuotes: "always",
      matchBrackets: "always",
      bracketPairColorization: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true
      },
      folding: true,
      fixedOverflowWidgets: true
    } as Monaco.editor.IStandaloneEditorConstructionOptions,
    script: {} as Monaco.editor.IStandaloneEditorConstructionOptions,
    jsonMini: {
      lineNumbers: "off",
      fontSize: 14,
      lineHeight: 20,
      rulers: [],
      wordWrap: "on",
      folding: false
    } as Monaco.editor.IStandaloneEditorConstructionOptions
  },
  diagnostics: {
    javascript: {
      noSemanticValidation: true,
      noSyntaxValidation: false
    },
    typescript: {
      noSemanticValidation: false,
      noSyntaxValidation: false
    },
    compilerOptions: {
      target: 99, // ESNext
      allowNonTsExtensions: true,
      checkJs: false,
      noLib: false,
      strict: false
    },
    extraLibSource: `
declare interface ScriptMessage {
  id: string;
  ts: string;
  payload?: any;
  [key: string]: any;
}

declare interface AssetQueryMatch {
  kind: "asset" | "attribute";
  path: string;
  assetId: string;
  attributeName?: string;
  value: any;
  ts?: string;
  type?: string;
  unit?: string;
  historianEnabled?: boolean;
  historianTimeSourcePath?: string;
  historianTargetId?: string;
}

declare interface ScriptContext {
  global: {
    get: (key: string, defaultValue?: any) => any;
    set: (key: string, value: any) => any;
    has: (key: string) => boolean;
    delete: (key: string) => boolean;
  };
  asset: {
    query: (path: string) => AssetQueryMatch[];
    get: (path: string, defaultValue?: any) => any;
    getAll: (path: string) => AssetQueryMatch[];
    set: (path: string, value: any) => Promise<AssetQueryMatch[]>;
    setMany: (items: Array<{ path: string; value: any }>) => Promise<Array<{ path: string; count: number; matches: AssetQueryMatch[] }>>;
    findByValue: (
      path: string,
      expectedValue: any,
      options?: { strict?: boolean }
    ) => {
      path: string;
      expectedValue: any;
      strict: boolean;
      count: number;
      assetCount: number;
      matches: AssetQueryMatch[];
      assets: Array<{ assetId: string; path: string }>;
    };
    find: (
      path: string,
      expectedValue: any,
      options?: { strict?: boolean }
    ) => {
      path: string;
      expectedValue: any;
      strict: boolean;
      count: number;
      assetCount: number;
      matches: AssetQueryMatch[];
      assets: Array<{ assetId: string; path: string }>;
    };
    hierarchy: (options?: { populateAttributes?: boolean }) => any[];
  };
  eventSys: {
    open: (
      eventPath: string,
      eventTime: string,
      context: Record<string, any>,
      notes: string,
      severity?: string,
      capturedDataOnOpen?: Record<string, any> | null
    ) => Promise<any>;
    close: (
      eventPattern: string,
      eventTime: string,
      notes: string,
      capturedDataOnClose?: Record<string, any> | null
    ) => Promise<any>;
    get: (
      pattern: string,
      from: string,
      to: string,
      status: string,
      contextFilters?: Record<string, any>,
      options?: { limit?: number }
    ) => Promise<any[]>;
    getEarliestTs: (
      pattern: string,
      from: string,
      to: string,
      status: string,
      contextFilters?: Record<string, any>,
      options?: { limit?: number }
    ) => Promise<string | null>;
    getLatestTs: (
      pattern: string,
      from: string,
      to: string,
      status: string,
      contextFilters?: Record<string, any>,
      options?: { limit?: number }
    ) => Promise<string | null>;
    getRange: (
      pattern: string,
      from: string,
      to: string,
      status: string,
      contextFilters?: Record<string, any>,
      options?: { limit?: number }
    ) => Promise<{ start_ts: string | null; end_ts: string | null; count: number }>;
  };
  db: {
    query: (sql: string, params?: any[]) => Promise<{ rows: Array<Record<string, any>>; rowCount: number }>;
    executeSafe: (sql: string) => Promise<{ rows: Array<Record<string, any>>; rowCount: number }>;
    testConnection: () => Promise<{ ok: boolean; message: string; latencyMs: number }>;
  };
}

declare interface ScriptHelpers {
  log: (...args: any[]) => void;
  sleep: (ms: number) => Promise<void>;
  fetch: typeof fetch;
  axios: {
    request: (options: any) => Promise<any>;
    get: (url: string, config?: any) => Promise<any>;
    post: (url: string, data?: any, config?: any) => Promise<any>;
    put: (url: string, data?: any, config?: any) => Promise<any>;
    patch: (url: string, data?: any, config?: any) => Promise<any>;
    delete: (url: string, config?: any) => Promise<any>;
  };
  http: (options: {
    url: string;
    method?: string;
    query?: Record<string, any>;
    params?: Record<string, any>;
    headers?: Record<string, string>;
    cookies?: Record<string, string | number | boolean>;
    body?: any;
    data?: any;
    timeoutMs?: number;
    responseType?: "json" | "text" | "arraybuffer";
  }) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    data: any;
    headers: Record<string, any>;
    request: { method: string; url: string };
  }>;
  now: () => string;
}

declare const msg: ScriptMessage;
declare const send: (msg: ScriptMessage) => void;
declare const context: ScriptContext;
declare const helpers: ScriptHelpers;
declare const config: Record<string, any>;
declare const global: ScriptContext["global"];
declare const asset: ScriptContext["asset"];
declare const eventSys: ScriptContext["eventSys"];
declare const db: ScriptContext["db"];
`
  },
  completion: {
    runtime: [
      {
        label: "helpers.log",
        insertText: "helpers.log(${1:value});",
        detail: "Log runtime message",
        documentation: "Print log from current action id scope."
      },
      {
        label: "helpers.sleep",
        insertText: "await helpers.sleep(${1:100});",
        detail: "Sleep helper",
        documentation: "Pause script execution in async function."
      },
      {
        label: "helpers.fetch",
        insertText: "const res = await helpers.fetch(${1:url});",
        detail: "Fetch helper",
        documentation: "HTTP request helper from runtime."
      },
      {
        label: "helpers.http",
        insertText:
          "const res = await helpers.http({\\n  url: ${1:\"https://api.example.com/orders\"},\\n  method: ${2:\"POST\"},\\n  query: ${3:{ line: \"A\" }},\\n  headers: ${4:{ \"x-api-key\": \"token\" }},\\n  cookies: ${5:{ session: \"abc\" }},\\n  body: ${6:{ workOrder: \"WO-1\" }}\\n});",
        detail: "HTTP helper (axios-powered)",
        documentation: "HTTP request helper with query/headers/cookies/body/timeout."
      },
      {
        label: "helpers.axios",
        insertText: "const res = await helpers.axios.get(${1:\"https://api.example.com/status\"});",
        detail: "Axios instance",
        documentation: "Direct axios client (get/post/put/patch/delete/request)."
      },
      {
        label: "helpers.now",
        insertText: "helpers.now()",
        detail: "ISO timestamp now",
        documentation: "Returns current timestamp in ISO format."
      },
      {
        label: "eventSys.open",
        insertText:
          "await eventSys.open(\\n  /* event path */ ${1:eventPath},\\n  /* event time */ ${2:timestamp},\\n  /* context */ ${3:activityContext},\\n  /* notes */ ${4:`activity ${rawActivity} created`},\\n  /* severity */ ${5:\"info\"},\\n  /* captured data */ ${6:paperConsum}\\n);",
        detail: "Open event",
        documentation: "Create new event row with guided argument labels."
      },
      {
        label: "eventSys.close",
        insertText:
          "await eventSys.close(\\n  /* event pattern */ ${1:eventPattern},\\n  /* event time */ ${2:timestamp},\\n  /* notes */ ${3:\"manual close\"},\\n  /* captured data */ ${4:{}}\\n);",
        detail: "Close event(s)",
        documentation: "Close open events by wildcard pattern."
      },
      {
        label: "eventSys.get",
        insertText: "eventSys.get(${1:pattern}, \"*\", \"*\", \"*\", ${2:{}}, ${3:{ limit: 100 }});",
        detail: "Query events",
        documentation: "Query events by path/time/status/context."
      },
      {
        label: "eventSys.getEarliestTs",
        insertText: "eventSys.getEarliestTs(${1:pattern}, \"*\", \"*\", \"*\", ${2:{}}, ${3:{ limit: 5000 }});",
        detail: "Get earliest event start timestamp",
        documentation: "Return earliest start_ts among matched events."
      },
      {
        label: "eventSys.getLatestTs",
        insertText: "eventSys.getLatestTs(${1:pattern}, \"*\", \"*\", \"*\", ${2:{}}, ${3:{ limit: 5000 }});",
        detail: "Get latest event end timestamp",
        documentation: "Return latest end_ts among matched events. If latest end_ts is empty, fallback to now."
      },
      {
        label: "eventSys.getRange",
        insertText: "eventSys.getRange(${1:pattern}, \"*\", \"*\", \"*\", ${2:{}}, ${3:{ limit: 5000 }});",
        detail: "Get event time range",
        documentation: "Return earliest start_ts and latest end_ts among matched events. If latest end_ts is empty, fallback to now."
      },
      {
        label: "db.query",
        insertText: "const r = await db.query(${1:\"SELECT * FROM public.af_event WHERE status = $1 LIMIT $2\"}, [${2:\"open\"}, ${3:100}]);",
        detail: "Run parameterized SQL",
        documentation: "Execute SQL with bind params against runtime DB connection."
      },
      {
        label: "db.executeSafe",
        insertText: "const r = await db.executeSafe(${1:\"SELECT NOW() AS ts\"});",
        detail: "Run safe SQL (restricted)",
        documentation: "Execute SQL using safe tester guard (blocks destructive DDL)."
      },
      {
        label: "db.testConnection",
        insertText: "const dbHealth = await db.testConnection();",
        detail: "Test DB connection",
        documentation: "Returns {ok,message,latencyMs}."
      },
      {
        label: "asset.get",
        insertText: "asset.get(${1:path}, ${2:0})",
        detail: "Get one attribute value",
        documentation: "Alias of context.asset.get(...)"
      },
      {
        label: "asset.query",
        insertText: "asset.query(${1:path})",
        detail: "Query asset/attribute",
        documentation: "Alias of context.asset.query(...)"
      },
      {
        label: "asset.set",
        insertText: "await asset.set(${1:path}, ${2:value});",
        detail: "Set one attribute",
        documentation: "Alias of context.asset.set(...)"
      },
      {
        label: "asset.setMany",
        insertText: "await asset.setMany([\\n  { path: ${1:\"A.B.C\"}, value: ${2:1} }\\n]);",
        detail: "Set many attributes",
        documentation: "Alias of context.asset.setMany(...)"
      },
      {
        label: "asset.hierarchy",
        insertText: "asset.hierarchy({ populateAttributes: true })",
        detail: "Get asset hierarchy",
        documentation: "Alias of context.asset.hierarchy(...)"
      },
      {
        label: "asset.findByValue",
        insertText: "asset.findByValue(${1:\"*.MachineSpeed\"}, ${2:10}, { strict: false })",
        detail: "Find assets by attribute value",
        documentation: "Return assets and matches for attributes with matching value."
      },
      {
        label: "asset.find",
        insertText: "asset.find(${1:\"*.MachineSpeed\"}, ${2:10}, { strict: false })",
        detail: "Find assets by attribute value",
        documentation: "Alias of asset.findByValue(...)."
      },
      {
        label: "global.get",
        insertText: "global.get(${1:key}, ${2:null})",
        detail: "Read runtime global",
        documentation: "Alias of context.global.get(...)"
      },
      {
        label: "global.set",
        insertText: "global.set(${1:key}, ${2:value});",
        detail: "Write runtime global",
        documentation: "Alias of context.global.set(...)"
      },
      {
        label: "global.has",
        insertText: "global.has(${1:key})",
        detail: "Check runtime global",
        documentation: "Alias of context.global.has(...)"
      },
      {
        label: "global.delete",
        insertText: "global.delete(${1:key})",
        detail: "Delete runtime global",
        documentation: "Alias of context.global.delete(...)"
      },
      {
        label: "context.asset.get",
        insertText: "context.asset.get(${1:path}, ${2:0})",
        detail: "Get one attribute value",
        documentation: "Return attribute value (single/default/array)."
      },
      {
        label: "context.asset.query",
        insertText: "context.asset.query(${1:path})",
        detail: "Query asset/attribute",
        documentation: "Return query matches for wildcard path."
      },
      {
        label: "context.asset.set",
        insertText: "await context.asset.set(${1:path}, ${2:value});",
        detail: "Set one attribute",
        documentation: "Set attribute value by path."
      },
      {
        label: "context.asset.setMany",
        insertText: "await context.asset.setMany([\\n  { path: ${1:\"A.B.C\"}, value: ${2:1} }\\n]);",
        detail: "Set many attributes",
        documentation: "Bulk write attribute values."
      },
      {
        label: "context.asset.hierarchy",
        insertText: "context.asset.hierarchy({ populateAttributes: true })",
        detail: "Get asset hierarchy",
        documentation: "Returns tree hierarchy from asset storage."
      },
      {
        label: "context.asset.findByValue",
        insertText: "context.asset.findByValue(${1:\"*.MachineSpeed\"}, ${2:10}, { strict: false })",
        detail: "Find assets by attribute value",
        documentation: "Return assets and matches for attributes with matching value."
      },
      {
        label: "context.asset.find",
        insertText: "context.asset.find(${1:\"*.MachineSpeed\"}, ${2:10}, { strict: false })",
        detail: "Find assets by attribute value",
        documentation: "Alias of context.asset.findByValue(...)."
      },
      {
        label: "send",
        insertText: "send(msg);",
        detail: "Emit message to next node",
        documentation: "Forward message to downstream action."
      },
      {
        label: "msg.payload",
        insertText: "msg.payload",
        detail: "Message payload",
        documentation: "Current message payload value."
      }
    ] as ScriptRuntimeCompletion[]
  }
} as const;

let isConfigured = false;

export function configureScriptEditorMonaco(monaco: typeof Monaco): void {
  if (isConfigured) return;
  isConfigured = true;

  monaco.editor.defineTheme(
    SCRIPT_EDITOR_SETTINGS.theme.name,
    SCRIPT_EDITOR_SETTINGS.theme.definition
  );

  const tsLang = (monaco.languages as unknown as { typescript?: any }).typescript;
  if (!tsLang) return;

  tsLang.javascriptDefaults.setDiagnosticsOptions(
    SCRIPT_EDITOR_SETTINGS.diagnostics.javascript
  );
  tsLang.typescriptDefaults.setDiagnosticsOptions(
    SCRIPT_EDITOR_SETTINGS.diagnostics.typescript
  );

  const compilerOptions = {
    ...SCRIPT_EDITOR_SETTINGS.diagnostics.compilerOptions,
    target: tsLang.ScriptTarget?.ESNext ?? SCRIPT_EDITOR_SETTINGS.diagnostics.compilerOptions.target
  };
  tsLang.javascriptDefaults.setCompilerOptions(compilerOptions);
  tsLang.typescriptDefaults.setCompilerOptions(compilerOptions);
  tsLang.javascriptDefaults.setInlayHintsOptions?.({
    includeInlayParameterNameHints: "all",
    includeInlayParameterNameHintsWhenArgumentMatchesName: false
  });
  tsLang.typescriptDefaults.setInlayHintsOptions?.({
    includeInlayParameterNameHints: "all",
    includeInlayParameterNameHintsWhenArgumentMatchesName: false
  });

  tsLang.javascriptDefaults.addExtraLib(
    SCRIPT_EDITOR_SETTINGS.diagnostics.extraLibSource,
    "ts:kufayeka-script-editor-globals.d.ts"
  );
}

export function buildScriptEditorOptions(
  profile: ScriptEditorProfile,
  readOnly: boolean,
  overrides?: Monaco.editor.IStandaloneEditorConstructionOptions
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    ...SCRIPT_EDITOR_SETTINGS.options.base,
    ...SCRIPT_EDITOR_SETTINGS.options[profile],
    readOnly,
    ...(overrides || {})
  };
}

export function buildBindingExtraLibSource(bindingNames: string[]): string {
  const rows = bindingNames
    .map((name) => String(name || "").trim())
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
    .map((name) => `declare const ${name}: any;`);
  return rows.join("\n");
}
