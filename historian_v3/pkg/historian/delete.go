package historian

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type DeleteResult struct {
	DeletedRecords int `json:"deletedRecords"`
	TouchedSegments int `json:"touchedSegments"`
}

func (q *QueryEngine) DeleteByTags(tagIDs []uint32, from, to *int64) (DeleteResult, error) {
	if len(tagIDs) == 0 {
		return DeleteResult{}, errors.New("tagIds is required")
	}
	fromTs := int64(-1 << 63)
	toTs := int64(^uint64(0) >> 1)
	if from != nil {
		fromTs = *from
	}
	if to != nil {
		toTs = *to
	}
	if toTs < fromTs {
		return DeleteResult{}, errors.New("to must be >= from")
	}
	tagSet := make(map[uint32]struct{}, len(tagIDs))
	for _, t := range tagIDs {
		tagSet[t] = struct{}{}
	}
	segFiles, err := listSegmentFiles(q.cfg.Storage.DataDir)
	if err != nil {
		return DeleteResult{}, err
	}
	result := DeleteResult{}
	for _, segPath := range segFiles {
		idxPath := strings.Replace(segPath, string(filepath.Separator)+"raw"+string(filepath.Separator), string(filepath.Separator)+"index"+string(filepath.Separator), 1)
		idxPath = strings.TrimSuffix(idxPath, ".seg") + ".idx"
		deleted, touched, err := rewriteSegmentDelete(segPath, idxPath, tagSet, fromTs, toTs)
		if err != nil {
			return result, err
		}
		result.DeletedRecords += deleted
		if touched {
			result.TouchedSegments++
		}
	}
	return result, nil
}

func listSegmentFiles(dataDir string) ([]string, error) {
	root := filepath.Join(dataDir, "raw")
	out := make([]string, 0, 128)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".seg") {
			out = append(out, path)
		}
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

func rewriteSegmentDelete(segPath, idxPath string, tagSet map[uint32]struct{}, fromTs, toTs int64) (int, bool, error) {
	buf, err := os.ReadFile(segPath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	if len(buf) == 0 {
		return 0, false, nil
	}
	kept := make([]byte, 0, len(buf))
	indexEntries := make([]BlockIndexEntry, 0, 1)
	deleted := 0

	off := 0
	startOff := uint64(0)
	minTs := int64(^uint64(0) >> 1)
	maxTs := int64(-1 << 63)
	minTag := uint32(^uint32(0))
	maxTag := uint32(0)
	pointCount := uint32(0)
	for off < len(buf) {
		p, n, ok := DecodeSegmentRecord(buf, off)
		if !ok {
			break
		}
		rec := buf[off : off+n]
		off += n
		if _, has := tagSet[p.TagID]; has && p.TsEpoch >= fromTs && p.TsEpoch <= toTs {
			deleted++
			continue
		}
		kept = append(kept, rec...)
		if p.TsEpoch < minTs {
			minTs = p.TsEpoch
		}
		if p.TsEpoch > maxTs {
			maxTs = p.TsEpoch
		}
		if p.TagID < minTag {
			minTag = p.TagID
		}
		if p.TagID > maxTag {
			maxTag = p.TagID
		}
		pointCount++
	}

	if deleted == 0 {
		return 0, false, nil
	}

	tmpSeg := segPath + ".tmp"
	if err := os.WriteFile(tmpSeg, kept, 0o644); err != nil {
		return 0, false, err
	}
	if err := os.Rename(tmpSeg, segPath); err != nil {
		_ = os.Remove(tmpSeg)
		return 0, false, err
	}

	if pointCount > 0 {
		indexEntries = append(indexEntries, BlockIndexEntry{
			MinTs:           minTs,
			MaxTs:           maxTs,
			ByteOffsetStart: startOff,
			ByteOffsetEnd:   uint64(len(kept)),
			PointCount:      pointCount,
			MinTagID:        minTag,
			MaxTagID:        maxTag,
		})
	}
	idxPayload := make([]byte, 0, len(indexEntries)*BlockIndexEntrySize)
	for _, e := range indexEntries {
		idxPayload = append(idxPayload, EncodeBlockIndexEntry(e)...)
	}
	if err := os.MkdirAll(filepath.Dir(idxPath), 0o755); err != nil {
		return 0, false, err
	}
	if err := os.WriteFile(idxPath, idxPayload, 0o644); err != nil {
		return 0, false, err
	}
	return deleted, true, nil
}
