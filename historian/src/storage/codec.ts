import { Point, ValueTypeCode, fixedTypeSize } from "../types/valueTypes";

export const SEGMENT_HEADER_SIZE = 17; // u32 tagId + i64 ts + u8 type + u32 valueLen
export const BLOCK_INDEX_ENTRY_SIZE = 44;

export interface DecodedRecord {
  point: Point;
  bytesRead: number;
}

export interface BlockIndexEntry {
  minTs: bigint;
  maxTs: bigint;
  byteOffsetStart: bigint;
  byteOffsetEnd: bigint;
  pointCount: number;
  minTagId: number;
  maxTagId: number;
}

export function encodeUdpBatch(points: Point[]): Buffer {
  const chunks: Buffer[] = [];
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32LE(points.length, 0);
  chunks.push(head);
  for (const p of points) {
    chunks.push(encodeUdpPoint(p));
  }
  return Buffer.concat(chunks);
}

export function encodeUdpPoint(point: Point): Buffer {
  const typeSize = fixedTypeSize(point.typeCode);
  const valueBuf =
    typeSize > 0
      ? encodeFixedValue(point.typeCode, point.value as number)
      : Buffer.from(point.value as string, "utf8");
  const extra = typeSize > 0 ? 0 : 4;
  const b = Buffer.allocUnsafe(4 + 8 + 1 + extra + valueBuf.length);
  let o = 0;
  b.writeUInt32LE(point.tagId >>> 0, o);
  o += 4;
  b.writeBigInt64LE(point.tsEpoch, o);
  o += 8;
  b.writeUInt8(point.typeCode, o);
  o += 1;
  if (typeSize < 0) {
    b.writeUInt32LE(valueBuf.length, o);
    o += 4;
  }
  valueBuf.copy(b, o);
  return b;
}

export function decodeUdpBatch(packet: Buffer): Point[] {
  if (packet.length < 4) throw new Error("packet too short");
  const count = packet.readUInt32LE(0);
  const out: Point[] = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    if (o + 13 > packet.length) throw new Error("incomplete point header");
    const tagId = packet.readUInt32LE(o);
    o += 4;
    const tsEpoch = packet.readBigInt64LE(o);
    o += 8;
    const typeCode = packet.readUInt8(o) as ValueTypeCode;
    o += 1;
    const size = fixedTypeSize(typeCode);
    let value: string | number;
    if (size > 0) {
      if (o + size > packet.length) throw new Error("incomplete point value");
      value = decodeFixedValue(packet, o, typeCode);
      o += size;
    } else {
      if (o + 4 > packet.length) throw new Error("incomplete string length");
      const len = packet.readUInt32LE(o);
      o += 4;
      if (o + len > packet.length) throw new Error("incomplete string payload");
      value = packet.toString("utf8", o, o + len);
      o += len;
    }
    out.push({ tagId, tsEpoch, typeCode, value });
  }
  return out;
}

export function encodeSegmentRecord(point: Point): Buffer {
  const typeSize = fixedTypeSize(point.typeCode);
  const valueBuf =
    typeSize > 0
      ? encodeFixedValue(point.typeCode, point.value as number)
      : Buffer.from(point.value as string, "utf8");
  const valueLen = typeSize > 0 ? 0 : valueBuf.length;
  const out = Buffer.allocUnsafe(SEGMENT_HEADER_SIZE + valueBuf.length);
  out.writeUInt32LE(point.tagId >>> 0, 0);
  out.writeBigInt64LE(point.tsEpoch, 4);
  out.writeUInt8(point.typeCode, 12);
  out.writeUInt32LE(valueLen >>> 0, 13);
  valueBuf.copy(out, SEGMENT_HEADER_SIZE);
  return out;
}

export function decodeSegmentRecord(buf: Buffer, offset: number): DecodedRecord | null {
  if (offset + SEGMENT_HEADER_SIZE > buf.length) return null;
  const tagId = buf.readUInt32LE(offset);
  const tsEpoch = buf.readBigInt64LE(offset + 4);
  const typeCode = buf.readUInt8(offset + 12) as ValueTypeCode;
  const valueLen = buf.readUInt32LE(offset + 13);
  const fixed = fixedTypeSize(typeCode);
  const payloadLen = fixed > 0 ? fixed : valueLen;
  const total = SEGMENT_HEADER_SIZE + payloadLen;
  if (offset + total > buf.length) return null;
  const payloadOffset = offset + SEGMENT_HEADER_SIZE;
  const value =
    fixed > 0 ? decodeFixedValue(buf, payloadOffset, typeCode) : buf.toString("utf8", payloadOffset, payloadOffset + payloadLen);
  return {
    point: { tagId, tsEpoch, typeCode, value },
    bytesRead: total
  };
}

export function encodeBlockIndexEntry(e: BlockIndexEntry): Buffer {
  const out = Buffer.allocUnsafe(BLOCK_INDEX_ENTRY_SIZE);
  out.writeBigInt64LE(e.minTs, 0);
  out.writeBigInt64LE(e.maxTs, 8);
  out.writeBigUInt64LE(e.byteOffsetStart, 16);
  out.writeBigUInt64LE(e.byteOffsetEnd, 24);
  out.writeUInt32LE(e.pointCount >>> 0, 32);
  out.writeUInt32LE(e.minTagId >>> 0, 36);
  out.writeUInt32LE(e.maxTagId >>> 0, 40);
  return out;
}

export function decodeBlockIndex(buf: Buffer): BlockIndexEntry[] {
  const n = Math.floor(buf.length / BLOCK_INDEX_ENTRY_SIZE);
  const out: BlockIndexEntry[] = [];
  for (let i = 0; i < n; i++) {
    const off = i * BLOCK_INDEX_ENTRY_SIZE;
    out.push({
      minTs: buf.readBigInt64LE(off),
      maxTs: buf.readBigInt64LE(off + 8),
      byteOffsetStart: buf.readBigUInt64LE(off + 16),
      byteOffsetEnd: buf.readBigUInt64LE(off + 24),
      pointCount: buf.readUInt32LE(off + 32),
      minTagId: buf.readUInt32LE(off + 36),
      maxTagId: buf.readUInt32LE(off + 40)
    });
  }
  return out;
}

function encodeFixedValue(typeCode: ValueTypeCode, value: number): Buffer {
  const s = fixedTypeSize(typeCode);
  const b = Buffer.allocUnsafe(s);
  switch (typeCode) {
    case ValueTypeCode.Int8:
      b.writeInt8(value, 0);
      return b;
    case ValueTypeCode.UInt8:
      b.writeUInt8(value, 0);
      return b;
    case ValueTypeCode.Int16:
      b.writeInt16LE(value, 0);
      return b;
    case ValueTypeCode.UInt16:
      b.writeUInt16LE(value, 0);
      return b;
    case ValueTypeCode.Int32:
      b.writeInt32LE(value, 0);
      return b;
    case ValueTypeCode.UInt32:
      b.writeUInt32LE(value, 0);
      return b;
    case ValueTypeCode.Float32:
      b.writeFloatLE(value, 0);
      return b;
    case ValueTypeCode.Float64:
      b.writeDoubleLE(value, 0);
      return b;
    default:
      throw new Error(`Type ${typeCode} is not fixed-size`);
  }
}

function decodeFixedValue(buf: Buffer, offset: number, typeCode: ValueTypeCode): number {
  switch (typeCode) {
    case ValueTypeCode.Int8:
      return buf.readInt8(offset);
    case ValueTypeCode.UInt8:
      return buf.readUInt8(offset);
    case ValueTypeCode.Int16:
      return buf.readInt16LE(offset);
    case ValueTypeCode.UInt16:
      return buf.readUInt16LE(offset);
    case ValueTypeCode.Int32:
      return buf.readInt32LE(offset);
    case ValueTypeCode.UInt32:
      return buf.readUInt32LE(offset);
    case ValueTypeCode.Float32:
      return buf.readFloatLE(offset);
    case ValueTypeCode.Float64:
      return buf.readDoubleLE(offset);
    default:
      throw new Error(`Type ${typeCode} is not fixed-size`);
  }
}
