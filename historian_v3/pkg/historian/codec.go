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
	total := 4
	for i := range points {
		total += udpPointSize(points[i])
	}
	buf := make([]byte, total)
	binary.LittleEndian.PutUint32(buf[:4], uint32(len(points)))
	off := 4
	for i := range points {
		off += encodeUDPPointTo(buf[off:], points[i])
	}
	return buf
}

func udpPointSize(p Point) int {
	size := 4 + 8 + 1
	switch p.TypeCode {
	case TypeInt8, TypeUInt8:
		return size + 1
	case TypeInt16, TypeUInt16:
		return size + 2
	case TypeInt32, TypeUInt32, TypeFloat32:
		return size + 4
	case TypeFloat64:
		return size + 8
	case TypeString:
		s, _ := p.Value.(string)
		return size + 4 + len(s)
	default:
		return size
	}
}

func encodeUDPPointTo(dst []byte, p Point) int {
	binary.LittleEndian.PutUint32(dst[0:4], p.TagID)
	binary.LittleEndian.PutUint64(dst[4:12], uint64(p.TsEpoch))
	dst[12] = byte(p.TypeCode)
	off := 13
	switch p.TypeCode {
	case TypeInt8:
		dst[off] = byte(int8(toFloat(p.Value)))
		return off + 1
	case TypeUInt8:
		dst[off] = byte(uint8(toFloat(p.Value)))
		return off + 1
	case TypeInt16:
		binary.LittleEndian.PutUint16(dst[off:off+2], uint16(int16(toFloat(p.Value))))
		return off + 2
	case TypeUInt16:
		binary.LittleEndian.PutUint16(dst[off:off+2], uint16(toFloat(p.Value)))
		return off + 2
	case TypeInt32:
		binary.LittleEndian.PutUint32(dst[off:off+4], uint32(int32(toFloat(p.Value))))
		return off + 4
	case TypeUInt32:
		binary.LittleEndian.PutUint32(dst[off:off+4], uint32(toFloat(p.Value)))
		return off + 4
	case TypeFloat32:
		binary.LittleEndian.PutUint32(dst[off:off+4], math.Float32bits(float32(toFloat(p.Value))))
		return off + 4
	case TypeFloat64:
		binary.LittleEndian.PutUint64(dst[off:off+8], math.Float64bits(toFloat(p.Value)))
		return off + 8
	case TypeString:
		s, _ := p.Value.(string)
		binary.LittleEndian.PutUint32(dst[off:off+4], uint32(len(s)))
		off += 4
		copy(dst[off:off+len(s)], s)
		return off + len(s)
	default:
		return off
	}
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
	rec := make([]byte, SegmentRecordSize(p))
	encodeSegmentRecordTo(rec, p)
	return rec
}

func SegmentRecordSize(p Point) int {
	fixed := p.TypeCode.FixedSize()
	if fixed > 0 {
		return SegmentHeaderSize + fixed
	}
	if p.TypeCode == TypeString {
		s, _ := p.Value.(string)
		return SegmentHeaderSize + len(s)
	}
	return SegmentHeaderSize
}

func encodeSegmentRecordTo(dst []byte, p Point) int {
	binary.LittleEndian.PutUint32(dst[0:4], p.TagID)
	binary.LittleEndian.PutUint64(dst[4:12], uint64(p.TsEpoch))
	dst[12] = byte(p.TypeCode)
	off := SegmentHeaderSize
	switch p.TypeCode {
	case TypeInt8:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		dst[off] = byte(int8(toFloat(p.Value)))
		return off + 1
	case TypeUInt8:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		dst[off] = byte(uint8(toFloat(p.Value)))
		return off + 1
	case TypeInt16:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint16(dst[off:off+2], uint16(int16(toFloat(p.Value))))
		return off + 2
	case TypeUInt16:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint16(dst[off:off+2], uint16(toFloat(p.Value)))
		return off + 2
	case TypeInt32:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint32(dst[off:off+4], uint32(int32(toFloat(p.Value))))
		return off + 4
	case TypeUInt32:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint32(dst[off:off+4], uint32(toFloat(p.Value)))
		return off + 4
	case TypeFloat32:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint32(dst[off:off+4], math.Float32bits(float32(toFloat(p.Value))))
		return off + 4
	case TypeFloat64:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		binary.LittleEndian.PutUint64(dst[off:off+8], math.Float64bits(toFloat(p.Value)))
		return off + 8
	case TypeString:
		s, _ := p.Value.(string)
		binary.LittleEndian.PutUint32(dst[13:17], uint32(len(s)))
		copy(dst[off:off+len(s)], s)
		return off + len(s)
	default:
		binary.LittleEndian.PutUint32(dst[13:17], 0)
		return off
	}
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
