import type { AssetDefinition, ValueType } from "../types";

export function normalizeValueType(rawType: unknown): ValueType {
  const t = String(rawType ?? "string");
  const types = new Set<ValueType>([
    "int8",
    "uint8",
    "int16",
    "uint16",
    "int32",
    "uint32",
    "float32",
    "float64",
    "boolean",
    "string",
    "array",
    "object"
  ]);
  if (types.has(t as ValueType)) return t as ValueType;
  if (t === "number") return "float64";
  return "string";
}

export function defaultValueForType(valueType: ValueType): unknown {
  if (
    valueType === "int8" ||
    valueType === "uint8" ||
    valueType === "int16" ||
    valueType === "uint16" ||
    valueType === "int32" ||
    valueType === "uint32" ||
    valueType === "float32" ||
    valueType === "float64"
  ) {
    return 0;
  }
  if (valueType === "boolean") return false;
  if (valueType === "array") return [];
  if (valueType === "object") return {};
  return "";
}

export function coerceAttributeValue(
  valueType: ValueType,
  value: unknown,
  options: { defaultValue?: unknown; nullable?: boolean } = {}
): unknown {
  const nullable = options.nullable === true;
  const fallback = options.defaultValue !== undefined ? options.defaultValue : defaultValueForType(valueType);
  const source = value == null ? (nullable ? null : fallback) : value;

  if (source == null) return null;

  if (
    valueType === "int8" ||
    valueType === "uint8" ||
    valueType === "int16" ||
    valueType === "uint16" ||
    valueType === "int32" ||
    valueType === "uint32"
  ) {
    const parsed = Number(source);
    if (!Number.isFinite(parsed)) return Number(fallback || 0);
    const rounded = Math.trunc(parsed);
    return valueType.startsWith("u") ? Math.max(0, rounded) : rounded;
  }

  if (valueType === "float32" || valueType === "float64") {
    const parsed = Number(source);
    return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
  }

  if (valueType === "boolean") {
    if (typeof source === "boolean") return source;
    if (typeof source === "number") return source !== 0;
    const normalized = String(source).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    return Boolean(fallback);
  }

  if (valueType === "array") {
    if (Array.isArray(source)) return source;
    return Array.isArray(fallback) ? fallback : [];
  }

  if (valueType === "object") {
    return source && typeof source === "object" && !Array.isArray(source)
      ? source
      : fallback && typeof fallback === "object" && !Array.isArray(fallback)
        ? fallback
        : {};
  }

  return String(source);
}

export function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function splitPath(pathValue: string): string[] {
  return String(pathValue || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function getAssetPath(assetId: string, assetById: Map<string, AssetDefinition>): string {
  const asset = assetById.get(assetId);
  if (!asset) return "";
  const parts = [asset.name];
  let parentId = asset.parentId;
  while (parentId) {
    const parent = assetById.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(".");
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const leftType = typeof left;
  const rightType = typeof right;
  if (leftType !== "object" || rightType !== "object" || left === null || right === null) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function valuesLooselyEqual(left: unknown, right: unknown): boolean {
  if (valuesEqual(left, right)) return true;
  if (typeof left === "object" || typeof right === "object") {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  // eslint-disable-next-line eqeqeq
  return left == right;
}

export function matches(pattern: string, value: string): boolean {
  return pattern === "*" || pattern === value;
}
