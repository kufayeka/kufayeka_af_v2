export function getErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const aggregateCode = (error as AggregateError & { code?: string }).code;
    const parts = error.errors
      .map((item) => getErrorMessage(item))
      .filter((item) => item && item !== "[object Object]");
    const prefix = aggregateCode ? `${aggregateCode}: ` : "";
    return `${prefix}${parts.join(" | ")}`.trim() || "AggregateError";
  }
  if (error instanceof Error) {
    if (error.message) {
      const code = (error as { code?: string }).code;
      return code && !error.message.includes(code) ? `${code}: ${error.message}` : error.message;
    }
    const code = (error as { code?: string }).code;
    return code || error.name || "Unknown error";
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    const code = (error as { code?: unknown }).code;
    if (typeof message === "string" && message.trim()) {
      return typeof code === "string" && !message.includes(code) ? `${code}: ${message}` : message;
    }
    if (typeof code === "string" && code.trim()) return code;
  }
  return String(error);
}

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function parseFinderExpectedValue(rawValue: string | undefined): unknown {
  if (rawValue == null) return undefined;
  const source = String(rawValue);
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

export function toJsonValueOrNull(value: unknown): unknown | null {
  if (value === undefined) return null;
  return value;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

export function containsObject(source: unknown, expected: unknown): boolean {
  if (!isPlainObject(source) || !isPlainObject(expected)) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return false;
    const srcValue = source[key];
    if (isPlainObject(value)) {
      if (!containsObject(srcValue, value)) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (!Array.isArray(srcValue)) return false;
      if (!deepEqual(srcValue, value)) return false;
      continue;
    }
    if (!deepEqual(srcValue, value)) return false;
  }
  return true;
}

export function matchAttributeValue(operator: string, actualValue: unknown, expectedValue: unknown): boolean {
  if (operator === "eq") return deepEqual(actualValue, expectedValue);
  if (operator === "neq") return !deepEqual(actualValue, expectedValue);
  if (operator === "contains") {
    if (typeof actualValue === "string") {
      return actualValue.includes(String(expectedValue ?? ""));
    }
    if (Array.isArray(actualValue)) {
      return actualValue.some((item) => deepEqual(item, expectedValue));
    }
    return false;
  }
  if (operator === "contains_object") {
    return containsObject(actualValue, expectedValue);
  }
  return false;
}
