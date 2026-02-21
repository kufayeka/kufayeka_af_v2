use anyhow::Result;
use std::sync::Arc;
use tokio::net::UdpSocket;

use crate::config::Config;
use crate::storage::codec::decode_udp_batch;
use crate::storage::writer::HistorianWriter;

pub async fn run_udp_server(cfg: Config, writer: Arc<HistorianWriter>) -> Result<()> {
    let addr = format!("{}:{}", cfg.udp.host, cfg.udp.port);
    let socket = UdpSocket::bind(&addr).await?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let (n, _) = socket.recv_from(&mut buf).await?;
        match decode_udp_batch(&buf[..n]) {
            Ok(points) => {
                let _ = writer.ingest_batch(points).await;
            }
            Err(_) => {
                writer.mark_decode_error().await;
            }
        }
    }
}
