use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::config::Config;
use crate::storage::codec::{decode_segment_record, BLOCK_INDEX_ENTRY_SIZE};

async fn walk_files(root: &Path, ext: &str) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&cur).await?;
        while let Some(entry) = rd.next_entry().await? {
            let p = entry.path();
            let meta = entry.metadata().await?;
            if meta.is_dir() {
                stack.push(p);
            } else if p.extension().map(|v| v == ext).unwrap_or(false) {
                out.push(p);
            }
        }
    }
    Ok(out)
}

pub async fn repair_storage_tail(cfg: &Config) -> Result<()> {
    let raw_root = Path::new(&cfg.storage.data_dir).join("raw");
    let idx_root = Path::new(&cfg.storage.data_dir).join("index");
    let segs = walk_files(&raw_root, "seg").await?;
    for seg in segs {
        let data = tokio::fs::read(&seg).await?;
        let mut off = 0usize;
        while off < data.len() {
            if let Some((_, n)) = decode_segment_record(&data, off) {
                off += n;
            } else {
                break;
            }
        }
        if off < data.len() {
            tokio::fs::OpenOptions::new()
                .write(true)
                .open(&seg)
                .await?
                .set_len(off as u64)
                .await?;
        }
    }

    let idxs = walk_files(&idx_root, "idx").await?;
    for idx in idxs {
        let meta = tokio::fs::metadata(&idx).await?;
        let good = (meta.len() as usize / BLOCK_INDEX_ENTRY_SIZE) * BLOCK_INDEX_ENTRY_SIZE;
        if good < meta.len() as usize {
            tokio::fs::OpenOptions::new()
                .write(true)
                .open(&idx)
                .await?
                .set_len(good as u64)
                .await?;
        }
    }
    Ok(())
}
