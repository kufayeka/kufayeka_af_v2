// Exact port of runtime/asset/assetDataUtils.ts's normalizeValueType /
// defaultValueForType / coerceAttributeValue. Keep this in lockstep with
// that file -- any behavior drift here breaks correctness parity with the
// TypeScript implementation (the whole point of Phase 2's stress test).

use serde_json::{json, Value};

const KNOWN_TYPES: &[&str] = &[
    "int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64", "boolean",
    "string", "array", "object",
];

pub fn normalize_value_type(raw_type: &str) -> String {
    if KNOWN_TYPES.contains(&raw_type) {
        return raw_type.to_string();
    }
    if raw_type == "number" {
        return "float64".to_string();
    }
    "string".to_string()
}

pub fn default_value_for_type(value_type: &str) -> Value {
    match value_type {
        "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64" => {
            json!(0)
        }
        "boolean" => json!(false),
        "array" => json!([]),
        "object" => json!({}),
        _ => json!(""),
    }
}

fn value_to_finite_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64().filter(|v| v.is_finite()),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|v| v.is_finite()),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

pub struct CoerceOptions {
    pub default_value: Option<Value>,
    pub nullable: bool,
}

impl Default for CoerceOptions {
    fn default() -> Self {
        Self {
            default_value: None,
            nullable: false,
        }
    }
}

/// Mirrors `coerceAttributeValue(valueType, value, options)` from
/// assetDataUtils.ts field-for-field, including its slightly odd JS
/// fallback semantics (e.g. `Number(fallback || 0)`).
pub fn coerce_attribute_value(value_type: &str, value: Option<&Value>, options: &CoerceOptions) -> Value {
    let fallback = options
        .default_value
        .clone()
        .unwrap_or_else(|| default_value_for_type(value_type));

    let is_nullish = value.is_none() || matches!(value, Some(Value::Null));
    let source: Value = if is_nullish {
        if options.nullable {
            Value::Null
        } else {
            fallback.clone()
        }
    } else {
        value.cloned().unwrap()
    };

    if source.is_null() {
        return Value::Null;
    }

    match value_type {
        "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" => {
            let parsed = value_to_finite_f64(&source);
            let rounded = match parsed {
                Some(p) => p.trunc(),
                None => {
                    // `Number(fallback || 0)` -- JS falsy fallback (0, "", false, null all
                    // count as falsy) collapses to 0 here.
                    let fallback_num = value_to_finite_f64(&fallback).unwrap_or(0.0);
                    return if fallback_num == 0.0 {
                        json!(0)
                    } else {
                        json!(fallback_num.trunc())
                    };
                }
            };
            if value_type.starts_with('u') {
                json!(rounded.max(0.0))
            } else {
                json!(rounded)
            }
        }
        "float32" | "float64" => {
            match value_to_finite_f64(&source) {
                Some(p) => json!(p),
                None => {
                    let fallback_num = value_to_finite_f64(&fallback).unwrap_or(0.0);
                    json!(fallback_num)
                }
            }
        }
        "boolean" => match &source {
            Value::Bool(b) => json!(*b),
            Value::Number(n) => json!(n.as_f64().map(|v| v != 0.0).unwrap_or(false)),
            other => {
                let normalized = value_as_display_string(other).trim().to_lowercase();
                if ["true", "1", "yes", "on"].contains(&normalized.as_str()) {
                    json!(true)
                } else if ["false", "0", "no", "off", ""].contains(&normalized.as_str()) {
                    json!(false)
                } else {
                    json!(matches!(fallback, Value::Bool(true)))
                }
            }
        },
        "array" => {
            if source.is_array() {
                source
            } else if fallback.is_array() {
                fallback
            } else {
                json!([])
            }
        }
        "object" => {
            if source.is_object() {
                source
            } else if fallback.is_object() {
                fallback
            } else {
                json!({})
            }
        }
        _ => json!(value_as_display_string(&source)),
    }
}

/// Mirrors JS's implicit `String(x)` coercion closely enough for our
/// purposes (numbers/strings/bools -- the only shapes coerceAttributeValue's
/// string branch realistically sees for well-formed attribute values).
fn value_as_display_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}
