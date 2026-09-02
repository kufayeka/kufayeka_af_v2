// Port of AssetSchemaService.buildEffectiveAttributeMap (runtime/asset/AssetSchemaService.ts).
// Same two-pass merge: template-declared attributes first (first template
// wins on name collision, matching the TS `if (!map.has(name))` guard),
// then asset-level attribute overrides layered on top.

use crate::coerce::{coerce_attribute_value, normalize_value_type, CoerceOptions};
use crate::types::{AssetDefinition, AttributeTemplate, EffectiveAttribute};
use serde_json::Value;
use std::collections::HashMap;

// Plain HashMap is fine here (not order-preserving): the one downstream
// consumer that cares about attribute ordering (getHierarchy's
// effectiveAttributes list) explicitly sorts by name anyway, matching the
// TS AssetStoreIndex.getHierarchy() implementation.
pub fn build_effective_attribute_map(
    asset: &AssetDefinition,
    template_by_id: &HashMap<String, AttributeTemplate>,
) -> HashMap<String, EffectiveAttribute> {
    let mut map: HashMap<String, EffectiveAttribute> = HashMap::new();

    for template_id in &asset.template_ids {
        let template = match template_by_id.get(template_id) {
            Some(t) => t,
            None => continue,
        };
        for attribute in &template.attributes {
            if !attribute.enabled {
                continue;
            }
            if map.contains_key(&attribute.name) {
                continue;
            }
            let default_value = attribute.default.clone().unwrap_or(Value::Null);
            let nullable = attribute.nullable;
            let value = coerce_attribute_value(
                &attribute.value_type,
                attribute.default.as_ref(),
                &CoerceOptions {
                    default_value: attribute.default.clone(),
                    nullable,
                },
            );
            map.insert(
                attribute.name.clone(),
                EffectiveAttribute {
                    value,
                    value_type: attribute.value_type.clone(),
                    default_value,
                    nullable,
                    ts: None,
                    unit: attribute.unit.clone(),
                    historian_enabled: attribute.historian_enabled,
                    historian_time_source_path: attribute.historian_time_source_path.clone(),
                    historian_target_id: attribute.historian_target_id.clone(),
                },
            );
        }
    }

    for (name, raw_val) in &asset.attributes {
        let item = raw_val.as_object();
        let existing = map.get(name);
        let value_type = existing
            .map(|e| e.value_type.clone())
            .unwrap_or_else(|| "string".to_string());
        let normalized_type = normalize_value_type(&value_type);
        let default_value = existing.map(|e| e.default_value.clone());
        let nullable = existing.map(|e| e.nullable).unwrap_or(false);

        let (coerce_source, ts) = if let Some(obj) = item {
            let has_value_key = obj.contains_key("value");
            let ts = obj.get("ts").map(|v| json_to_display_string(v));
            if has_value_key {
                (obj.get("value").cloned(), ts)
            } else {
                (Some(raw_val.clone()), ts)
            }
        } else {
            (Some(raw_val.clone()), None)
        };

        let value = coerce_attribute_value(
            &normalized_type,
            coerce_source.as_ref(),
            &CoerceOptions {
                default_value: default_value.clone(),
                nullable,
            },
        );

        let mut entry = existing.cloned().unwrap_or(EffectiveAttribute {
            value: Value::Null,
            value_type: normalized_type.clone(),
            default_value: Value::Null,
            nullable: false,
            ts: None,
            unit: String::new(),
            historian_enabled: false,
            historian_time_source_path: String::new(),
            historian_target_id: "default".to_string(),
        });
        entry.value = value;
        entry.ts = ts;
        map.insert(name.clone(), entry);
    }

    map
}

fn json_to_display_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
