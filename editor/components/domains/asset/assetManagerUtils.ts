import { useEffect, useState } from "react";
import type { DataNode, Key } from "rc-tree/lib/interface";
import type {
  AssetAttributeType,
  AssetDefinition,
  AssetFrameworkDefinition,
  HistorianTargetDefinition
} from "../../../types/program";

export const ATTRIBUTE_TYPES: AssetAttributeType[] = [
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
];

export const DEFAULT_HISTORIAN_TARGET: HistorianTargetDefinition = {
  id: "default",
  name: "Default Historian",
  timestampUnit: "us",
  enabled: true
};

export interface EffectiveAttributeRow {
  name: string;
  valueType: AssetAttributeType | "custom";
  unit: string;
  value: unknown;
  ts?: string;
  source: string;
  overridden: boolean;
  historianEnabled: boolean;
  numberAllowDecimal?: boolean;
  numberPrecision?: number;
}

export const TREE_BOTTOM_SPACER_KEY = "__tree-bottom-spacer__";

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

export function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseByType(type: AssetAttributeType, raw: string): unknown {
  if (
    type === "int8" ||
    type === "uint8" ||
    type === "int16" ||
    type === "uint16" ||
    type === "int32" ||
    type === "uint32"
  ) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "float32" || type === "float64") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") {
    if (raw.trim().toLowerCase() === "true") return true;
    if (raw.trim().toLowerCase() === "false") return false;
    return raw;
  }
  if (type === "string") return raw;
  return parseMaybeJson(raw);
}

export function normalizeNumberForDisplay(
  value: number,
  options: { numberAllowDecimal?: boolean; numberPrecision?: number } = {}
): number {
  if (!Number.isFinite(value)) return value;
  const allowDecimal = options.numberAllowDecimal !== false;
  const precision = Math.max(0, Math.min(10, Number(options.numberPrecision ?? 6) || 0));
  const maxDecimals = allowDecimal ? precision : 0;
  const factor = 10 ** maxDecimals;
  const rounded = Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor;
  if (Math.abs(rounded) < 1e-9) return 0;
  return rounded;
}

export function serializeValue(
  value: unknown,
  options: { numberAllowDecimal?: boolean; numberPrecision?: number } = {}
): string {
  if (typeof value === "number") {
    return String(normalizeNumberForDisplay(value, options));
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function buildChildrenMap(assets: AssetDefinition[]): Map<string | null, AssetDefinition[]> {
  const map = new Map<string | null, AssetDefinition[]>();
  for (const asset of assets) {
    const key = asset.parentId ?? null;
    const list = map.get(key) || [];
    list.push(asset);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export function getDescendantIds(assets: AssetDefinition[], parentId: string): Set<string> {
  const descendants = new Set<string>();
  const childrenMap = buildChildrenMap(assets);
  const queue = [...(childrenMap.get(parentId) || []).map((item) => item.id)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    for (const child of childrenMap.get(current) || []) {
      queue.push(child.id);
    }
  }
  return descendants;
}

export function getAssetPath(asset: AssetDefinition, byId: Map<string, AssetDefinition>): string {
  const parts = [asset.name];
  let parentId = asset.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(".");
}

export function getEffectiveAttributes(
  asset: AssetDefinition,
  templateById: Map<string, AssetFrameworkDefinition["attributeTemplates"][number]>
): EffectiveAttributeRow[] {
  const rows = new Map<string, EffectiveAttributeRow>();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      if (attr.enabled === false) continue;
      if (!rows.has(attr.name)) {
        rows.set(attr.name, {
          name: attr.name,
          valueType: attr.valueType,
          unit: attr.unit ?? "",
          value: attr.default,
          ts: undefined,
          source: template.name,
          overridden: false,
          historianEnabled: attr.historianEnabled === true,
          numberAllowDecimal: attr.numberAllowDecimal !== false,
          numberPrecision: Math.max(0, Number(attr.numberPrecision ?? 0) || 0)
        });
      }
    }
  }

  for (const [name, val] of Object.entries(asset.attributes || {})) {
    const existing = rows.get(name);
    if (existing) {
      rows.set(name, { ...existing, value: val.value, ts: val.ts, overridden: true });
    } else {
      rows.set(name, {
        name,
        valueType: "custom",
        unit: "",
        value: val.value,
        ts: val.ts,
        source: "Custom",
        overridden: true,
        historianEnabled: false,
        numberAllowDecimal: true,
        numberPrecision: 6
      });
    }
  }

  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function collectTreeKeys(nodes: DataNode[]): Key[] {
  const keys: Key[] = [];
  const walk = (items: DataNode[]) => {
    for (const item of items) {
      if (String(item.key).startsWith("asset:")) keys.push(item.key);
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}
