// Port of runtime/asset/AssetStoreIndex.ts. `asset_by_id` is the primary
// keyspace (mutated in place per write, same "Redis-inspired" principle as
// the TypeScript version), plus the same derived indexes for O(1) exact
// lookups. Kept as close to the original method-for-method as practical so
// the two implementations stay easy to compare/audit.

use crate::coerce::normalize_value_type;
use crate::path::{get_asset_path, matches, split_path};
use crate::schema::build_effective_attribute_map;
use crate::types::{
    AssetDefinition, AssetMatch, AssetSection, AttributeMatch, AttributeTemplate,
    EffectiveAttribute, HistorianTarget, QueryMatch,
};
use crate::values::{values_equal, values_loosely_equal};
use serde_json::{json, Value};
use std::collections::HashMap;

struct AssetPathEntry {
    asset_id: String,
    path: String,
    segments: Vec<String>,
}

struct ResolvedAttributeTarget {
    asset_id: String,
    attribute_name: String,
}

pub struct AttributeWriteResult {
    pub path: String,
    pub matches: Vec<AttributeMatch>,
}

pub struct AssetKeyspace {
    attribute_templates_list: Vec<AttributeTemplate>,
    historians_list: Vec<HistorianTarget>,
    template_by_id: HashMap<String, AttributeTemplate>,
    asset_by_id: HashMap<String, AssetDefinition>,
    asset_path_entries: Vec<AssetPathEntry>,
    asset_path_by_id: HashMap<String, String>,
    asset_by_path: HashMap<String, AssetDefinition>,
    attribute_map_by_asset_id: HashMap<String, HashMap<String, AttributeMatch>>,
    attribute_by_path: HashMap<String, AttributeMatch>,
    children_by_parent_id: HashMap<Option<String>, Vec<AssetDefinition>>,
}

impl AssetKeyspace {
    pub fn new(initial: AssetSection) -> Self {
        let mut ks = Self {
            attribute_templates_list: Vec::new(),
            historians_list: Vec::new(),
            template_by_id: HashMap::new(),
            asset_by_id: HashMap::new(),
            asset_path_entries: Vec::new(),
            asset_path_by_id: HashMap::new(),
            asset_by_path: HashMap::new(),
            attribute_map_by_asset_id: HashMap::new(),
            attribute_by_path: HashMap::new(),
            children_by_parent_id: HashMap::new(),
        };
        ks.rebuild_all_indexes(initial);
        ks
    }

    pub fn get_state(&self) -> AssetSection {
        AssetSection {
            assets: self.asset_by_id.values().cloned().collect(),
            attribute_templates: self.attribute_templates_list.clone(),
            historians: self.historians_list.clone(),
        }
    }

    pub fn get_historian_targets(&self) -> Vec<HistorianTarget> {
        self.historians_list.clone()
    }

    pub fn replace_state(&mut self, next: AssetSection) -> Vec<AttributeMatch> {
        let previous_attributes = std::mem::take(&mut self.attribute_by_path);
        self.rebuild_all_indexes(next);

        let mut changed = Vec::new();
        for (path, next_match) in &self.attribute_by_path {
            let previous = previous_attributes.get(path);
            if attribute_match_changed(previous, next_match) {
                changed.push(next_match.clone());
            }
        }
        changed
    }

    // ---- reads ----

    pub fn query(&self, path_value: &str) -> Vec<QueryMatch> {
        let normalized = path_value.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        let segments = split_path(normalized);
        if segments.is_empty() {
            return Vec::new();
        }
        let has_wildcard = segments.iter().any(|s| s == "*");
        if !has_wildcard {
            return self.query_exact_path(normalized);
        }

        let mut results = Vec::new();
        for entry in &self.asset_path_entries {
            if Self::matches_asset_path(&segments, entry) {
                if let Some(asset) = self.asset_by_id.get(&entry.asset_id) {
                    results.push(QueryMatch::Asset(AssetMatch {
                        kind: "asset",
                        path: entry.path.clone(),
                        asset_id: asset.id.clone(),
                        value: asset.clone(),
                    }));
                }
            }
            if !Self::matches_attribute_path_prefix(&segments, entry) {
                continue;
            }
            let attribute_pattern = segments.last().unwrap();
            for m in self.query_attributes_for_asset(&entry.asset_id, attribute_pattern) {
                results.push(QueryMatch::Attribute(m));
            }
        }
        results
    }

    pub fn get_attributes(&self, path_value: &str) -> Vec<AttributeMatch> {
        let normalized = path_value.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        if !normalized.contains('*') {
            return match self.attribute_by_path.get(normalized) {
                Some(m) => vec![m.clone()],
                None => Vec::new(),
            };
        }
        self.query(normalized)
            .into_iter()
            .filter_map(|m| match m {
                QueryMatch::Attribute(a) => Some(a),
                QueryMatch::Asset(_) => None,
            })
            .collect()
    }

    pub fn find_attributes_by_value(
        &self,
        path_value: &str,
        expected_value: &Value,
        strict: bool,
    ) -> Value {
        let found: Vec<AttributeMatch> = self
            .get_attributes(path_value)
            .into_iter()
            .filter(|item| {
                if strict {
                    values_equal(&item.value, expected_value)
                } else {
                    values_loosely_equal(&item.value, expected_value)
                }
            })
            .collect();

        let mut assets_map: Vec<(String, String)> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for item in &found {
            if seen.contains(&item.asset_id) {
                continue;
            }
            seen.insert(item.asset_id.clone());
            let path = self
                .asset_path_by_id
                .get(&item.asset_id)
                .cloned()
                .unwrap_or_else(|| {
                    let segs = split_path(&item.path);
                    if segs.is_empty() {
                        String::new()
                    } else {
                        segs[..segs.len() - 1].join(".")
                    }
                });
            assets_map.push((item.asset_id.clone(), path));
        }

        json!({
            "path": path_value,
            "expectedValue": expected_value,
            "strict": strict,
            "count": found.len(),
            "assetCount": assets_map.len(),
            "matches": found,
            "assets": assets_map.iter().map(|(asset_id, path)| json!({"assetId": asset_id, "path": path})).collect::<Vec<_>>()
        })
    }

    pub fn get_hierarchy(&self, populate_attributes: bool) -> Value {
        let roots = self.children_by_parent_id.get(&None).cloned().unwrap_or_default();
        Value::Array(roots.iter().map(|a| self.build_hierarchy_node(a, populate_attributes)).collect())
    }

    fn build_hierarchy_node(&self, asset: &AssetDefinition, populate_attributes: bool) -> Value {
        let children = self
            .children_by_parent_id
            .get(&Some(asset.id.clone()))
            .cloned()
            .unwrap_or_default();
        let children_json: Vec<Value> = children
            .iter()
            .map(|c| self.build_hierarchy_node(c, populate_attributes))
            .collect();
        let path = self.asset_path_by_id.get(&asset.id).cloned().unwrap_or_default();

        let mut node = json!({
            "id": asset.id,
            "name": asset.name,
            "path": path,
            "parentId": asset.parent_id,
            "templateIds": asset.template_ids,
            "attributes": asset.attributes,
            "children": children_json
        });

        if populate_attributes {
            let mut effective: Vec<Value> = self
                .attribute_map_by_asset_id
                .get(&asset.id)
                .map(|m| m.values().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
                .into_iter()
                .map(|attr| {
                    let source = if asset.attributes.contains_key(&attr.attribute_name) {
                        "override"
                    } else {
                        "template"
                    };
                    json!({
                        "name": attr.attribute_name,
                        "value": attr.value,
                        "valueType": attr.value_type,
                        "unit": attr.unit,
                        "ts": attr.ts,
                        "historianEnabled": attr.historian_enabled,
                        "historianTimeSourcePath": attr.historian_time_source_path,
                        "historianTargetId": attr.historian_target_id,
                        "source": source
                    })
                })
                .collect();
            effective.sort_by(|a, b| {
                a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
            });
            node["effectiveAttributes"] = Value::Array(effective);
        }

        node
    }

    fn query_exact_path(&self, normalized_path: &str) -> Vec<QueryMatch> {
        if let Some(asset) = self.asset_by_path.get(normalized_path) {
            return vec![QueryMatch::Asset(AssetMatch {
                kind: "asset",
                path: normalized_path.to_string(),
                asset_id: asset.id.clone(),
                value: asset.clone(),
            })];
        }
        match self.attribute_by_path.get(normalized_path) {
            Some(m) => vec![QueryMatch::Attribute(m.clone())],
            None => Vec::new(),
        }
    }

    fn matches_asset_path(query_segments: &[String], entry: &AssetPathEntry) -> bool {
        query_segments.len() == entry.segments.len()
            && query_segments
                .iter()
                .zip(entry.segments.iter())
                .all(|(q, e)| matches(q, e))
    }

    fn matches_attribute_path_prefix(query_segments: &[String], entry: &AssetPathEntry) -> bool {
        if query_segments.len() != entry.segments.len() + 1 {
            return false;
        }
        query_segments[..query_segments.len() - 1]
            .iter()
            .zip(entry.segments.iter())
            .all(|(q, e)| matches(q, e))
    }

    fn query_attributes_for_asset(&self, asset_id: &str, attribute_pattern: &str) -> Vec<AttributeMatch> {
        let attributes = match self.attribute_map_by_asset_id.get(asset_id) {
            Some(m) => m,
            None => return Vec::new(),
        };
        attributes
            .iter()
            .filter(|(name, _)| matches(attribute_pattern, name))
            .map(|(_, m)| m.clone())
            .collect()
    }

    // ---- writes ----

    pub fn set_attribute(&mut self, path_value: &str, value: Value) -> Vec<AttributeMatch> {
        let mut results = self.set_attributes(vec![(path_value.to_string(), value)]);
        results.pop().map(|r| r.matches).unwrap_or_default()
    }

    pub fn set_attributes(&mut self, items: Vec<(String, Value)>) -> Vec<AttributeWriteResult> {
        let write_requests: Vec<(String, Value, Vec<ResolvedAttributeTarget>)> = items
            .into_iter()
            .map(|(path, value)| {
                let targets = self.resolve_targets(&path);
                (path, value, targets)
            })
            .collect();

        if write_requests.is_empty() {
            return Vec::new();
        }

        let mut writes_by_asset: HashMap<String, HashMap<String, Value>> = HashMap::new();
        let timestamp = now_iso();
        for (_, value, targets) in &write_requests {
            for target in targets {
                writes_by_asset
                    .entry(target.asset_id.clone())
                    .or_default()
                    .insert(
                        target.attribute_name.clone(),
                        json!({"value": value, "ts": timestamp}),
                    );
            }
        }

        if writes_by_asset.is_empty() {
            return write_requests
                .into_iter()
                .map(|(path, _, _)| AttributeWriteResult { path, matches: Vec::new() })
                .collect();
        }

        for (asset_id, attribute_writes) in writes_by_asset {
            let current = match self.asset_by_id.get(&asset_id) {
                Some(a) => a.clone(),
                None => continue,
            };
            let mut next_attributes = current.attributes.clone();
            for (name, val) in attribute_writes {
                next_attributes.insert(name, val);
            }
            let updated = AssetDefinition {
                attributes: next_attributes,
                ..current
            };
            self.refresh_asset_indexes(updated);
        }

        // collect + build results
        let mut changed_by_target: HashMap<String, AttributeMatch> = HashMap::new();
        for (_, _, targets) in &write_requests {
            for target in targets {
                let asset_path = match self.asset_path_by_id.get(&target.asset_id) {
                    Some(p) => p,
                    None => continue,
                };
                let key = format!("{}.{}", asset_path, target.attribute_name);
                if let Some(m) = self.attribute_by_path.get(&key) {
                    changed_by_target.insert(target_key(&target.asset_id, &target.attribute_name), m.clone());
                }
            }
        }

        write_requests
            .into_iter()
            .map(|(path, _, targets)| {
                let matches: Vec<AttributeMatch> = targets
                    .iter()
                    .filter_map(|t| changed_by_target.get(&target_key(&t.asset_id, &t.attribute_name)).cloned())
                    .collect();
                AttributeWriteResult { path, matches }
            })
            .collect()
    }

    fn resolve_targets(&self, path_value: &str) -> Vec<ResolvedAttributeTarget> {
        let normalized = path_value.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        if !normalized.contains('*') {
            if let Some(direct) = self.attribute_by_path.get(normalized) {
                return vec![ResolvedAttributeTarget {
                    asset_id: direct.asset_id.clone(),
                    attribute_name: direct.attribute_name.clone(),
                }];
            }
        }

        let segments = split_path(normalized);
        if segments.len() < 2 {
            return Vec::new();
        }
        let attribute_pattern = segments.last().unwrap();
        if attribute_pattern.is_empty() {
            return Vec::new();
        }
        let asset_pattern_segments = &segments[..segments.len() - 1];

        let mut targets = Vec::new();
        for entry in &self.asset_path_entries {
            if entry.segments.len() != asset_pattern_segments.len() {
                continue;
            }
            if !asset_pattern_segments
                .iter()
                .zip(entry.segments.iter())
                .all(|(s, e)| matches(s, e))
            {
                continue;
            }
            let attribute_map = match self.attribute_map_by_asset_id.get(&entry.asset_id) {
                Some(m) => m,
                None => continue,
            };
            if attribute_pattern == "*" {
                for name in attribute_map.keys() {
                    targets.push(ResolvedAttributeTarget {
                        asset_id: entry.asset_id.clone(),
                        attribute_name: name.clone(),
                    });
                }
                continue;
            }
            if attribute_map.contains_key(attribute_pattern) {
                targets.push(ResolvedAttributeTarget {
                    asset_id: entry.asset_id.clone(),
                    attribute_name: attribute_pattern.clone(),
                });
            }
        }
        targets
    }

    fn refresh_asset_indexes(&mut self, updated: AssetDefinition) {
        self.asset_by_id.insert(updated.id.clone(), updated.clone());
        let asset_path = self.asset_path_by_id.get(&updated.id).cloned().unwrap_or_default();
        self.asset_by_path.insert(asset_path.clone(), updated.clone());
        self.rebuild_attribute_index_for_asset(&updated, &asset_path);
    }

    // ---- index (re)building ----

    fn rebuild_all_indexes(&mut self, section: AssetSection) {
        self.attribute_templates_list = section.attribute_templates;
        self.historians_list = section.historians;
        self.template_by_id = self
            .attribute_templates_list
            .iter()
            .map(|t| (t.id.clone(), t.clone()))
            .collect();
        self.asset_by_id = section
            .assets
            .into_iter()
            .map(|a| (a.id.clone(), a))
            .collect();
        self.asset_path_entries = Vec::new();
        self.asset_path_by_id = HashMap::new();
        self.asset_by_path = HashMap::new();
        self.attribute_map_by_asset_id = HashMap::new();
        self.attribute_by_path = HashMap::new();
        self.children_by_parent_id = HashMap::new();

        for asset in self.asset_by_id.values() {
            self.children_by_parent_id
                .entry(asset.parent_id.clone())
                .or_default()
                .push(asset.clone());
        }
        for siblings in self.children_by_parent_id.values_mut() {
            siblings.sort_by(|a, b| a.name.cmp(&b.name));
        }

        let ids: Vec<String> = self.asset_by_id.keys().cloned().collect();
        for id in &ids {
            let path = get_asset_path(id, &self.asset_by_id);
            let segments = split_path(&path);
            self.asset_path_entries.push(AssetPathEntry {
                asset_id: id.clone(),
                path: path.clone(),
                segments,
            });
            self.asset_path_by_id.insert(id.clone(), path.clone());
            if let Some(asset) = self.asset_by_id.get(id) {
                self.asset_by_path.insert(path, asset.clone());
            }
        }

        for id in &ids {
            let path = self.asset_path_by_id.get(id).cloned().unwrap_or_default();
            if let Some(asset) = self.asset_by_id.get(id).cloned() {
                self.rebuild_attribute_index_for_asset(&asset, &path);
            }
        }
    }

    fn rebuild_attribute_index_for_asset(&mut self, asset: &AssetDefinition, asset_path: &str) {
        if let Some(previous_map) = self.attribute_map_by_asset_id.get(&asset.id) {
            for previous in previous_map.values() {
                self.attribute_by_path.remove(&previous.path);
            }
        }

        let effective = build_effective_attribute_map(asset, &self.template_by_id);
        let mut next_map: HashMap<String, AttributeMatch> = HashMap::new();
        for (attribute_name, attribute) in effective {
            let m = to_attribute_match(&asset.id, asset_path, &attribute_name, &attribute);
            self.attribute_by_path.insert(m.path.clone(), m.clone());
            next_map.insert(attribute_name, m);
        }
        self.attribute_map_by_asset_id.insert(asset.id.clone(), next_map);
    }
}

fn to_attribute_match(
    asset_id: &str,
    asset_path: &str,
    attribute_name: &str,
    attribute: &EffectiveAttribute,
) -> AttributeMatch {
    AttributeMatch {
        kind: "attribute",
        path: format!("{}.{}", asset_path, attribute_name),
        asset_id: asset_id.to_string(),
        attribute_name: attribute_name.to_string(),
        value: attribute.value.clone(),
        ts: attribute.ts.clone(),
        value_type: if attribute.value_type.is_empty() {
            "custom".to_string()
        } else {
            normalize_value_type(&attribute.value_type)
        },
        unit: attribute.unit.clone(),
        historian_enabled: attribute.historian_enabled,
        historian_time_source_path: attribute.historian_time_source_path.clone(),
        historian_target_id: if attribute.historian_target_id.is_empty() {
            "default".to_string()
        } else {
            attribute.historian_target_id.clone()
        },
    }
}

fn target_key(asset_id: &str, attribute_name: &str) -> String {
    format!("{}:{}", asset_id, attribute_name)
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    // RFC3339-ish millisecond timestamp, same shape as JS `new Date().toISOString()`.
    let millis = now.as_millis() as i64;
    format_iso_from_millis(millis)
}

fn format_iso_from_millis(millis: i64) -> String {
    // Minimal, dependency-free UTC ISO-8601 formatter (no chrono needed for
    // this one call site). Days-since-epoch civil calendar conversion
    // (Howard Hinnant's algorithm).
    let secs_total = millis.div_euclid(1000);
    let ms = millis.rem_euclid(1000);
    let days = secs_total.div_euclid(86400);
    let secs_of_day = secs_total.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, m, d, hh, mm, ss, ms)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn attribute_match_changed(previous: Option<&AttributeMatch>, next: &AttributeMatch) -> bool {
    let previous = match previous {
        Some(p) => p,
        None => return true,
    };
    if !values_equal(&previous.value, &next.value) {
        return true;
    }
    if previous.ts != next.ts {
        return true;
    }
    if previous.value_type != next.value_type {
        return true;
    }
    if previous.unit != next.unit {
        return true;
    }
    if previous.historian_enabled != next.historian_enabled {
        return true;
    }
    if previous.historian_time_source_path != next.historian_time_source_path {
        return true;
    }
    if previous.historian_target_id != next.historian_target_id {
        return true;
    }
    false
}
