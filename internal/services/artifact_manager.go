package services

import (
	"fmt"
	"path/filepath"
	"strings"

	"mcp-training-system/internal/models"
)

// DefaultOutputDir 根据 RunSpec 生成默认产物目录（相对项目根）。
func DefaultOutputDir(rs *models.RunSpec, jobID int) string {
	base := "data/models"
	if rs != nil && rs.Artifacts.OutputDir != "" {
		return rs.Artifacts.OutputDir
	}
	name := "job"
	if rs != nil && rs.ProjectName != "" {
		name = sanitizePathSegment(rs.ProjectName)
	}
	return filepath.ToSlash(filepath.Join(base, fmt.Sprintf("%s_%d", name, jobID)))
}

func sanitizePathSegment(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, string(filepath.Separator), "-")
	if s == "" {
		return "project"
	}
	return s
}
