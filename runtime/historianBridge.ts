import dgram from "node:dgram";
import type { AssetStore, AttributeQueryMatch, HistorianTarget } from "./types";

const TYPE_CODE = {
  int8: 1,
  uint8: 2,
  int16: 3,
  uint16: 4,
  int32: 5,
  uint32: 6,
  float32: 7,
  float64: 8,
  string: 9,
} as const;

type TypeCode = (typeof TYPE_CODE)[keyof typeof TYPE_CODE];

interface HistorianBridgePoint {
  tagId: number;
  tsEpoch: number;
  typeCode: TypeCode;
  value: number | string;
}

interface HistorianBridgeTargetState {
  id: string;
  name: string;
  host: string;
  port: number;
  unit: "us" | "ns";
  enabled: boolean;
  socket: dgram.Socket;
  queue: HistorianBridgePoint[];
  sentPoints: number;
  droppedPoints: number;
  sendErrors: number;
  invalidTimestampFallbacks: number;
}

interface HistorianBridgeOptions {
  enabled?: boolean;
  host?: string;
  port?: number;
  timestampUnit?: string;
  flushIntervalMs?: number;
  maxQueue?: number;
  targets?: unknown[];
}

export function fnv1a32(input: unknown): number {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function makeTagKey(assetId: string, attributeName: string): string {
  return `${assetId}:${attributeName}`;
}

export function computeTagID(assetId: string, attributeName: string): number {
  return fnv1a32(makeTagKey(assetId, attributeName));
}

function parseTimestamp(raw: unknown, unit: "us" | "ns"): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return normalizeEpoch(raw, unit);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asInt)) return normalizeEpoch(asInt, unit);
    const epochMs = Date.parse(trimmed);
    if (!Number.isNaN(epochMs)) return unit === "ns" ? epochMs * 1_000_000 : epochMs * 1_000;
  }
  return null;
}

function epochToMs(ts: number, unit: "us" | "ns"): number {
  if (!Number.isFinite(ts)) return Number.NaN;
  if (unit === "ns") return ts / 1_000_000;
  return ts / 1_000;
}

function isPlausibleEpoch(ts: number, unit: "us" | "ns"): boolean {
  const ms = epochToMs(ts, unit);
  if (!Number.isFinite(ms)) return false;
  const minMs = Date.UTC(2000, 0, 1, 0, 0, 0);
  const maxMs = Date.UTC(2200, 0, 1, 0, 0, 0);
  return ms >= minMs && ms <= maxMs;
}

function normalizeEpoch(value: number, unit: "us" | "ns"): number {
  const abs = Math.abs(value);
  if (unit === "ns") {
    if (abs < 1e13) return Math.trunc(value * 1_000_000);
    if (abs < 1e16) return Math.trunc(value * 1_000);
    return Math.trunc(value);
  }
  if (abs < 1e13) return Math.trunc(value * 1_000);
  if (abs > 1e16) return Math.trunc(value / 1_000);
  return Math.trunc(value);
}

function nowEpoch(unit: "us" | "ns"): number {
  const ms = Date.now();
  return unit === "ns" ? ms * 1_000_000 : ms * 1_000;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return Math.trunc(value);
}

function normalizeTypeValue(type: unknown, value: unknown): { typeCode: TypeCode; value: number | string } {
  if (type === "boolean") return { typeCode: TYPE_CODE.uint8, value: value === true ? 1 : 0 };
  if (type === "array" || type === "object") return { typeCode: TYPE_CODE.string, value: JSON.stringify(value ?? null) };
  if (type === "string") return { typeCode: TYPE_CODE.string, value: String(value ?? "") };
  if (type === "int8") return { typeCode: TYPE_CODE.int8, value: clampInt(Number(value), -128, 127) };
  if (type === "uint8") return { typeCode: TYPE_CODE.uint8, value: clampInt(Number(value), 0, 255) };
  if (type === "int16") return { typeCode: TYPE_CODE.int16, value: clampInt(Number(value), -32768, 32767) };
  if (type === "uint16") return { typeCode: TYPE_CODE.uint16, value: clampInt(Number(value), 0, 65535) };
  if (type === "int32") return { typeCode: TYPE_CODE.int32, value: clampInt(Number(value), -2147483648, 2147483647) };
  if (type === "uint32") return { typeCode: TYPE_CODE.uint32, value: clampInt(Number(value), 0, 4294967295) };
  if (type === "float32") return { typeCode: TYPE_CODE.float32, value: Number(value) || 0 };
  if (type === "float64") return { typeCode: TYPE_CODE.float64, value: Number(value) || 0 };
  if (typeof value === "number") return { typeCode: TYPE_CODE.float64, value };
  if (typeof value === "boolean") return { typeCode: TYPE_CODE.uint8, value: value ? 1 : 0 };
  return { typeCode: TYPE_CODE.string, value: String(value ?? "") };
}

function fixedSizeByTypeCode(typeCode: TypeCode): number {
  if (typeCode === TYPE_CODE.int8 || typeCode === TYPE_CODE.uint8) return 1;
  if (typeCode === TYPE_CODE.int16 || typeCode === TYPE_CODE.uint16) return 2;
  if (typeCode === TYPE_CODE.int32 || typeCode === TYPE_CODE.uint32 || typeCode === TYPE_CODE.float32) return 4;
  if (typeCode === TYPE_CODE.float64) return 8;
  return -1;
}

function encodePoint(point: HistorianBridgePoint): Buffer {
  const fixed = fixedSizeByTypeCode(point.typeCode);
  const valueLength = fixed > 0 ? fixed : Buffer.byteLength(String(point.value), "utf8");
  const out = Buffer.allocUnsafe(4 + 8 + 1 + (fixed > 0 ? valueLength : 4 + valueLength));
  let offset = 0;
  out.writeUInt32LE(point.tagId >>> 0, offset);
  offset += 4;
  out.writeBigInt64LE(BigInt(point.tsEpoch), offset);
  offset += 8;
  out.writeUInt8(point.typeCode, offset);
  offset += 1;
  if (point.typeCode === TYPE_CODE.string) {
    out.writeUInt32LE(valueLength, offset);
    offset += 4;
    out.write(String(point.value), offset, valueLength, "utf8");
    return out;
  }
  if (point.typeCode === TYPE_CODE.int8) out.writeInt8(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.uint8) out.writeUInt8(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.int16) out.writeInt16LE(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.uint16) out.writeUInt16LE(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.int32) out.writeInt32LE(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.uint32) out.writeUInt32LE(point.value as number, offset);
  else if (point.typeCode === TYPE_CODE.float32) out.writeFloatLE(point.value as number, offset);
  else out.writeDoubleLE(point.value as number, offset);
  return out;
}

function encodeBatch(points: HistorianBridgePoint[]): Buffer | null {
  if (points.length === 0) return null;
  const encodedPoints = points.map(encodePoint);
  const total = 4 + encodedPoints.reduce((acc, cur) => acc + cur.length, 0);
  const packet = Buffer.allocUnsafe(total);
  packet.writeUInt32LE(encodedPoints.length, 0);
  let offset = 4;
  for (const point of encodedPoints) {
    point.copy(packet, offset);
    offset += point.length;
  }
  return packet;
}

function toTargetConfig(input: unknown): Partial<HistorianTarget> {
  if (!input || typeof input !== "object") return {};
  return input as Partial<HistorianTarget>;
}

export function createHistorianBridge(options: HistorianBridgeOptions = {}) {
  const enabled = options.enabled !== false;
  const fallbackHost = String(options.host || "127.0.0.1");
  const fallbackPort = Number(options.port || 9900);
  const fallbackUnit: "us" | "ns" = options.timestampUnit === "ns" ? "ns" : "us";
  const flushIntervalMs = Math.max(5, Number(options.flushIntervalMs || 20));
  const maxQueue = Math.max(1000, Number(options.maxQueue || 100000));
  const targets = new Map<string, HistorianBridgeTargetState>();

  const ensureTarget = (cfgInput: unknown): HistorianBridgeTargetState => {
    const cfg = toTargetConfig(cfgInput);
    const id = String(cfg.id || "default");
    if (targets.has(id)) return targets.get(id) as HistorianBridgeTargetState;
    const target: HistorianBridgeTargetState = {
      id,
      name: String(cfg.name || id),
      host: String(cfg.udpHost || fallbackHost),
      port: Number(cfg.udpPort || fallbackPort),
      unit: cfg.timestampUnit === "ns" ? "ns" : fallbackUnit,
      enabled: cfg.enabled !== false,
      socket: dgram.createSocket("udp4"),
      queue: [],
      sentPoints: 0,
      droppedPoints: 0,
      sendErrors: 0,
      invalidTimestampFallbacks: 0,
    };
    targets.set(id, target);
    return target;
  };

  const applyTargets = (cfgTargets: unknown[] = []): void => {
    const normalized = Array.isArray(cfgTargets) ? cfgTargets : [];
    const nextIds = new Set(["default"]);
    ensureTarget({
      id: "default",
      name: "Default Historian",
      udpHost: fallbackHost,
      udpPort: fallbackPort,
      timestampUnit: fallbackUnit,
      enabled: true,
    });
    for (const t of normalized) {
      if (!t || typeof t !== "object") continue;
      const id = String((t as { id?: unknown }).id || "");
      if (!id) continue;
      nextIds.add(id);
      const current = ensureTarget(t);
      const obj = t as Partial<HistorianTarget>;
      current.name = String(obj.name || id);
      current.host = String(obj.udpHost || fallbackHost);
      current.port = Number(obj.udpPort || fallbackPort);
      current.unit = obj.timestampUnit === "ns" ? "ns" : "us";
      current.enabled = obj.enabled !== false;
    }
    for (const [id, target] of targets.entries()) {
      if (nextIds.has(id)) continue;
      target.socket.close();
      targets.delete(id);
    }
  };
  applyTargets(options.targets || []);

  const flush = (): void => {
    if (!enabled) return;
    for (const target of targets.values()) {
      if (!target.enabled || target.queue.length === 0) continue;
      const points = target.queue.splice(0, target.queue.length);
      const packet = encodeBatch(points);
      if (!packet) continue;
      target.socket.send(packet, target.port, target.host, (error) => {
        if (error) {
          target.sendErrors += points.length;
          return;
        }
        target.sentPoints += points.length;
      });
    }
  };
  const timer = setInterval(flush, flushIntervalMs);
  timer.unref();

  const resolveTimeSource = (change: AttributeQueryMatch, store: AssetStore, unit: "us" | "ns"): number => {
    const fallbackToNow = (): number => {
      const fromChangeTs = parseTimestamp(change.ts, unit);
      if (fromChangeTs != null && isPlausibleEpoch(fromChangeTs, unit)) return fromChangeTs;
      return nowEpoch(unit);
    };
    const sourcePath = String(change.historianTimeSourcePath || "").trim();
    if (!sourcePath) return fallbackToNow();
    const matches = store.query(sourcePath).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return fallbackToNow();
    const ts = parseTimestamp(matches[0].value, unit);
    if (ts == null || !isPlausibleEpoch(ts, unit)) return fallbackToNow();
    return ts;
  };

  return {
    updateTargets(nextTargets: unknown[] = []) {
      applyTargets(nextTargets);
    },
    enqueueChanges(changes: AttributeQueryMatch[] = [], store: AssetStore) {
      if (!enabled || !store) return;
      for (const change of changes) {
        if (!change || change.kind !== "attribute") continue;
        if (change.historianEnabled !== true) continue;
        if (!change.assetId || !change.attributeName) continue;
        const targetId = String(change.historianTargetId || "default");
        const target = targets.get(targetId) || targets.get("default");
        if (!target || !target.enabled) continue;
        const tagId = computeTagID(change.assetId, change.attributeName);
        const typed = normalizeTypeValue(change.type, change.value);
        const resolvedTs = resolveTimeSource(change, store, target.unit);
        if (!isPlausibleEpoch(resolvedTs, target.unit)) target.invalidTimestampFallbacks += 1;
        target.queue.push({
          tagId,
          tsEpoch: resolvedTs,
          typeCode: typed.typeCode,
          value: typed.value,
        });
      }
      for (const target of targets.values()) {
        if (target.queue.length > maxQueue) {
          const overflow = target.queue.length - maxQueue;
          target.queue.splice(0, overflow);
          target.droppedPoints += overflow;
        }
      }
    },
    stats() {
      const byTarget: Record<string, unknown> = {};
      for (const target of targets.values()) {
        byTarget[target.id] = {
          name: target.name,
          enabled: target.enabled,
          host: target.host,
          port: target.port,
          timestampUnit: target.unit,
          sentPoints: target.sentPoints,
          droppedPoints: target.droppedPoints,
          sendErrors: target.sendErrors,
          invalidTimestampFallbacks: target.invalidTimestampFallbacks,
          queue: target.queue.length,
        };
      }
      return { enabled, targets: byTarget };
    },
    close() {
      clearInterval(timer);
      for (const target of targets.values()) {
        target.socket.close();
      }
    },
  };
}
