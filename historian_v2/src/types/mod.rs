use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum ValueTypeCode {
    Int8 = 1,
    UInt8 = 2,
    Int16 = 3,
    UInt16 = 4,
    Int32 = 5,
    UInt32 = 6,
    Float32 = 7,
    Float64 = 8,
    String = 9,
}

impl ValueTypeCode {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Int8),
            2 => Some(Self::UInt8),
            3 => Some(Self::Int16),
            4 => Some(Self::UInt16),
            5 => Some(Self::Int32),
            6 => Some(Self::UInt32),
            7 => Some(Self::Float32),
            8 => Some(Self::Float64),
            9 => Some(Self::String),
            _ => None,
        }
    }
    pub fn fixed_size(self) -> Option<usize> {
        match self {
            Self::Int8 | Self::UInt8 => Some(1),
            Self::Int16 | Self::UInt16 => Some(2),
            Self::Int32 | Self::UInt32 | Self::Float32 => Some(4),
            Self::Float64 => Some(8),
            Self::String => None,
        }
    }
    pub fn is_numeric(self) -> bool {
        self != Self::String
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PointValue {
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    #[serde(rename = "tagId")]
    pub tag_id: u32,
    #[serde(rename = "tsEpoch")]
    pub ts_epoch: i64,
    #[serde(rename = "typeCode")]
    pub type_code: ValueTypeCode,
    pub value: PointValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryOrder {
    Asc,
    Desc,
}

impl QueryOrder {
    pub fn from_str(v: Option<&str>) -> anyhow::Result<Self> {
        match v.unwrap_or("desc") {
            "asc" => Ok(Self::Asc),
            "desc" => Ok(Self::Desc),
            _ => anyhow::bail!("order must be asc|desc"),
        }
    }
}
