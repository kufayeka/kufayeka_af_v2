use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

use crate::storage::codec::{decode_segment_record, encode_segment_record};
use crate::types::Point;

#[derive(Clone)]
pub struct LastValueStore {
    path: String,
    latest: Arc<RwLock<HashMap<u32, Point>>>,
}

impl LastValueStore {
    pub fn new(data_dir: &str) -> Self {
        Self {
            path: Path::new(data_dir)
                .join("meta")
                .join("last-values.log")
                .to_string_lossy()
                .to_string(),
            latest: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start(&self) -> Result<()> {
        if let Ok(data) = tokio::fs::read(&self.path).await {
            let mut off = 0usize;
            let mut map = self.latest.write().await;
            while off < data.len() {
                if let Some((p, n)) = decode_segment_record(&data, off) {
                    off += n;
                    let replace = map.get(&p.tag_id).map(|v| p.ts_epoch >= v.ts_epoch).unwrap_or(true);
                    if replace {
                        map.insert(p.tag_id, p);
                    }
                } else {
                    break;
                }
            }
            if off < data.len() {
                let _ = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(&self.path)
                    .await?
                    .set_len(off as u64)
                    .await;
            }
        }
        Ok(())
    }

    pub async fn update_batch(&self, points: &[Point]) -> Result<()> {
        let mut map = self.latest.write().await;
        let mut payload = Vec::with_capacity(points.len() * 32);
        for p in points {
            let replace = map.get(&p.tag_id).map(|v| p.ts_epoch >= v.ts_epoch).unwrap_or(true);
            if replace {
                map.insert(p.tag_id, p.clone());
            }
            payload.extend_from_slice(&encode_segment_record(p));
        }
        drop(map);
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        f.write_all(&payload).await?;
        Ok(())
    }

    pub async fn get_latest(&self, tag_ids: &[u32]) -> Vec<Point> {
        let map = self.latest.read().await;
        tag_ids.iter().filter_map(|id| map.get(id).cloned()).collect()
    }
}
