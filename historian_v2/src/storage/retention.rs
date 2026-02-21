use anyhow::Result;
use chrono::{DateTime, Utc};
use std::path::Path;
use tokio::time::{sleep, Duration};

use crate::config::Config;

async fn cleanup_once(cfg: &Config) -> Result<()> {
    if !cfg.retention.enabled {
        return Ok(());
    }
    let cutoff = Utc::now().timestamp_millis() - cfg.retention.max_age_hours * 3_600_000;
    for root in ["raw", "index"] {
        let top = Path::new(&cfg.storage.data_dir).join(root);
        if !top.exists() {
            continue;
        }
        let mut day_dir = tokio::fs::read_dir(&top).await?;
        while let Some(day) = day_dir.next_entry().await? {
            let day_name = day.file_name().to_string_lossy().to_string();
            let day_path = day.path();
            if !day_path.is_dir() {
                continue;
            }
            let mut hour_dir = tokio::fs::read_dir(&day_path).await?;
            while let Some(hour) = hour_dir.next_entry().await? {
                let hour_name = hour.file_name().to_string_lossy().to_string();
                let t = format!("{day_name}T{hour_name}:00:00Z");
                if let Ok(parsed) = DateTime::parse_from_rfc3339(&t.replace(' ', "T")) {
                    if parsed.with_timezone(&Utc).timestamp_millis() < cutoff {
                        let _ = tokio::fs::remove_dir_all(hour.path()).await;
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn spawn_retention_task(cfg: Config) {
    tokio::spawn(async move {
        loop {
            let _ = cleanup_once(&cfg).await;
            sleep(Duration::from_millis(cfg.retention.check_interval_ms)).await;
        }
    });
}
