use anyhow::Result;
use axum::serve;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::net::TcpListener;

use historian_v2::config::load_config;
use historian_v2::http::{router, AppState};
use historian_v2::ingest::run_udp_server;
use historian_v2::query::engine::QueryEngine;
use historian_v2::storage::last_value::LastValueStore;
use historian_v2::storage::layout::ensure_base_layout;
use historian_v2::storage::repair::repair_storage_tail;
use historian_v2::storage::retention::spawn_retention_task;
use historian_v2::storage::writer::HistorianWriter;

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = load_config("historian.config.json").await?;
    ensure_base_layout(&cfg).await?;
    repair_storage_tail(&cfg).await?;
    tokio::fs::write(
        Path::new(&cfg.storage.data_dir).join("meta").join("config.json"),
        serde_json::to_vec_pretty(&cfg)?,
    )
    .await?;

    let last_store = LastValueStore::new(&cfg.storage.data_dir);
    last_store.start().await?;
    let writer = Arc::new(HistorianWriter::new(cfg.clone(), last_store.clone()));
    writer.spawn_flush_loop();
    spawn_retention_task(cfg.clone());

    let udp_cfg = cfg.clone();
    let udp_writer = writer.clone();
    tokio::spawn(async move {
        let _ = run_udp_server(udp_cfg, udp_writer).await;
    });

    let state = Arc::new(AppState {
        cfg: cfg.clone(),
        query_engine: QueryEngine::new(cfg.clone()),
        last_store: last_store.clone(),
    });
    let app = router(state);
    let addr: SocketAddr = format!("{}:{}", cfg.http.host, cfg.http.port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    println!(
        "Historian v2 started. UDP {}:{}, HTTP {}:{}",
        cfg.udp.host, cfg.udp.port, cfg.http.host, cfg.http.port
    );
    serve(listener, app).await?;
    Ok(())
}
