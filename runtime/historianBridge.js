const dgram = require("node:dgram");

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
};

function fnv1a32(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function makeTagKey(assetId, attributeName) {
  return `${assetId}:${attributeName}`;
}

function computeTagID(assetId, attributeName) {
  return fnv1a32(makeTagKey(assetId, attributeName));
}

function parseTimestamp(raw, unit) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return normalizeEpoch(raw, unit);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asInt)) {
      return normalizeEpoch(asInt, unit);
    }
    const epochMs = Date.parse(trimmed);
    if (!Number.isNaN(epochMs)) {
      return unit === "ns" ? epochMs * 1_000_000 : epochMs * 1_000;
    }
  }
  return null;
}

function epochToMs(ts, unit) {
  if (!Number.isFinite(ts)) return NaN;
  if (unit === "ns") return ts / 1_000_000;
  return ts / 1_000;
}

function isPlausibleEpoch(ts, unit) {
  const ms = epochToMs(ts, unit);
  if (!Number.isFinite(ms)) return false;
  const minMs = Date.UTC(2000, 0, 1, 0, 0, 0);
  const maxMs = Date.UTC(2200, 0, 1, 0, 0, 0);
  return ms >= minMs && ms <= maxMs;
}

function normalizeEpoch(value, unit) {
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

function nowEpoch(unit) {
  const ms = Date.now();
  return unit === "ns" ? ms * 1_000_000 : ms * 1_000;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return Math.trunc(value);
}

function normalizeTypeValue(type, value) {
  if (type === "boolean") {
    return { typeCode: TYPE_CODE.uint8, value: value === true ? 1 : 0 };
  }
  if (type === "array" || type === "object") {
    return { typeCode: TYPE_CODE.string, value: JSON.stringify(value ?? null) };
  }
  if (type === "string") {
    return { typeCode: TYPE_CODE.string, value: String(value ?? "") };
  }
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

function fixedSizeByTypeCode(typeCode) {
  if (typeCode === TYPE_CODE.int8 || typeCode === TYPE_CODE.uint8) return 1;
  if (typeCode === TYPE_CODE.int16 || typeCode === TYPE_CODE.uint16) return 2;
  if (
    typeCode === TYPE_CODE.int32 ||
    typeCode === TYPE_CODE.uint32 ||
    typeCode === TYPE_CODE.float32
  ) return 4;
  if (typeCode === TYPE_CODE.float64) return 8;
  return -1;
}

function encodePoint(point) {
  const fixed = fixedSizeByTypeCode(point.typeCode);
  const valueLength = fixed > 0 ? fixed : Buffer.byteLength(point.value, "utf8");
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
  if (point.typeCode === TYPE_CODE.int8) out.writeInt8(point.value, offset);
  else if (point.typeCode === TYPE_CODE.uint8) out.writeUInt8(point.value, offset);
  else if (point.typeCode === TYPE_CODE.int16) out.writeInt16LE(point.value, offset);
  else if (point.typeCode === TYPE_CODE.uint16) out.writeUInt16LE(point.value, offset);
  else if (point.typeCode === TYPE_CODE.int32) out.writeInt32LE(point.value, offset);
  else if (point.typeCode === TYPE_CODE.uint32) out.writeUInt32LE(point.value, offset);
  else if (point.typeCode === TYPE_CODE.float32) out.writeFloatLE(point.value, offset);
  else out.writeDoubleLE(point.value, offset);
  return out;
}

function encodeBatch(points) {
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

function createHistorianBridge(options = {}) {
  const enabled = options.enabled !== false;
  const host = String(options.host || "127.0.0.1");
  const port = Number(options.port || 9900);
  const unit = options.timestampUnit === "ns" ? "ns" : "us";
  const flushIntervalMs = Math.max(5, Number(options.flushIntervalMs || 20));
  const maxQueue = Math.max(1000, Number(options.maxQueue || 100000));
  const socket = dgram.createSocket("udp4");
  const queue = [];
  let sentPoints = 0;
  let droppedPoints = 0;
  let sendErrors = 0;
  let invalidTimestampFallbacks = 0;

  const flush = () => {
    if (!enabled || queue.length === 0) return;
    const points = queue.splice(0, queue.length);
    const packet = encodeBatch(points);
    if (!packet) return;
    socket.send(packet, port, host, (error) => {
      if (error) {
        sendErrors += points.length;
        return;
      }
      sentPoints += points.length;
    });
  };
  const timer = setInterval(flush, flushIntervalMs);
  timer.unref();

  const resolveTimeSource = (change, store) => {
    const fallbackToNow = () => {
      const fromChangeTs = parseTimestamp(change.ts, unit);
      if (fromChangeTs != null && isPlausibleEpoch(fromChangeTs, unit)) {
        return fromChangeTs;
      }
      return nowEpoch(unit);
    };
    const sourcePath = String(change.historianTimeSourcePath || "").trim();
    if (!sourcePath) return fallbackToNow();
    const matches = store.query(sourcePath).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return fallbackToNow();
    const ts = parseTimestamp(matches[0].value, unit);
    if (ts == null || !isPlausibleEpoch(ts, unit)) {
      invalidTimestampFallbacks += 1;
      return fallbackToNow();
    }
    return ts;
  };

  return {
    enqueueChanges(changes = [], store) {
      if (!enabled || !store) return;
      for (const change of changes) {
        if (!change || change.kind !== "attribute") continue;
        if (change.historianEnabled !== true) continue;
        if (!change.assetId || !change.attributeName) continue;
        const tagId = computeTagID(change.assetId, change.attributeName);
        const typed = normalizeTypeValue(change.type, change.value);
        queue.push({
          tagId,
          tsEpoch: resolveTimeSource(change, store),
          typeCode: typed.typeCode,
          value: typed.value,
        });
      }
      if (queue.length > maxQueue) {
        const overflow = queue.length - maxQueue;
        queue.splice(0, overflow);
        droppedPoints += overflow;
      }
    },
    stats() {
      return {
        enabled,
        host,
        port,
        timestampUnit: unit,
        sentPoints,
        droppedPoints,
        sendErrors,
        invalidTimestampFallbacks,
        queue: queue.length,
      };
    },
    close() {
      clearInterval(timer);
      socket.close();
    },
  };
}

module.exports = {
  createHistorianBridge,
  computeTagID,
  makeTagKey,
};
