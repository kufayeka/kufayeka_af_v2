use anyhow::{bail, Result};
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::config::{Config, TimestampUnit};
use crate::query::engine::{AggName, QueryEngine};
use crate::storage::last_value::LastValueStore;
use crate::types::{Point, PointValue, QueryOrder};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Config,
    pub query_engine: QueryEngine,
    pub last_store: LastValueStore,
}

#[derive(Deserialize)]
pub struct HistQuery {
    #[serde(rename = "tagIds")]
    pub tag_ids: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub order: Option<String>,
    pub time: Option<String>,
    #[serde(rename = "bucketMs")]
    pub bucket_ms: Option<i64>,
    pub agg: Option<String>,
    pub limit: Option<usize>,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/hist/last", get(hist_last))
        .route("/hist/raw", get(hist_raw))
        .route("/hist/range", get(hist_range))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn hist_last(State(state): State<Arc<AppState>>, Query(q): Query<HistQuery>) -> Json<Value> {
    match inner_hist_last(state, q).await {
        Ok(v) => Json(v),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

async fn hist_raw(State(state): State<Arc<AppState>>, Query(q): Query<HistQuery>) -> Json<Value> {
    match inner_hist_raw(state, q).await {
        Ok(v) => Json(v),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

async fn hist_range(State(state): State<Arc<AppState>>, Query(q): Query<HistQuery>) -> Json<Value> {
    match inner_hist_range(state, q).await {
        Ok(v) => Json(v),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

async fn inner_hist_last(state: Arc<AppState>, q: HistQuery) -> Result<Value> {
    let tag_ids = parse_tag_ids(&q.tag_ids)?;
    let tf = parse_time_format(q.time.as_deref())?;
    let points = state.last_store.get_latest(&tag_ids).await;
    Ok(json!({
        "rows": pivot_points(points, tf, &state.cfg.storage.timestamp_unit, QueryOrder::Desc)
    }))
}

async fn inner_hist_raw(state: Arc<AppState>, q: HistQuery) -> Result<Value> {
    if q.bucket_ms.is_some() || q.agg.is_some() {
        bail!("bucketMs/agg is not supported on /hist/raw. Use /hist/range instead");
    }
    let tag_ids = parse_tag_ids(&q.tag_ids)?;
    let from = parse_timestamp(q.from.as_deref(), "from", &state.cfg.storage.timestamp_unit)?;
    let to = parse_timestamp(q.to.as_deref(), "to", &state.cfg.storage.timestamp_unit)?;
    if to < from {
        bail!("to must be >= from");
    }
    let order = QueryOrder::from_str(q.order.as_deref())?;
    let tf = parse_time_format(q.time.as_deref())?;
    let limit = q.limit.unwrap_or(state.cfg.http.max_points).min(state.cfg.http.max_points);
    let res = state.query_engine.raw(&tag_ids, from, to, limit, order).await?;
    Ok(json!({
        "rows": pivot_points(res.points, tf, &state.cfg.storage.timestamp_unit, order),
        "truncated": res.truncated
    }))
}

async fn inner_hist_range(state: Arc<AppState>, q: HistQuery) -> Result<Value> {
    let tag_ids = parse_tag_ids(&q.tag_ids)?;
    let from = parse_timestamp(q.from.as_deref(), "from", &state.cfg.storage.timestamp_unit)?;
    let to = parse_timestamp(q.to.as_deref(), "to", &state.cfg.storage.timestamp_unit)?;
    if to < from {
        bail!("to must be >= from");
    }
    let agg = AggName::from_str(q.agg.as_deref())?;
    let order = QueryOrder::from_str(q.order.as_deref())?;
    let tf = parse_time_format(q.time.as_deref())?;
    let limit = q.limit.unwrap_or(state.cfg.http.max_points).min(state.cfg.http.max_points);
    let res = state
        .query_engine
        .range(&tag_ids, from, to, q.bucket_ms, agg, order, limit)
        .await?;
    let rows = pivot_buckets(res.buckets, tf, &state.cfg.storage.timestamp_unit, order);
    Ok(json!({ "rows": rows, "truncated": res.truncated }))
}

#[derive(Clone, Copy)]
enum TimeFmt {
    Epoch,
    Iso,
}

fn parse_time_format(v: Option<&str>) -> Result<TimeFmt> {
    Ok(match v.unwrap_or("epoch") {
        "epoch" => TimeFmt::Epoch,
        "iso" => TimeFmt::Iso,
        _ => bail!("time must be epoch|iso"),
    })
}

fn parse_tag_ids(v: &str) -> Result<Vec<u32>> {
    let mut out = Vec::new();
    for s in v.split(',') {
        let id: u32 = s.trim().parse()?;
        out.push(id);
    }
    if out.is_empty() {
        bail!("tagIds is empty");
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

fn parse_timestamp(v: Option<&str>, name: &str, unit: &TimestampUnit) -> Result<i64> {
    let v = v.ok_or_else(|| anyhow::anyhow!("{name} is required"))?;
    if let Ok(n) = v.parse::<i64>() {
        return Ok(n);
    }
    let dt = DateTime::parse_from_rfc3339(v).map(|d| d.with_timezone(&Utc))?;
    let ms = dt.timestamp_millis();
    Ok(match unit {
        TimestampUnit::Us => ms * 1_000,
        TimestampUnit::Ns => ms * 1_000_000,
    })
}

fn format_time(ts: i64, fmt: TimeFmt, unit: &TimestampUnit) -> String {
    match fmt {
        TimeFmt::Epoch => ts.to_string(),
        TimeFmt::Iso => {
            let ms = match unit {
                TimestampUnit::Us => ts / 1_000,
                TimestampUnit::Ns => ts / 1_000_000,
            };
            DateTime::<Utc>::from_timestamp_millis(ms)
                .unwrap_or_else(Utc::now)
                .to_rfc3339()
        }
    }
}

fn point_value_json(v: PointValue) -> Value {
    match v {
        PointValue::Num(n) => json!(n),
        PointValue::Str(s) => json!(s),
    }
}

fn pivot_points(points: Vec<Point>, fmt: TimeFmt, unit: &TimestampUnit, order: QueryOrder) -> Vec<Value> {
    let mut rows: BTreeMap<i64, serde_json::Map<String, Value>> = BTreeMap::new();
    for p in points {
        let row = rows.entry(p.ts_epoch).or_insert_with(|| {
            let mut m = serde_json::Map::new();
            m.insert("time".to_string(), json!(format_time(p.ts_epoch, fmt, unit)));
            m
        });
        row.insert(format!("tag{}", p.tag_id), point_value_json(p.value));
    }
    let mut out: Vec<Value> = rows.into_values().map(Value::Object).collect();
    if order == QueryOrder::Desc {
        out.reverse();
    }
    out
}

fn pivot_buckets(
    buckets: std::collections::HashMap<String, Vec<crate::query::engine::BucketValue>>,
    fmt: TimeFmt,
    unit: &TimestampUnit,
    order: QueryOrder,
) -> Vec<Value> {
    let mut rows: BTreeMap<i64, serde_json::Map<String, Value>> = BTreeMap::new();
    for (tag, vals) in buckets {
        for b in vals {
            if let Ok(ts) = b.bucket_start.parse::<i64>() {
                let row = rows.entry(ts).or_insert_with(|| {
                    let mut m = serde_json::Map::new();
                    m.insert("time".to_string(), json!(format_time(ts, fmt, unit)));
                    m
                });
                row.insert(format!("tag{}", tag), b.value);
            }
        }
    }
    let mut out: Vec<Value> = rows.into_values().map(Value::Object).collect();
    if order == QueryOrder::Desc {
        out.reverse();
    }
    out
}
