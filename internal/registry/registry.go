package registry

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"gopkg.in/yaml.v3"
)

//go:embed defaults/*.yaml
var embeddedDefaults embed.FS

// Bundle 为任务/方法/领域注册表的内存视图。
type Bundle struct {
	Task     TaskRegistry     `yaml:"-"`
	Method   MethodRegistry   `yaml:"-"`
	Domain   DomainRegistry   `yaml:"-"`
	RootPath string           `yaml:"-"`
}

type TaskRegistry struct {
	Families []TaskFamily `yaml:"families"`
}

type TaskFamily struct {
	ID                 string     `yaml:"id"`
	LabelZH            string     `yaml:"label_zh"`
	DefaultMetrics     []string   `yaml:"default_metrics"`
	SupportedMethods   []string   `yaml:"supported_methods"`
	Tasks              []TaskItem `yaml:"tasks"`
}

type TaskItem struct {
	ID            string `yaml:"id"`
	DefaultSchema string `yaml:"default_schema"`
}

type MethodRegistry struct {
	Methods []MethodDef `yaml:"methods"`
}

type MethodDef struct {
	ID              string                 `yaml:"id"`
	LabelZH         string                 `yaml:"label_zh"`
	PEFT            bool                   `yaml:"peft"`
	DefaultParams   map[string]interface{} `yaml:"default_params"`
	AlignmentOnly   bool                   `yaml:"alignment_only"`
}

type DomainRegistry struct {
	Domains []DomainDef `yaml:"domains"`
}

type DomainDef struct {
	ID      string `yaml:"id"`
	LabelZH string `yaml:"label_zh"`
}

var (
	globalBundle *Bundle
	globalMu     sync.RWMutex
)

// LoadFromDir 从 baseDir 下读取 task_registry/index.yaml 等；失败则使用嵌入默认。
func LoadFromDir(baseDir string) (*Bundle, error) {
	baseDir = filepath.Clean(baseDir)
	b := &Bundle{RootPath: baseDir}

	taskPath := filepath.Join(baseDir, "task_registry", "index.yaml")
	methodPath := filepath.Join(baseDir, "method_registry", "index.yaml")
	domainPath := filepath.Join(baseDir, "domain_registry", "index.yaml")

	taskBytes, err := os.ReadFile(taskPath)
	if err != nil {
		taskBytes, err = embeddedDefaults.ReadFile("defaults/task_registry_index.yaml")
		if err != nil {
			return nil, fmt.Errorf("task registry: %w", err)
		}
	}
	if err := yaml.Unmarshal(taskBytes, &b.Task); err != nil {
		return nil, fmt.Errorf("parse task registry: %w", err)
	}

	methodBytes, err := os.ReadFile(methodPath)
	if err != nil {
		methodBytes, _ = embeddedDefaults.ReadFile("defaults/method_registry_index.yaml")
	}
	if len(methodBytes) > 0 {
		if err := yaml.Unmarshal(methodBytes, &b.Method); err != nil {
			return nil, fmt.Errorf("parse method registry: %w", err)
		}
	}

	domainBytes, err := os.ReadFile(domainPath)
	if err != nil {
		domainBytes, _ = embeddedDefaults.ReadFile("defaults/domain_registry_index.yaml")
	}
	if len(domainBytes) > 0 {
		if err := yaml.Unmarshal(domainBytes, &b.Domain); err != nil {
			return nil, fmt.Errorf("parse domain registry: %w", err)
		}
	}

	globalMu.Lock()
	globalBundle = b
	globalMu.Unlock()
	return b, nil
}

// Get 返回已加载的全局 Bundle（可能为 nil，需先 LoadFromDir）。
func Get() *Bundle {
	globalMu.RLock()
	defer globalMu.RUnlock()
	return globalBundle
}

// TaskFamilyByID 查找一级任务族。
func (b *Bundle) TaskFamilyByID(id string) *TaskFamily {
	if b == nil {
		return nil
	}
	for i := range b.Task.Families {
		if b.Task.Families[i].ID == id {
			return &b.Task.Families[i]
		}
	}
	return nil
}

// MethodByID 查找训练方法。
func (b *Bundle) MethodByID(id string) *MethodDef {
	if b == nil {
		return nil
	}
	for i := range b.Method.Methods {
		if b.Method.Methods[i].ID == id {
			return &b.Method.Methods[i]
		}
	}
	return nil
}

// DomainByID 查找领域。
func (b *Bundle) DomainByID(id string) *DomainDef {
	if b == nil {
		return nil
	}
	for i := range b.Domain.Domains {
		if b.Domain.Domains[i].ID == id {
			return &b.Domain.Domains[i]
		}
	}
	return nil
}

// ValidateRunSpec 校验语义任务族是否支持所选方法（最小校验）。
func (b *Bundle) ValidateRunSpec(family, method string) error {
	if b == nil {
		return nil
	}
	tf := b.TaskFamilyByID(family)
	if tf == nil {
		return fmt.Errorf("unknown task family: %s", family)
	}
	ok := false
	for _, m := range tf.SupportedMethods {
		if m == method {
			ok = true
			break
		}
	}
	if !ok {
		return fmt.Errorf("method %s not supported for family %s", method, family)
	}
	md := b.MethodByID(method)
	if md == nil {
		return fmt.Errorf("unknown method: %s", method)
	}
	if md.AlignmentOnly && family != "Alignment" {
		return fmt.Errorf("method %s is for Alignment tasks only", method)
	}
	return nil
}
