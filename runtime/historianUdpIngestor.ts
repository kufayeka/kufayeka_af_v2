import dgram from "node:dgram";
import type { HistorianPointRow } from "./historianTimescale";

const TYPE_CODE = {
  int8: 1,
  uint8: 2,
  int16: 3,
  uint16: 4,
  int32: 5,
  uint32: 6,
  float32: 7,
  float64: 8,
  string: 9
} as const;

interface DecodedPoint {
  tagId: number;
  tsEpoch: number;
  value: unknown;
}

function epochToMs(value: number): number {
  const abs = Math.abs(value);
  if (abs < 1e11) return value * 1000;
  if (abs < 1e14) return value;
  if (abs < 1e17) return value / 1000;
  return value / 1_000_000;
}

function decodePacket(buffer: Buffer): DecodedPoint[] {
  if (buffer.length < 4) return [];
  let offset = 0;
  const count = buffer.readUInt32LE(offset);
  offset += 4;
  const out: DecodedPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 13 > buffer.length) break;
    const tagId = buffer.readUInt32LE(offset);
    offset += 4;
    const tsEpoch = Number(buffer.readBigInt64LE(offset));
    offset += 8;
    const typeCode = buffer.readUInt8(offset);
    offset += 1;

    let value: unknown = null;
    if (typeCode === TYPE_CODE.string) {
      if (offset + 4 > buffer.length) break;
      const len = buffer.readUInt32LE(offset);
      offset += 4;
      if (offset + len > buffer.length) break;
      value = buffer.toString("utf8", offset, offset + len);
      offset += len;
      try {
        value = JSON.parse(String(value));
      } catch {
        // Keep raw string when it is not JSON.
      }
    } else if (typeCode === TYPE_CODE.int8) {
      if (offset + 1 > buffer.length) break;
      value = buffer.readInt8(offset);
      offset += 1;
    } else if (typeCode === TYPE_CODE.uint8) {
      if (offset + 1 > buffer.length) break;
      value = buffer.readUInt8(offset);
      offset += 1;
    } else if (typeCode === TYPE_CODE.int16) {
      if (offset + 2 > buffer.length) break;
      value = buffer.readInt16LE(offset);
      offset += 2;
    } else if (typeCode === TYPE_CODE.uint16) {
      if (offset + 2 > buffer.length) break;
      value = buffer.readUInt16LE(offset);
      offset += 2;
    } else if (typeCode === TYPE_CODE.int32) {
      if (offset + 4 > buffer.length) break;
      value = buffer.readInt32LE(offset);
      offset += 4;
    } else if (typeCode === TYPE_CODE.uint32) {
      if (offset + 4 > buffer.length) break;
      value = buffer.readUInt32LE(offset);
      offset += 4;
    } else if (typeCode === TYPE_CODE.float32) {
      if (offset + 4 > buffer.length) break;
      value = buffer.readFloatLE(offset);
      offset += 4;
    } else if (typeCode === TYPE_CODE.float64) {
      if (offset + 8 > buffer.length) break;
      value = buffer.readDoubleLE(offset);
      offset += 8;
    } else {
      break;
    }

    out.push({ tagId, tsEpoch, value });
  }
  return out;
}

export function startHistorianUdpIngestor(options: {
  host: string;
  port: number;
  resolveAttributePath: (tagId: number) => string | undefined;
  ingestRows: (rows: HistorianPointRow[]) => Promise<void>;
  onStats?: (stats: Record<string, unknown>) => void;
}) {
  const socket = dgram.createSocket("udp4");
  let packetCount = 0;
  let pointCount = 0;
  let droppedPoints = 0;
  let decodeErrors = 0;
  let ingestErrors = 0;
  let closing = false;

  const emitStats = (): void => {
    if (!options.onStats) return;
    options.onStats({
      packetCount,
      pointCount,
      droppedPoints,
      decodeErrors,
      ingestErrors
    });
  };

  socket.on("message", (msg: Buffer) => {
    if (closing) return;
    packetCount += 1;
    let decoded: DecodedPoint[] = [];
    try {
      decoded = decodePacket(msg);
    } catch {
      decodeErrors += 1;
      emitStats();
      return;
    }
    if (decoded.length === 0) {
      emitStats();
      return;
    }
    pointCount += decoded.length;
    const rows: HistorianPointRow[] = [];
    for (const point of decoded) {
      const path = options.resolveAttributePath(point.tagId);
      if (!path) {
        droppedPoints += 1;
        continue;
      }
      const ts = new Date(epochToMs(point.tsEpoch));
      if (Number.isNaN(ts.getTime())) {
        droppedPoints += 1;
        continue;
      }
      rows.push({
        ts,
        attributePath: path,
        value: point.value
      });
    }
    if (rows.length === 0) {
      emitStats();
      return;
    }
    void options
      .ingestRows(rows)
      .catch(() => {
        ingestErrors += rows.length;
      })
      .finally(() => {
        emitStats();
      });
  });

  socket.bind(options.port, options.host);

  return {
    stop: async () => {
      closing = true;
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    }
  };
}
