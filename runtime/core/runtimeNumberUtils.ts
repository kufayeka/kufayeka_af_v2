const DEFAULT_MAX_DECIMALS = 6;
const DEFAULT_EPSILON = 1e-9;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeRuntimeNumber(
  value: number,
  options: { maxDecimals?: number; epsilon?: number } = {}
): number {
  if (!Number.isFinite(value)) return value;
  const maxDecimals = Math.max(0, Math.min(12, Number(options.maxDecimals ?? DEFAULT_MAX_DECIMALS)));
  const epsilon = Math.max(0, Number(options.epsilon ?? DEFAULT_EPSILON));

  if (Math.abs(value) < epsilon) return 0;

  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) < epsilon) return nearestInteger;

  const factor = 10 ** maxDecimals;
  const rounded = Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor;
  if (Math.abs(rounded) < epsilon) return 0;
  return rounded;
}

export function normalizeRuntimeValue<T>(value: T, options: { maxDecimals?: number; epsilon?: number } = {}): T {
  if (typeof value === "number") {
    return normalizeRuntimeNumber(value, options) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeRuntimeValue(item, options)) as T;
  }

  if (isPlainObject(value)) {
    const normalizedEntries = Object.entries(value).map(([key, itemValue]) => [
      key,
      normalizeRuntimeValue(itemValue, options)
    ]);
    return Object.fromEntries(normalizedEntries) as T;
  }

  return value;
}

export function formatRuntimeNumber(value: number, options: { maxDecimals?: number; epsilon?: number } = {}): string {
  const normalized = normalizeRuntimeNumber(value, options);
  if (!Number.isFinite(normalized)) return String(normalized);
  return String(normalized);
}

export function formatRuntimeDisplayText(
  text: string,
  options: { maxDecimals?: number; epsilon?: number } = {}
): string {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return "";
  return normalizedText.replace(/(?<![\w.])[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?(?![\w.])/gi, (token) => {
    const parsed = Number(token);
    if (!Number.isFinite(parsed)) return token;
    return formatRuntimeNumber(parsed, options);
  });
}
