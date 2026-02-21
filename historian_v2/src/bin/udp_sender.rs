use anyhow::Result;
use historian_v2::config::{load_config, TimestampUnit};
use historian_v2::storage::codec::encode_udp_batch;
use historian_v2::types::{Point, PointValue, ValueTypeCode};
use tokio::net::UdpSocket;

const THREE_DAYS_SECONDS: i64 = 3 * 24 * 60 * 60;

fn to_epoch(ms: i64, unit: &TimestampUnit) -> i64 {
    match unit {
        TimestampUnit::Us => ms * 1_000,
        TimestampUnit::Ns => ms * 1_000_000,
    }
}

fn per_second_points(ts: i64, seq: i64) -> Vec<Point> {
    vec![
        Point {
            tag_id: 1,
            ts_epoch: ts,
            type_code: ValueTypeCode::Int32,
            value: PointValue::Num((seq % 2000 - 1000) as f64),
        },
        Point {
            tag_id: 2,
            ts_epoch: ts,
            type_code: ValueTypeCode::Float32,
            value: PointValue::Num((seq as f64 / 25.0).sin() * 100.0),
        },
        Point {
            tag_id: 3,
            ts_epoch: ts,
            type_code: ValueTypeCode::String,
            value: PointValue::Str(format!("state-{}", seq % 5)),
        },
    ]
}

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = load_config("historian.config.json").await?;
    let seconds_per_packet: i64 = std::env::args()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(600);
    let interval_ms: u64 = std::env::args()
        .nth(2)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_ms = now_ms - 3 * 24 * 3600 * 1000;
    let start_ts = to_epoch(start_ms, &cfg.storage.timestamp_unit);
    let step = to_epoch(1000, &cfg.storage.timestamp_unit);
    let socket = UdpSocket::bind("0.0.0.0:0").await?;
    let addr = format!("{}:{}", cfg.udp.host, cfg.udp.port);
    let mut sent = 0usize;

    println!(
        "sending 3-day per-second data: {} -> {}",
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(start_ms).unwrap(),
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).unwrap()
    );

    let mut sec = 0i64;
    while sec < THREE_DAYS_SECONDS {
        let until = (sec + seconds_per_packet).min(THREE_DAYS_SECONDS);
        let mut batch = Vec::new();
        for s in sec..until {
            let ts = start_ts + s * step;
            batch.extend(per_second_points(ts, s));
        }
        let payload = encode_udp_batch(&batch);
        socket.send_to(&payload, &addr).await?;
        sent += batch.len();
        sec = until;
        if interval_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
        }
    }
    println!("finished sending {} points", sent);
    Ok(())
}
