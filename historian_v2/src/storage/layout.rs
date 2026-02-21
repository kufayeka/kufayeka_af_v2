use anyhow::Result;
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};

use crate::config::{Config, TimestampUnit};

#[derive(Debug, Clone)]
pub struct PartitionInfo {
    pub start_ms: i64,
    pub day: String,
    pub hour: String,
}

pub fn ts_to_ms(ts: i64, unit: &TimestampUnit) -> i64 {
    match unit {
        TimestampUnit::Us => ts / 1_000,
        TimestampUnit::Ns => ts / 1_000_000,
    }
}

pub fn compute_partition(ts_epoch: i64, cfg: &Config) -> PartitionInfo {
    let ts_ms = ts_to_ms(ts_epoch, &cfg.storage.timestamp_unit);
    let p = (ts_ms / cfg.storage.partition_duration_ms) * cfg.storage.partition_duration_ms;
    let dt: DateTime<Utc> = DateTime::from_timestamp_millis(p).unwrap_or_else(Utc::now);
    PartitionInfo {
        start_ms: p,
        day: dt.format("%Y-%m-%d").to_string(),
        hour: dt.format("%H").to_string(),
    }
}

pub fn shard_for_tag(tag_id: u32, shard_count: u32) -> u32 {
    tag_id % shard_count
}

pub fn segment_path(data_dir: &str, p: &PartitionInfo, shard: u32) -> PathBuf {
    Path::new(data_dir)
        .join("raw")
        .join(&p.day)
        .join(&p.hour)
        .join(format!("shard-{shard:02}.seg"))
}

pub fn index_path(data_dir: &str, p: &PartitionInfo, shard: u32) -> PathBuf {
    Path::new(data_dir)
        .join("index")
        .join(&p.day)
        .join(&p.hour)
        .join(format!("shard-{shard:02}.idx"))
}

pub async fn ensure_base_layout(cfg: &Config) -> Result<()> {
    tokio::fs::create_dir_all(Path::new(&cfg.storage.data_dir).join("raw")).await?;
    tokio::fs::create_dir_all(Path::new(&cfg.storage.data_dir).join("index")).await?;
    tokio::fs::create_dir_all(Path::new(&cfg.storage.data_dir).join("meta")).await?;
    Ok(())
}
