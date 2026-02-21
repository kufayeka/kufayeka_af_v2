use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackpressurePolicy {
    DropNew,
    DropOldest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimestampUnit {
    Us,
    Ns,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UdpConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConfig {
    pub host: String,
    pub port: u16,
    #[serde(rename = "maxPoints")]
    pub max_points: usize,
    #[serde(rename = "streamThresholdPoints")]
    pub stream_threshold_points: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    #[serde(rename = "dataDir")]
    pub data_dir: String,
    #[serde(rename = "shardCount")]
    pub shard_count: u32,
    #[serde(rename = "partitionDurationMs")]
    pub partition_duration_ms: i64,
    #[serde(rename = "timestampUnit")]
    pub timestamp_unit: TimestampUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlushConfig {
    #[serde(rename = "flushIntervalMs")]
    pub flush_interval_ms: u64,
    #[serde(rename = "flushBytes")]
    pub flush_bytes: usize,
    #[serde(rename = "maxQueuePoints")]
    pub max_queue_points: usize,
    #[serde(rename = "backpressurePolicy")]
    pub backpressure_policy: BackpressurePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConfig {
    #[serde(rename = "indexBlockOnFlush")]
    pub index_block_on_flush: bool,
    #[serde(rename = "enablePerTagSparseIndex")]
    pub enable_per_tag_sparse_index: bool,
    #[serde(rename = "indexStridePerTag")]
    pub index_stride_per_tag: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionConfig {
    pub enabled: bool,
    #[serde(rename = "maxAgeHours")]
    pub max_age_hours: i64,
    #[serde(rename = "checkIntervalMs")]
    pub check_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    #[serde(rename = "poolSize")]
    pub pool_size: usize,
    #[serde(rename = "maxPoolSize")]
    pub max_pool_size: usize,
    #[serde(rename = "jobTimeoutMs")]
    pub job_timeout_ms: u64,
    #[serde(rename = "offloadMinRangeMs")]
    pub offload_min_range_ms: i64,
    #[serde(rename = "offloadMinLimit")]
    pub offload_min_limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub udp: UdpConfig,
    pub http: HttpConfig,
    pub storage: StorageConfig,
    pub flush: FlushConfig,
    pub index: IndexConfig,
    pub retention: RetentionConfig,
    pub workers: WorkerConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            udp: UdpConfig {
                host: "0.0.0.0".to_string(),
                port: 9900,
            },
            http: HttpConfig {
                host: "0.0.0.0".to_string(),
                port: 8080,
                max_points: 100_000,
                stream_threshold_points: 5000,
            },
            storage: StorageConfig {
                data_dir: "./data".to_string(),
                shard_count: 16,
                partition_duration_ms: 3_600_000,
                timestamp_unit: TimestampUnit::Us,
            },
            flush: FlushConfig {
                flush_interval_ms: 5,
                flush_bytes: 256 * 1024,
                max_queue_points: 200_000,
                backpressure_policy: BackpressurePolicy::DropNew,
            },
            index: IndexConfig {
                index_block_on_flush: true,
                enable_per_tag_sparse_index: false,
                index_stride_per_tag: 4096,
            },
            retention: RetentionConfig {
                enabled: false,
                max_age_hours: 24 * 7,
                check_interval_ms: 300_000,
            },
            workers: WorkerConfig {
                pool_size: 0,
                max_pool_size: 8,
                job_timeout_ms: 15_000,
                offload_min_range_ms: 7_200_000,
                offload_min_limit: 5000,
            },
        }
    }
}

pub async fn load_config(path: &str) -> Result<Config> {
    if !Path::new(path).exists() {
        return Ok(Config::default());
    }
    let content = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("failed to read config at {}", path))?;
    let cfg: Config = serde_json::from_str(&content).context("invalid historian config json")?;
    Ok(cfg)
}
