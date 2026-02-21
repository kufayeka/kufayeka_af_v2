use anyhow::{bail, Result};

use crate::types::{Point, PointValue, ValueTypeCode};

pub const SEGMENT_HEADER_SIZE: usize = 17;
pub const BLOCK_INDEX_ENTRY_SIZE: usize = 44;

#[derive(Debug, Clone)]
pub struct BlockIndexEntry {
    pub min_ts: i64,
    pub max_ts: i64,
    pub byte_offset_start: u64,
    pub byte_offset_end: u64,
    pub point_count: u32,
    pub min_tag_id: u32,
    pub max_tag_id: u32,
}

pub fn encode_udp_batch(points: &[Point]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + points.len() * 24);
    out.extend_from_slice(&(points.len() as u32).to_le_bytes());
    for p in points {
        out.extend_from_slice(&p.tag_id.to_le_bytes());
        out.extend_from_slice(&p.ts_epoch.to_le_bytes());
        out.push(p.type_code as u8);
        match (&p.value, p.type_code.fixed_size()) {
            (PointValue::Num(v), Some(1)) => out.push(*v as u8),
            (PointValue::Num(v), Some(2)) => out.extend_from_slice(&(*v as i16).to_le_bytes()),
            (PointValue::Num(v), Some(4)) => {
                if p.type_code == ValueTypeCode::Float32 {
                    out.extend_from_slice(&(*v as f32).to_le_bytes());
                } else {
                    out.extend_from_slice(&(*v as i32).to_le_bytes());
                }
            }
            (PointValue::Num(v), Some(8)) => out.extend_from_slice(&(*v).to_le_bytes()),
            (PointValue::Str(s), None) => {
                out.extend_from_slice(&(s.len() as u32).to_le_bytes());
                out.extend_from_slice(s.as_bytes());
            }
            _ => {}
        }
    }
    out
}

pub fn decode_udp_batch(packet: &[u8]) -> Result<Vec<Point>> {
    if packet.len() < 4 {
        bail!("packet too short");
    }
    let count = u32::from_le_bytes(packet[0..4].try_into().unwrap()) as usize;
    let mut offset = 4usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if offset + 13 > packet.len() {
            bail!("incomplete point header");
        }
        let tag_id = u32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap());
        offset += 4;
        let ts_epoch = i64::from_le_bytes(packet[offset..offset + 8].try_into().unwrap());
        offset += 8;
        let type_code = ValueTypeCode::from_u8(packet[offset]).ok_or_else(|| anyhow::anyhow!("bad type code"))?;
        offset += 1;
        let value = match type_code.fixed_size() {
            Some(1) => PointValue::Num(packet[offset] as i8 as f64),
            Some(2) => {
                let v = i16::from_le_bytes(packet[offset..offset + 2].try_into().unwrap());
                offset += 2;
                PointValue::Num(v as f64)
            }
            Some(4) => {
                if type_code == ValueTypeCode::Float32 {
                    let v = f32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap());
                    offset += 4;
                    PointValue::Num(v as f64)
                } else {
                    let v = i32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap());
                    offset += 4;
                    PointValue::Num(v as f64)
                }
            }
            Some(8) => {
                let v = f64::from_le_bytes(packet[offset..offset + 8].try_into().unwrap());
                offset += 8;
                PointValue::Num(v)
            }
            None => {
                if offset + 4 > packet.len() {
                    bail!("incomplete str len");
                }
                let len = u32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap()) as usize;
                offset += 4;
                if offset + len > packet.len() {
                    bail!("incomplete str payload");
                }
                let s = String::from_utf8_lossy(&packet[offset..offset + len]).to_string();
                offset += len;
                PointValue::Str(s)
            }
            _ => unreachable!(),
        };
        if type_code.fixed_size() == Some(1) {
            offset += 1;
        }
        out.push(Point {
            tag_id,
            ts_epoch,
            type_code,
            value,
        });
    }
    Ok(out)
}

pub fn encode_segment_record(p: &Point) -> Vec<u8> {
    let mut out = Vec::with_capacity(32);
    out.extend_from_slice(&p.tag_id.to_le_bytes());
    out.extend_from_slice(&p.ts_epoch.to_le_bytes());
    out.push(p.type_code as u8);
    match (&p.value, p.type_code.fixed_size()) {
        (PointValue::Num(v), Some(1)) => {
            out.extend_from_slice(&0u32.to_le_bytes());
            out.push(*v as i8 as u8);
        }
        (PointValue::Num(v), Some(2)) => {
            out.extend_from_slice(&0u32.to_le_bytes());
            out.extend_from_slice(&(*v as i16).to_le_bytes());
        }
        (PointValue::Num(v), Some(4)) => {
            out.extend_from_slice(&0u32.to_le_bytes());
            if p.type_code == ValueTypeCode::Float32 {
                out.extend_from_slice(&(*v as f32).to_le_bytes());
            } else {
                out.extend_from_slice(&(*v as i32).to_le_bytes());
            }
        }
        (PointValue::Num(v), Some(8)) => {
            out.extend_from_slice(&0u32.to_le_bytes());
            out.extend_from_slice(&(*v).to_le_bytes());
        }
        (PointValue::Str(s), None) => {
            out.extend_from_slice(&(s.len() as u32).to_le_bytes());
            out.extend_from_slice(s.as_bytes());
        }
        _ => {
            out.extend_from_slice(&0u32.to_le_bytes());
        }
    }
    out
}

pub fn decode_segment_record(buf: &[u8], offset: usize) -> Option<(Point, usize)> {
    if offset + SEGMENT_HEADER_SIZE > buf.len() {
        return None;
    }
    let tag_id = u32::from_le_bytes(buf[offset..offset + 4].try_into().ok()?);
    let ts_epoch = i64::from_le_bytes(buf[offset + 4..offset + 12].try_into().ok()?);
    let type_code = ValueTypeCode::from_u8(buf[offset + 12])?;
    let value_len = u32::from_le_bytes(buf[offset + 13..offset + 17].try_into().ok()?) as usize;
    let payload_len = type_code.fixed_size().unwrap_or(value_len);
    let total = SEGMENT_HEADER_SIZE + payload_len;
    if offset + total > buf.len() {
        return None;
    }
    let payload = &buf[offset + SEGMENT_HEADER_SIZE..offset + total];
    let value = match type_code.fixed_size() {
        Some(1) => PointValue::Num(payload[0] as i8 as f64),
        Some(2) => PointValue::Num(i16::from_le_bytes(payload.try_into().ok()?) as f64),
        Some(4) => {
            if type_code == ValueTypeCode::Float32 {
                PointValue::Num(f32::from_le_bytes(payload.try_into().ok()?) as f64)
            } else {
                PointValue::Num(i32::from_le_bytes(payload.try_into().ok()?) as f64)
            }
        }
        Some(8) => PointValue::Num(f64::from_le_bytes(payload.try_into().ok()?)),
        None => PointValue::Str(String::from_utf8_lossy(payload).to_string()),
        _ => return None,
    };
    Some((
        Point {
            tag_id,
            ts_epoch,
            type_code,
            value,
        },
        total,
    ))
}

pub fn encode_block_index_entry(e: &BlockIndexEntry) -> [u8; BLOCK_INDEX_ENTRY_SIZE] {
    let mut out = [0u8; BLOCK_INDEX_ENTRY_SIZE];
    out[0..8].copy_from_slice(&e.min_ts.to_le_bytes());
    out[8..16].copy_from_slice(&e.max_ts.to_le_bytes());
    out[16..24].copy_from_slice(&e.byte_offset_start.to_le_bytes());
    out[24..32].copy_from_slice(&e.byte_offset_end.to_le_bytes());
    out[32..36].copy_from_slice(&e.point_count.to_le_bytes());
    out[36..40].copy_from_slice(&e.min_tag_id.to_le_bytes());
    out[40..44].copy_from_slice(&e.max_tag_id.to_le_bytes());
    out
}

pub fn decode_block_index(buf: &[u8]) -> Vec<BlockIndexEntry> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + BLOCK_INDEX_ENTRY_SIZE <= buf.len() {
        out.push(BlockIndexEntry {
            min_ts: i64::from_le_bytes(buf[off..off + 8].try_into().unwrap()),
            max_ts: i64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap()),
            byte_offset_start: u64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap()),
            byte_offset_end: u64::from_le_bytes(buf[off + 24..off + 32].try_into().unwrap()),
            point_count: u32::from_le_bytes(buf[off + 32..off + 36].try_into().unwrap()),
            min_tag_id: u32::from_le_bytes(buf[off + 36..off + 40].try_into().unwrap()),
            max_tag_id: u32::from_le_bytes(buf[off + 40..off + 44].try_into().unwrap()),
        });
        off += BLOCK_INDEX_ENTRY_SIZE;
    }
    out
}
