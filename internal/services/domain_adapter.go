package services

import (
	"strings"

	"mcp-training-system/internal/models"
	"mcp-training-system/internal/registry"
)

// ApplyDomainToRunSpec 将领域默认说明合并到 RunSpec（占位：后续可扩展 prompt 模板）。
func ApplyDomainToRunSpec(rs *models.RunSpec) {
	if rs == nil {
		return
	}
	b := registry.Get()
	if b == nil {
		return
	}
	d := b.DomainByID(rs.Domain.Name)
	if d == nil {
		return
	}
	// 占位：供 Data Agent / 训练 prompt 使用
	if rs.ProjectName == "" {
		rs.ProjectName = strings.ToLower(d.ID) + "-task"
	}
}
