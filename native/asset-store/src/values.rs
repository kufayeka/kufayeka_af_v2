// Port of valuesEqual / valuesLooselyEqual from assetDataUtils.ts.
use serde_json::Value;

pub fn values_equal(left: &Value, right: &Value) -> bool {
    // serde_json::Number distinguishes integer- and float-kind storage
    // internally (e.g. a value coerced through our float64 path stores as
    // float-kind, while a plain JS integer arriving via napi-rs can arrive
    // int-kind) -- two Numbers holding the same mathematical value in
    // different kinds are NOT `==` under the derived PartialEq. JS's
    // `Object.is`/`===` has only one number type, so normalize via
    // `as_f64()` before comparing to match that semantics.
    if let (Value::Number(a), Value::Number(b)) = (left, right) {
        return a.as_f64() == b.as_f64();
    }
    left == right
}

fn as_f64_loose(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// Approximates JS's `==` loose equality for the scalar JSON shapes that
/// actually occur as attribute values (numbers/strings/booleans/null).
/// Object/array cases are already covered by `values_equal`'s structural
/// comparison and fall through to `false` here, matching the TS original's
/// JSON.stringify-based fallback closely enough for practical purposes.
pub fn values_loosely_equal(left: &Value, right: &Value) -> bool {
    if values_equal(left, right) {
        return true;
    }
    if left.is_object() || right.is_object() || left.is_array() || right.is_array() {
        return false;
    }
    if left.is_null() || right.is_null() {
        return left.is_null() && right.is_null();
    }
    match as_f64_loose(left).zip(as_f64_loose(right)) {
        Some((a, b)) => a == b,
        None => false,
    }
}
