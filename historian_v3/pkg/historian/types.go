package historian

type ValueTypeCode uint8

const (
	TypeInt8    ValueTypeCode = 1
	TypeUInt8   ValueTypeCode = 2
	TypeInt16   ValueTypeCode = 3
	TypeUInt16  ValueTypeCode = 4
	TypeInt32   ValueTypeCode = 5
	TypeUInt32  ValueTypeCode = 6
	TypeFloat32 ValueTypeCode = 7
	TypeFloat64 ValueTypeCode = 8
	TypeString  ValueTypeCode = 9
)

func (t ValueTypeCode) FixedSize() int {
	switch t {
	case TypeInt8, TypeUInt8:
		return 1
	case TypeInt16, TypeUInt16:
		return 2
	case TypeInt32, TypeUInt32, TypeFloat32:
		return 4
	case TypeFloat64:
		return 8
	default:
		return -1
	}
}

func (t ValueTypeCode) IsNumeric() bool { return t != TypeString }

type Point struct {
	TagID    uint32        `json:"tagId"`
	TsEpoch  int64         `json:"tsEpoch"`
	TypeCode ValueTypeCode `json:"typeCode"`
	Value    any           `json:"value"`
}

type QueryOrder string

const (
	OrderAsc  QueryOrder = "asc"
	OrderDesc QueryOrder = "desc"
)
