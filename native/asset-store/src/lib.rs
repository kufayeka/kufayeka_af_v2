#![deny(clippy::all)]

mod coerce;
mod keyspace;
mod path;
mod schema;
mod types;
mod values;

use keyspace::AssetKeyspace;
use napi_derive::napi;
use serde_json::{json, Value};
use types::AssetSection;

fn parse_section(value: Value) -> AssetSection {
    serde_json::from_value(value).unwrap_or_default()
}

/// Native (Rust) backing store for the asset keyspace -- everything crosses
/// the JS<->Rust boundary as JSON (`serde_json::Value`), matching what Phase
/// 0's feasibility probe validated. Notification/subscribe stays entirely on
/// the TypeScript side (RustAssetStore.ts), mirroring how AssetStoreIndex vs
/// AssetStoreFactory already split those responsibilities in the pure-TS
/// implementation -- this class only owns read/write/query on the keyspace.
#[napi]
pub struct RustAssetKeyspace {
    inner: AssetKeyspace,
}

#[napi]
impl RustAssetKeyspace {
    #[napi(constructor)]
    pub fn new(initial_state: Value) -> Self {
        Self {
            inner: AssetKeyspace::new(parse_section(initial_state)),
        }
    }

    #[napi]
    pub fn get_state(&self) -> Value {
        serde_json::to_value(self.inner.get_state()).unwrap_or(json!({}))
    }

    #[napi]
    pub fn get_historian_targets(&self) -> Value {
        serde_json::to_value(self.inner.get_historian_targets()).unwrap_or(json!([]))
    }

    #[napi]
    pub fn replace_state(&mut self, next_state: Value) -> Value {
        let changed = self.inner.replace_state(parse_section(next_state));
        serde_json::to_value(changed).unwrap_or(json!([]))
    }

    #[napi]
    pub fn query(&self, path_value: String) -> Value {
        serde_json::to_value(self.inner.query(&path_value)).unwrap_or(json!([]))
    }

    #[napi]
    pub fn get_attributes(&self, path_value: String) -> Value {
        serde_json::to_value(self.inner.get_attributes(&path_value)).unwrap_or(json!([]))
    }

    #[napi]
    pub fn find_attributes_by_value(&self, path_value: String, expected_value: Value, strict: bool) -> Value {
        self.inner.find_attributes_by_value(&path_value, &expected_value, strict)
    }

    #[napi]
    pub fn get_hierarchy(&self, populate_attributes: bool) -> Value {
        self.inner.get_hierarchy(populate_attributes)
    }

    #[napi]
    pub fn set_attribute(&mut self, path_value: String, value: Value) -> Value {
        serde_json::to_value(self.inner.set_attribute(&path_value, value)).unwrap_or(json!([]))
    }

    /// `items` is a JSON array of `{ path, value }` objects, matching what
    /// AssetStore.setAttributes() takes on the TS side.
    #[napi]
    pub fn set_attributes(&mut self, items: Value) -> Value {
        let parsed: Vec<(String, Value)> = match items {
            Value::Array(arr) => arr
                .into_iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    let path = obj.get("path")?.as_str()?.to_string();
                    let value = obj.get("value")?.clone();
                    Some((path, value))
                })
                .collect(),
            _ => Vec::new(),
        };
        let results = self.inner.set_attributes(parsed);
        Value::Array(
            results
                .into_iter()
                .map(|r| {
                    json!({
                        "path": r.path,
                        "count": r.matches.len(),
                        "matches": r.matches
                    })
                })
                .collect(),
        )
    }
}
