use anyhow::Result;
use historian_v2::config::load_config;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = load_config("historian.config.json").await?;
    let host = if cfg.http.host == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else {
        cfg.http.host.clone()
    };
    let base = format!("http://{}:{}", host, cfg.http.port);
    let now = chrono::Utc::now();
    let from = (now - chrono::TimeDelta::minutes(60)).to_rfc3339();
    let to = now.to_rfc3339();
    let urls = vec![
        format!("{}/hist/last?tagIds=1,2,3&time=iso", base),
        format!(
            "{}/hist/raw?tagIds=1,2,3&from={}&to={}&order=desc&time=iso&limit=100",
            base, from, to
        ),
        format!(
            "{}/hist/range?tagIds=1,2,3&from={}&to={}&bucketMs=1000&agg=avg&order=desc&time=iso",
            base, from, to
        ),
    ];
    for u in urls {
        let path = u
            .split_once(&format!("http://{}:{}", host, cfg.http.port))
            .map(|(_, p)| p.to_string())
            .unwrap_or_else(|| "/".to_string());
        let mut stream = TcpStream::connect(format!("{}:{}", host, cfg.http.port)).await?;
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
            path, host, cfg.http.port
        );
        stream.write_all(req.as_bytes()).await?;
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await?;
        let body = String::from_utf8_lossy(&buf);
        let payload = body.split("\r\n\r\n").nth(1).unwrap_or(&body);
        println!("\nGET {}\n{}", u, payload);
    }
    Ok(())
}
