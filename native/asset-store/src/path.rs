// Port of the path helpers in runtime/asset/assetDataUtils.ts. `matches` is
// intentionally this simple in the TS original too -- exact match or a
// single-segment `*` wildcard, no glob/regex.

use crate::types::AssetDefinition;
use std::collections::HashMap;

pub fn split_path(path_value: &str) -> Vec<String> {
    path_value
        .split('.')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

pub fn matches(pattern: &str, value: &str) -> bool {
    pattern == "*" || pattern == value
}

pub fn get_asset_path(asset_id: &str, asset_by_id: &HashMap<String, AssetDefinition>) -> String {
    let asset = match asset_by_id.get(asset_id) {
        Some(a) => a,
        None => return String::new(),
    };
    let mut parts: Vec<String> = vec![asset.name.clone()];
    let mut parent_id = asset.parent_id.clone();
    while let Some(pid) = parent_id {
        match asset_by_id.get(&pid) {
            Some(parent) => {
                parts.insert(0, parent.name.clone());
                parent_id = parent.parent_id.clone();
            }
            None => break,
        }
    }
    parts.join(".")
}
