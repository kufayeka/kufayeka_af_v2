#![deny(clippy::all)]

use napi_derive::napi;
use std::collections::HashMap;

/// Phase 0 feasibility probe: intentionally as dumb as possible (a plain
/// HashMap, no asset-domain logic at all). The only thing this exists to
/// measure is the pure JS<->Rust crossing cost of a napi-rs call, compared
/// against an equivalent plain `Map` in JS. It is NOT meant to be kept --
/// Phase 1 replaces this with the real AssetStoreIndex port, once this
/// number proves the approach is worth pursuing.
#[napi]
pub struct FfiBenchStore {
    inner: HashMap<String, serde_json::Value>,
}

#[napi]
impl FfiBenchStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: HashMap::new(),
        }
    }

    #[napi]
    pub fn set(&mut self, key: String, value: serde_json::Value) {
        self.inner.insert(key, value);
    }

    #[napi]
    pub fn get(&self, key: String) -> Option<serde_json::Value> {
        self.inner.get(&key).cloned()
    }

    #[napi]
    pub fn len(&self) -> u32 {
        self.inner.len() as u32
    }
}

impl Default for FfiBenchStore {
    fn default() -> Self {
        Self::new()
    }
}
