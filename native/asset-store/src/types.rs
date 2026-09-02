use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// Mirrors runtime/core/runtimeTypes.ts's AssetAttributeTemplate exactly
// (field-for-field), so serde's default camelCase rename matches the JSON
// shape the TypeScript side already produces/expects.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetAttributeTemplate {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub name: String,
    pub value_type: String,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub historian_enabled: bool,
    #[serde(default)]
    pub historian_time_source_path: String,
    #[serde(default = "default_target_id")]
    pub historian_target_id: String,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub number_allow_decimal: Option<bool>,
    #[serde(default)]
    pub number_precision: Option<f64>,
}

fn default_true() -> bool {
    true
}
fn default_target_id() -> String {
    "default".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributeTemplate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub attributes: Vec<AssetAttributeTemplate>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub template_ids: Vec<String>,
    #[serde(default)]
    pub attributes: HashMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorianTarget {
    pub id: String,
    pub name: String,
    pub timestamp_unit: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetSection {
    #[serde(default)]
    pub assets: Vec<AssetDefinition>,
    #[serde(default)]
    pub attribute_templates: Vec<AttributeTemplate>,
    #[serde(default)]
    pub historians: Vec<HistorianTarget>,
}

// Mirrors AttributeQueryMatch from runtimeTypes.ts -- what `query()`,
// `setAttribute()`, etc. return to the caller.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributeMatch {
    pub kind: &'static str, // always "attribute"
    pub path: String,
    pub asset_id: String,
    pub attribute_name: String,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<String>,
    #[serde(rename = "type")]
    pub value_type: String,
    pub unit: String,
    pub historian_enabled: bool,
    pub historian_time_source_path: String,
    pub historian_target_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMatch {
    pub kind: &'static str, // always "asset"
    pub path: String,
    pub asset_id: String,
    pub value: AssetDefinition,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum QueryMatch {
    Attribute(AttributeMatch),
    Asset(AssetMatch),
}

// The internal, effective (template + override, coerced) value of one
// attribute -- mirrors what AssetSchemaService.buildEffectiveAttributeMap
// produces per entry in its Map. `default_value`/`nullable` are only used
// internally while merging (they feed the second coercion pass for
// asset-level overrides); `toAttributeMatch`-equivalent output ignores them.
#[derive(Clone, Debug)]
pub struct EffectiveAttribute {
    pub value: Value,
    pub value_type: String,
    pub default_value: Value,
    pub nullable: bool,
    pub ts: Option<String>,
    pub unit: String,
    pub historian_enabled: bool,
    pub historian_time_source_path: String,
    pub historian_target_id: String,
}
