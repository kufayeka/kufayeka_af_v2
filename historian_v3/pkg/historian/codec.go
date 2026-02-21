package historian

import (
	"encoding/binary"
	"errors"
	"math"
)

const (
	SegmentHeaderSize   = 17
	BlockIndexEntrySize = 44
)

type BlockIndexEntry struct {
	MinTs           int64
	MaxTs           int64
	ByteOffsetStart uint64
	ByteOffsetEnd   uint64
	PointCount      uint32
	MinTagID        uint32
	MaxTagID        uint32
}

func EncodeUDPBatch(points []Point) []byte {
	buf := make([]byte, 4)
	binary.LittleEndian.PutUint32(buf[:4], uint32(len(points)))
	for _, p := range points {
		buf = append(buf, encodeUDPPoint(p)...)
	}
	return buf
}

func encodeUDPPoint(p Point) []byte {
	out := make([]byte, 0, 32)
	tmp4 := make([]byte, 4)
	tmp8 := make([]byte, 8)
	binary.LittleEndian.PutUint32(tmp4, p.TagID)
	out = append(out, tmp4...)
	binary.LittleEndian.PutUint64(tmp8, uint64(p.TsEpoch))
	out = append(out, tmp8...)
	out = append(out, byte(p.TypeCode))
	out = appendTypedValue(out, p.TypeCode, p.Value, true)
	return out
}

func DecodeUDPBatch(packet []byte) ([]Point, error) {
	if len(packet) < 4 {
		return nil, errors.New("packet too short")
	}
	count := int(binary.LittleEndian.Uint32(packet[:4]))
	off := 4
	points := make([]Point, 0, count)
	for i := 0; i < count; i++ {
		if off+13 > len(packet) {
			return nil, errors.New("incomplete udp point header")
		}
		tag := binary.LittleEndian.Uint32(packet[off : off+4])
		off += 4
		ts := int64(binary.LittleEndian.Uint64(packet[off : off+8]))
		off += 8
		tc := ValueTypeCode(packet[off])
		off++
		val, n, err := decodeTypedValue(tc, packet[off:], true)
		if err != nil {
			return nil, err
		}
		off += n
		points = append(points, Point{TagID: tag, TsEpoch: ts, TypeCode: tc, Value: val})
	}
	return points, nil
}

func EncodeSegmentRecord(p Point) []byte {
	out := make([]byte, 0, 32)
	tmp4 := make([]byte, 4)
	tmp8 := make([]byte, 8)
	binary.LittleEndian.PutUint32(tmp4, p.TagID)
	out = append(out, tmp4...)
	binary.LittleEndian.PutUint64(tmp8, uint64(p.TsEpoch))
	out = append(out, tmp8...)
	out = append(out, byte(p.TypeCode))
	fixed := p.TypeCode.FixedSize()
	if fixed > 0 {
		binary.LittleEndian.PutUint32(tmp4, 0)
		out = append(out, tmp4...)
	} else {
		s := p.Value.(string)
		binary.LittleEndian.PutUint32(tmp4, uint32(len(s)))
		out = append(out, tmp4...)
	}
	out = appendTypedValue(out, p.TypeCode, p.Value, false)
	return out
}

func DecodeSegmentRecord(buf []byte, offset int) (*Point, int, bool) {
	if offset+SegmentHeaderSize > len(buf) {
		return nil, 0, false
	}
	tag := binary.LittleEndian.Uint32(buf[offset : offset+4])
	ts := int64(binary.LittleEndian.Uint64(buf[offset+4 : offset+12]))
	tc := ValueTypeCode(buf[offset+12])
	vlen := int(binary.LittleEndian.Uint32(buf[offset+13 : offset+17]))
	payloadLen := tc.FixedSize()
	if payloadLen < 0 {
		payloadLen = vlen
	}
	total := SegmentHeaderSize + payloadLen
	if offset+total > len(buf) {
		return nil, 0, false
	}
	v, n, err := decodeTypedValue(tc, buf[offset+17:offset+total], false)
	if err != nil || n != payloadLen {
		return nil, 0, false
	}
	return &Point{TagID: tag, TsEpoch: ts, TypeCode: tc, Value: v}, total, true
}

func EncodeBlockIndexEntry(e BlockIndexEntry) []byte {
	out := make([]byte, BlockIndexEntrySize)
	binary.LittleEndian.PutUint64(out[0:8], uint64(e.MinTs))
	binary.LittleEndian.PutUint64(out[8:16], uint64(e.MaxTs))
	binary.LittleEndian.PutUint64(out[16:24], e.ByteOffsetStart)
	binary.LittleEndian.PutUint64(out[24:32], e.ByteOffsetEnd)
	binary.LittleEndian.PutUint32(out[32:36], e.PointCount)
	binary.LittleEndian.PutUint32(out[36:40], e.MinTagID)
	binary.LittleEndian.PutUint32(out[40:44], e.MaxTagID)
	return out
}

func DecodeBlockIndex(buf []byte) []BlockIndexEntry {
	n := len(buf) / BlockIndexEntrySize
	out := make([]BlockIndexEntry, 0, n)
	for i := 0; i < n; i++ {
		off := i * BlockIndexEntrySize
		out = append(out, BlockIndexEntry{
			MinTs:           int64(binary.LittleEndian.Uint64(buf[off : off+8])),
			MaxTs:           int64(binary.LittleEndian.Uint64(buf[off+8 : off+16])),
			ByteOffsetStart: binary.LittleEndian.Uint64(buf[off+16 : off+24]),
			ByteOffsetEnd:   binary.LittleEndian.Uint64(buf[off+24 : off+32]),
			PointCount:      binary.LittleEndian.Uint32(buf[off+32 : off+36]),
			MinTagID:        binary.LittleEndian.Uint32(buf[off+36 : off+40]),
			MaxTagID:        binary.LittleEndian.Uint32(buf[off+40 : off+44]),
		})
	}
	return out
}

func appendTypedValue(dst []byte, tc ValueTypeCode, v any, udp bool) []byte {
	switch tc {
	case TypeInt8:
		return append(dst, byte(int8(toFloat(v))))
	case TypeUInt8:
		return append(dst, byte(uint8(toFloat(v))))
	case TypeInt16:
		b := make([]byte, 2)
		binary.LittleEndian.PutUint16(b, uint16(int16(toFloat(v))))
		return append(dst, b...)
	case TypeUInt16:
		b := make([]byte, 2)
		binary.LittleEndian.PutUint16(b, uint16(toFloat(v)))
		return append(dst, b...)
	case TypeInt32:
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, uint32(int32(toFloat(v))))
		return append(dst, b...)
	case TypeUInt32:
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, uint32(toFloat(v)))
		return append(dst, b...)
	case TypeFloat32:
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, math.Float32bits(float32(toFloat(v))))
		return append(dst, b...)
	case TypeFloat64:
		b := make([]byte, 8)
		binary.LittleEndian.PutUint64(b, math.Float64bits(toFloat(v)))
		return append(dst, b...)
	case TypeString:
		s, _ := v.(string)
		if udp {
			b := make([]byte, 4)
			binary.LittleEndian.PutUint32(b, uint32(len(s)))
			dst = append(dst, b...)
		}
		return append(dst, []byte(s)...)
	default:
		return dst
	}
}

func decodeTypedValue(tc ValueTypeCode, src []byte, udp bool) (any, int, error) {
	switch tc {
	case TypeInt8:
		if len(src) < 1 {
			return nil, 0, errors.New("bad int8")
		}
		return float64(int8(src[0])), 1, nil
	case TypeUInt8:
		if len(src) < 1 {
			return nil, 0, errors.New("bad uint8")
		}
		return float64(src[0]), 1, nil
	case TypeInt16:
		if len(src) < 2 {
			return nil, 0, errors.New("bad int16")
		}
		return float64(int16(binary.LittleEndian.Uint16(src[:2]))), 2, nil
	case TypeUInt16:
		if len(src) < 2 {
			return nil, 0, errors.New("bad uint16")
		}
		return float64(binary.LittleEndian.Uint16(src[:2])), 2, nil
	case TypeInt32:
		if len(src) < 4 {
			return nil, 0, errors.New("bad int32")
		}
		return float64(int32(binary.LittleEndian.Uint32(src[:4]))), 4, nil
	case TypeUInt32:
		if len(src) < 4 {
			return nil, 0, errors.New("bad uint32")
		}
		return float64(binary.LittleEndian.Uint32(src[:4])), 4, nil
	case TypeFloat32:
		if len(src) < 4 {
			return nil, 0, errors.New("bad float32")
		}
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(src[:4]))), 4, nil
	case TypeFloat64:
		if len(src) < 8 {
			return nil, 0, errors.New("bad float64")
		}
		return math.Float64frombits(binary.LittleEndian.Uint64(src[:8])), 8, nil
	case TypeString:
		if udp {
			if len(src) < 4 {
				return nil, 0, errors.New("bad str len")
			}
			l := int(binary.LittleEndian.Uint32(src[:4]))
			if len(src) < 4+l {
				return nil, 0, errors.New("bad str payload")
			}
			return string(src[4 : 4+l]), 4 + l, nil
		}
		return string(src), len(src), nil
	default:
		return nil, 0, errors.New("unknown type")
	}
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case uint64:
		return float64(n)
	case uint32:
		return float64(n)
	default:
		return 0
	}
}
