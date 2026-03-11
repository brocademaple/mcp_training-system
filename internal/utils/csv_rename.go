package utils

import (
	"encoding/csv"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

// RenameCSVColumns reads a CSV file, renames columns by the given map (oldName -> newName),
// and writes back to the same path. Use for normalizing columns e.g. "tweet" -> "text".
func RenameCSVColumns(filePath string, columnMap map[string]string) error {
	if len(columnMap) == 0 {
		return nil
	}

	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	r := csv.NewReader(f)
	// 容错：部分公开数据集 CSV 可能包含不规范的引号，默认解析会报
	// parse error on line X: bare " in non-quoted-field
	// 这里允许 LazyQuotes，以提升在线导入成功率。
	r.LazyQuotes = true
	r.FieldsPerRecord = -1

	// Read header only
	header, err := r.Read()
	if err != nil {
		// 空文件 / 无内容
		if err == io.EOF {
			return nil
		}
		return err
	}

	for i, name := range header {
		if newName, ok := columnMap[name]; ok {
			header[i] = newName
		}
	}

	// Write to temp file then replace (avoid loading entire CSV in memory)
	dir := filepath.Dir(filePath)
	tmp, err := os.CreateTemp(dir, "renamed_*.csv")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}()

	w := csv.NewWriter(tmp)
	if err := w.Write(header); err != nil {
		return err
	}
	for {
		rec, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		if err := w.Write(rec); err != nil {
			return err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}

	// Replace original file
	if err := os.Rename(tmpPath, filePath); err != nil {
		return err
	}
	return nil
}

const DefaultPreviewRows = 100

// ReadCSVPreview reads the CSV at filePath and returns column names and first limit rows as []map[string]string.
// limit <= 0 uses DefaultPreviewRows.
func ReadCSVPreview(filePath string, limit int) (columns []string, rows []map[string]string, err error) {
	if limit <= 0 {
		limit = DefaultPreviewRows
	}
	f, err := os.Open(filePath)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.LazyQuotes = true
	r.FieldsPerRecord = -1
	all, err := r.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	if len(all) == 0 {
		return nil, []map[string]string{}, nil
	}
	columns = all[0]
	rows = make([]map[string]string, 0, limit)
	for i := 1; i < len(all) && len(rows) < limit; i++ {
		record := all[i]
		row := make(map[string]string, len(columns))
		for j, col := range columns {
			if j < len(record) {
				row[col] = record[j]
			} else {
				row[col] = ""
			}
		}
		rows = append(rows, row)
	}
	return columns, rows, nil
}

// ReadFilePreview reads CSV or JSON file and returns preview data
func ReadFilePreview(filePath string, limit int) (columns []string, rows []map[string]string, err error) {
	ext := filepath.Ext(filePath)
	if ext == ".json" {
		return readJSONPreview(filePath, limit)
	}
	return ReadCSVPreview(filePath, limit)
}

func readJSONPreview(filePath string, limit int) (columns []string, rows []map[string]string, err error) {
	if limit <= 0 {
		limit = DefaultPreviewRows
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, nil, err
	}
	var records []map[string]interface{}
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, nil, err
	}
	if len(records) == 0 {
		return nil, []map[string]string{}, nil
	}
	for k := range records[0] {
		columns = append(columns, k)
	}
	rows = make([]map[string]string, 0, limit)
	for i := 0; i < len(records) && i < limit; i++ {
		row := make(map[string]string)
		for _, col := range columns {
			if v, ok := records[i][col]; ok {
				row[col] = toString(v)
			}
		}
		rows = append(rows, row)
	}
	return columns, rows, nil
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}
