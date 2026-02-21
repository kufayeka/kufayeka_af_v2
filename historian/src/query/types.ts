import { ValueTypeCode } from "../types/valueTypes";

export interface QueryPoint {
  tagId: number;
  tsEpoch: bigint;
  typeCode: ValueTypeCode;
  value: number | string;
}

export type AggName = "min" | "max" | "avg" | "first" | "last" | "count";
export type QueryOrder = "asc" | "desc";

export interface RangeQueryRequest {
  tagIds: number[];
  from: bigint;
  to: bigint;
  bucketMs?: number;
  agg: AggName;
  order?: QueryOrder;
  limit: number;
}

export interface RawQueryRequest {
  tagIds: number[];
  from: bigint;
  to: bigint;
  order?: QueryOrder;
  limit: number;
}

export interface LastQueryRequest {
  tagIds: number[];
}

export interface QueryJob {
  id: number;
  kind: "last" | "raw" | "range";
  payload: LastQueryRequest | RawQueryRequest | RangeQueryRequest;
}

export interface QueryJobResult {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}
