const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function coerceStaticValue(type, value) {
  if (type === "number") return Number(value || 0);
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  }
  if (type === "array") return Array.isArray(value) ? value : value == null ? [] : [value];
  if (type === "object") return value && typeof value === "object" ? value : {};
  return value == null ? "" : String(value);
}

function bindingSourceToStaticType(source) {
  if (source === "static_number") return "number";
  if (source === "static_boolean") return "boolean";
  if (source === "static_array") return "array";
  if (source === "static_object") return "object";
  return "string";
}

async function resolveBindingValue(binding, context) {
  const source = binding?.source || "static_string";

  if (source === "attribute") {
    const path = binding?.attributePath || "";
    if (!path) return null;
    const matches = context.asset.query(path).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }

  const staticType = bindingSourceToStaticType(source);
  const staticValue = binding?.staticValue;
  return coerceStaticValue(staticType, staticValue);
}

async function buildResolvedBindings(action, context, options = {}) {
  const templateById = options.templateById || new Map();
  const template = action.templateId ? templateById.get(action.templateId) : null;
  const bindings = Array.isArray(template?.variableBindings) ? template.variableBindings : [];
  const overrideMap =
    action.templateBindingOverrides && typeof action.templateBindingOverrides === "object"
      ? action.templateBindingOverrides
      : {};

  const resolved = {};
  for (const binding of bindings) {
    const key = String(binding?.name || "").trim();
    if (!key) continue;
    const overrideCandidate = overrideMap[key];
    const canOverride = binding.allowOverride === true;
    const effectiveBinding =
      canOverride && overrideCandidate && typeof overrideCandidate === "object"
        ? {
            ...binding,
            ...overrideCandidate,
            name: key
          }
        : binding;
    resolved[key] = await resolveBindingValue(effectiveBinding, context);
  }
  return resolved;
}

function createScriptActionHandler(action, options = {}) {
  const templateById = options.templateById || new Map();
  const template = action.templateId ? templateById.get(action.templateId) : null;
  const script = (template && template.script) || action.script || "send(msg);";
  const scriptWithBindings = `
const __bindings = bindings && typeof bindings === "object" ? bindings : {};
with (__bindings) {
${script}
}
`;
  const compiled = new AsyncFunction(
    "msg",
    "send",
    "context",
    "helpers",
    "config",
    "bindings",
    scriptWithBindings
  );

  return async (msg, send, context) => {
    const helpers = {
      log: (...args) => console.log(`[${action.id}]`, ...args),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: (...args) => fetch(...args),
      now: () => new Date().toISOString(),
    };

    const bindings = await buildResolvedBindings(action, context, options);
    await compiled(msg, send, context, helpers, action.config || {}, bindings);
  };
}

module.exports = createScriptActionHandler;
