use anyhow::Result;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use crate::config::{Config, TimestampUnit};
use crate::storage::codec::{decode_block_index, decode_segment_record};
use crate::storage::layout::{shard_for_tag, ts_to_ms, PartitionInfo};
use crate::types::{Point, PointValue, QueryOrder};

#[derive(Debug, Clone, Copy)]
pub enum AggName {
    Min,
    Max,
    Avg,
    First,
    Last,
    Count,
}

impl AggName {
    pub fn from_str(v: Option<&str>) -> Result<Self> {
        Ok(match v.unwrap_or("avg") {
            "min" => Self::Min,
            "max" => Self::Max,
            "avg" => Self::Avg,
            "first" => Self::First,
            "last" => Self::Last,
            "count" => Self::Count,
            _ => anyhow::bail!("agg is invalid"),
        })
    }
}

#[derive(Clone)]
pub struct QueryEngine {
    cfg: Config,
}

#[derive(Debug, Serialize)]
pub struct RawResult {
    pub points: Vec<Point>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct RangeResult {
    pub buckets: HashMap<String, Vec<BucketValue>>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct BucketValue {
    #[serde(rename = "bucketStart")]
    pub bucket_start: String,
    pub value: serde_json::Value,
}

impl QueryEngine {
    pub fn new(cfg: Config) -> Self {
        Self { cfg }
    }

    pub async fn raw(
        &self,
        tag_ids: &[u32],
        from: i64,
        to: i64,
        limit: usize,
        order: QueryOrder,
    ) -> Result<RawResult> {
        let tag_set: HashSet<u32> = tag_ids.iter().copied().collect();
        let mut out = Vec::<Point>::new();
        let partitions = self.partitions_between(from, to, order);
        let mut shards = HashSet::<u32>::new();
        for tag in tag_ids {
            shards.insert(shard_for_tag(*tag, self.cfg.storage.shard_count));
        }

        for p in partitions {
            for shard in &shards {
                let seg_path = crate::storage::layout::segment_path(&self.cfg.storage.data_dir, &p, *shard);
                let idx_path = crate::storage::layout::index_path(&self.cfg.storage.data_dir, &p, *shard);
                if !seg_path.exists() {
                    continue;
                }
                let ranges = self.scan_ranges(&idx_path, &seg_path, tag_ids, from, to).await?;
                let ranges: Vec<(u64, u64)> = if order == QueryOrder::Desc {
                    ranges.into_iter().rev().collect()
                } else {
                    ranges
                };
                for (start, end) in ranges {
                    if out.len() >= limit {
                        return Ok(RawResult { points: out, truncated: true });
                    }
                    let data = read_range(&seg_path, start, end).await?;
                    let mut recs = decode_points(&data, &tag_set, from, to);
                    if order == QueryOrder::Desc {
                        recs.reverse();
                    }
                    for r in recs {
                        if out.len() >= limit {
                            return Ok(RawResult { points: out, truncated: true });
                        }
                        out.push(r);
                    }
                }
            }
        }

        out.sort_by(|a, b| {
            if a.ts_epoch == b.ts_epoch {
                a.tag_id.cmp(&b.tag_id)
            } else if order == QueryOrder::Asc {
                a.ts_epoch.cmp(&b.ts_epoch)
            } else {
                b.ts_epoch.cmp(&a.ts_epoch)
            }
        });
        Ok(RawResult { points: out, truncated: false })
    }

    pub async fn range(
        &self,
        tag_ids: &[u32],
        from: i64,
        to: i64,
        bucket_ms: Option<i64>,
        agg: AggName,
        order: QueryOrder,
        limit: usize,
    ) -> Result<RangeResult> {
        if bucket_ms.is_none() {
            let raw = self.raw(tag_ids, from, to, limit, order).await?;
            let mut buckets = HashMap::new();
            for p in raw.points {
                buckets
                    .entry(p.tag_id.to_string())
                    .or_insert_with(Vec::new)
                    .push(BucketValue {
                        bucket_start: p.ts_epoch.to_string(),
                        value: point_to_json(&p.value),
                    });
            }
            return Ok(RangeResult {
                buckets,
                truncated: raw.truncated,
            });
        }
        let raw = self.raw(tag_ids, from, to, limit, order).await?;
        let bucket_ms = bucket_ms.unwrap();
        let step = match self.cfg.storage.timestamp_unit {
            TimestampUnit::Us => bucket_ms * 1_000,
            TimestampUnit::Ns => bucket_ms * 1_000_000,
        };
        let mut states: HashMap<u32, BTreeMap<i64, AggState>> = HashMap::new();
        for p in raw.points {
            let b = ((p.ts_epoch - from) / step) * step + from;
            let entry = states
                .entry(p.tag_id)
                .or_default()
                .entry(b)
                .or_insert_with(AggState::default);
            entry.update(&p);
        }
        let mut out = HashMap::<String, Vec<BucketValue>>::new();
        for (tag, bmap) in states {
            let mut rows = Vec::new();
            for (bucket_start, st) in bmap {
                rows.push(BucketValue {
                    bucket_start: bucket_start.to_string(),
                    value: st.finalize(agg),
                });
            }
            if order == QueryOrder::Desc {
                rows.reverse();
            }
            out.insert(tag.to_string(), rows);
        }
        Ok(RangeResult {
            buckets: out,
            truncated: raw.truncated,
        })
    }

    fn partitions_between(&self, from: i64, to: i64, order: QueryOrder) -> Vec<PartitionInfo> {
        let from_ms = ts_to_ms(from, &self.cfg.storage.timestamp_unit);
        let to_ms = ts_to_ms(to, &self.cfg.storage.timestamp_unit);
        let step = self.cfg.storage.partition_duration_ms;
        let start = (from_ms / step) * step;
        let mut out = Vec::new();
        let mut cur = start;
        while cur <= to_ms {
            let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(cur).unwrap_or_else(chrono::Utc::now);
            out.push(PartitionInfo {
                start_ms: cur,
                day: dt.format("%Y-%m-%d").to_string(),
                hour: dt.format("%H").to_string(),
            });
            cur += step;
        }
        if order == QueryOrder::Desc {
            out.reverse();
        }
        out
    }

    async fn scan_ranges(
        &self,
        idx_path: &Path,
        seg_path: &Path,
        tag_ids: &[u32],
        from: i64,
        to: i64,
    ) -> Result<Vec<(u64, u64)>> {
        let min_tag = *tag_ids.iter().min().unwrap_or(&0);
        let max_tag = *tag_ids.iter().max().unwrap_or(&u32::MAX);
        if idx_path.exists() {
            let idx = tokio::fs::read(idx_path).await?;
            let entries = decode_block_index(&idx);
            let mut ranges = Vec::new();
            for e in entries {
                if e.max_ts < from || e.min_ts > to {
                    continue;
                }
                if e.max_tag_id < min_tag || e.min_tag_id > max_tag {
                    continue;
                }
                ranges.push((e.byte_offset_start, e.byte_offset_end));
            }
            return Ok(ranges);
        }
        let sz = tokio::fs::metadata(seg_path).await?.len();
        Ok(if sz > 0 { vec![(0, sz)] } else { vec![] })
    }
}

async fn read_range(path: &Path, start: u64, end: u64) -> Result<Vec<u8>> {
    if end <= start {
        return Ok(Vec::new());
    }
    let data = tokio::fs::read(path).await?;
    let s = start as usize;
    let e = end as usize;
    Ok(data[s..e.min(data.len())].to_vec())
}

fn decode_points(buf: &[u8], tags: &HashSet<u32>, from: i64, to: i64) -> Vec<Point> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off < buf.len() {
        if let Some((p, n)) = decode_segment_record(buf, off) {
            off += n;
            if !tags.contains(&p.tag_id) {
                continue;
            }
            if p.ts_epoch < from || p.ts_epoch > to {
                continue;
            }
            out.push(p);
        } else {
            break;
        }
    }
    out
}

fn point_to_json(v: &PointValue) -> serde_json::Value {
    match v {
        PointValue::Num(n) => serde_json::json!(n),
        PointValue::Str(s) => serde_json::json!(s),
    }
}

#[derive(Default, Clone)]
struct AggState {
    first: Option<PointValue>,
    last: Option<PointValue>,
    min: Option<f64>,
    max: Option<f64>,
    sum: f64,
    numeric_count: u64,
    count: u64,
}

impl AggState {
    fn update(&mut self, p: &Point) {
        self.count += 1;
        if self.first.is_none() {
            self.first = Some(p.value.clone());
        }
        self.last = Some(p.value.clone());
        if p.type_code.is_numeric() {
            if let PointValue::Num(v) = &p.value {
                self.min = Some(self.min.map(|x| x.min(*v)).unwrap_or(*v));
                self.max = Some(self.max.map(|x| x.max(*v)).unwrap_or(*v));
                self.sum += *v;
                self.numeric_count += 1;
            }
        }
    }
    fn finalize(&self, agg: AggName) -> serde_json::Value {
        match agg {
            AggName::Count => serde_json::json!(self.count),
            AggName::First => match &self.first {
                Some(PointValue::Num(v)) => serde_json::json!(v),
                Some(PointValue::Str(v)) => serde_json::json!(v),
                None => serde_json::Value::Null,
            },
            AggName::Last => match &self.last {
                Some(PointValue::Num(v)) => serde_json::json!(v),
                Some(PointValue::Str(v)) => serde_json::json!(v),
                None => serde_json::Value::Null,
            },
            AggName::Min => self.min.map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
            AggName::Max => self.max.map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
            AggName::Avg => {
                if self.numeric_count == 0 {
                    serde_json::Value::Null
                } else {
                    serde_json::json!(self.sum / self.numeric_count as f64)
                }
            }
        }
    }
}
