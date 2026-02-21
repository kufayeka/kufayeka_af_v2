export enum ValueTypeCode {
  Int8 = 1,
  UInt8 = 2,
  Int16 = 3,
  UInt16 = 4,
  Int32 = 5,
  UInt32 = 6,
  Float32 = 7,
  Float64 = 8,
  String = 9
}

export type NumericValue = number;
export type PointValue = NumericValue | string;

export interface Point {
  tagId: number;
  tsEpoch: bigint;
  typeCode: ValueTypeCode;
  value: PointValue;
}

export function isNumericType(typeCode: ValueTypeCode): boolean {
  return typeCode !== ValueTypeCode.String;
}

export function fixedTypeSize(typeCode: ValueTypeCode): number {
  switch (typeCode) {
    case ValueTypeCode.Int8:
    case ValueTypeCode.UInt8:
      return 1;
    case ValueTypeCode.Int16:
    case ValueTypeCode.UInt16:
      return 2;
    case ValueTypeCode.Int32:
    case ValueTypeCode.UInt32:
    case ValueTypeCode.Float32:
      return 4;
    case ValueTypeCode.Float64:
      return 8;
    case ValueTypeCode.String:
      return -1;
    default:
      throw new Error(`Unsupported type code ${typeCode}`);
  }
}

export function parseTypeCode(input: string): ValueTypeCode {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new Error(`Invalid typeCode '${input}'`);
  }
  return n as ValueTypeCode;
}
