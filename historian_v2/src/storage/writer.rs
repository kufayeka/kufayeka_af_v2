use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::config::{BackpressurePolicy, Config};
use crate::storage::codec::{encode_block_index_entry, encode_segment_record, BlockIndexEntry};
use crate::storage::last_value::LastValueStore;
use crate::storage::layout::{compute_partition, index_path, segment_path, shard_for_tag};
use crate::types::Point;

#[derive(Default, Debug, Clone)]
pub struct WriterStats {
    pub accepted_points: u64,
    pub dropped_points: u64,
    pub decode_errors: u64,
}

#[derive(Debug, Clone)]
struct QueueState {
    points: Vec<Point>,
    bytes: usize,
}

#[derive(Clone)]
pub struct HistorianWriter {
    cfg: Config,
    queues: Arc<Mutex<HashMap<String, QueueState>>>,
    stats: Arc<Mutex<WriterStats>>,
    last_values: LastValueStore,
}

impl HistorianWriter {
    pub fn new(cfg: Config, last_values: LastValueStore) -> Self {
        Self {
            cfg,
            queues: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(Mutex::new(WriterStats::default())),
            last_values,
        }
    }

    pub fn spawn_flush_loop(&self) {
        let me = self.clone();
        tokio::spawn(async move {
            loop {
                let _ = me.flush_all().await;
                sleep(Duration::from_millis(me.cfg.flush.flush_interval_ms)).await;
            }
        });
    }

    pub async fn mark_decode_error(&self) {
        let mut s = self.stats.lock().await;
        s.decode_errors += 1;
    }

    pub async fn ingest_batch(&self, points: Vec<Point>) -> Result<()> {
        let mut accepted = Vec::new();
        {
            let mut queues = self.queues.lock().await;
            let mut s = self.stats.lock().await;
            for p in points {
                let part = compute_partition(p.ts_epoch, &self.cfg);
                let shard = shard_for_tag(p.tag_id, self.cfg.storage.shard_count);
                let key = format!("{}/{}/{}", part.day, part.hour, shard);
                let q = queues.entry(key).or_insert(QueueState {
                    points: Vec::new(),
                    bytes: 0,
                });

                if q.points.len() >= self.cfg.flush.max_queue_points {
                    match self.cfg.flush.backpressure_policy {
                        BackpressurePolicy::DropNew => {
                            s.dropped_points += 1;
                            continue;
                        }
                        BackpressurePolicy::DropOldest => {
                            if let Some(old) = q.points.first() {
                                q.bytes = q.bytes.saturating_sub(encode_segment_record(old).len());
                            }
                            if !q.points.is_empty() {
                                q.points.remove(0);
                            }
                            s.dropped_points += 1;
                        }
                    }
                }
                q.bytes += encode_segment_record(&p).len();
                q.points.push(p.clone());
                accepted.push(p);
                s.accepted_points += 1;
            }
        }
        if !accepted.is_empty() {
            self.last_values.update_batch(&accepted).await?;
        }
        if self.should_flush_fast().await {
            self.flush_all().await?;
        }
        Ok(())
    }

    async fn should_flush_fast(&self) -> bool {
        let queues = self.queues.lock().await;
        queues.values().any(|q| q.bytes >= self.cfg.flush.flush_bytes)
    }

    pub async fn flush_all(&self) -> Result<()> {
        let mut batches = Vec::<(String, Vec<Point>)>::new();
        {
            let mut queues = self.queues.lock().await;
            let keys: Vec<String> = queues.keys().cloned().collect();
            for k in keys {
                if let Some(q) = queues.get_mut(&k) {
                    if q.points.is_empty() {
                        continue;
                    }
                    let pts = std::mem::take(&mut q.points);
                    q.bytes = 0;
                    batches.push((k, pts));
                }
            }
        }

        for (key, points) in batches {
            self.flush_one(&key, &points).await?;
        }
        Ok(())
    }

    async fn flush_one(&self, key: &str, points: &[Point]) -> Result<()> {
        let mut parts = key.split('/');
        let day = parts.next().unwrap_or_default();
        let hour = parts.next().unwrap_or_default();
        let shard: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
        let p = crate::storage::layout::PartitionInfo {
            start_ms: 0,
            day: day.to_string(),
            hour: hour.to_string(),
        };
        let seg_path = segment_path(&self.cfg.storage.data_dir, &p, shard);
        let idx_path = index_path(&self.cfg.storage.data_dir, &p, shard);
        if let Some(parent) = seg_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        if let Some(parent) = idx_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut payload = Vec::new();
        let mut min_ts = i64::MAX;
        let mut max_ts = i64::MIN;
        let mut min_tag = u32::MAX;
        let mut max_tag = 0u32;
        for p in points {
            min_ts = min_ts.min(p.ts_epoch);
            max_ts = max_ts.max(p.ts_epoch);
            min_tag = min_tag.min(p.tag_id);
            max_tag = max_tag.max(p.tag_id);
            payload.extend_from_slice(&encode_segment_record(p));
        }
        let start_off = tokio::fs::metadata(&seg_path).await.map(|m| m.len()).unwrap_or(0);
        let mut seg = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&seg_path)
            .await?;
        seg.write_all(&payload).await?;
        let end_off = start_off + payload.len() as u64;

        if self.cfg.index.index_block_on_flush {
            let e = BlockIndexEntry {
                min_ts,
                max_ts,
                byte_offset_start: start_off,
                byte_offset_end: end_off,
                point_count: points.len() as u32,
                min_tag_id: min_tag,
                max_tag_id: max_tag,
            };
            let mut idx = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&idx_path)
                .await?;
            idx.write_all(&encode_block_index_entry(&e)).await?;
        }
        Ok(())
    }

    pub async fn stats(&self) -> WriterStats {
        self.stats.lock().await.clone()
    }
}
