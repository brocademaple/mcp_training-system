package services

import (
	"strings"

	"mcp-training-system/internal/models"
	"mcp-training-system/internal/registry"
)

// SelectMethodForTask 根据任务族与资源提示选择默认训练方法（规则版薄层）。
func SelectMethodForTask(family string, preferPEFT bool) string {
	return selectMethodWithHints(family, preferPEFT, "")
}

// SelectMethodForTaskWithGoal 增加少量启发式：低显存/4bit 倾向 QLoRA，全量微调关键词倾向 FullFineTuning。
func SelectMethodForTaskWithGoal(family string, preferPEFT bool, goal string) string {
	return selectMethodWithHints(family, preferPEFT, goal)
}

func selectMethodWithHints(family string, preferPEFT bool, goal string) string {
	b := registry.Get()
	lowerGoal := strings.ToLower(goal)
	wantQLoRA := strings.Contains(lowerGoal, "qlora") || strings.Contains(lowerGoal, "4bit") || strings.Contains(lowerGoal, "低显存")
	wantFullFT := strings.Contains(lowerGoal, "full fine") || strings.Contains(lowerGoal, "fullft") || strings.Contains(lowerGoal, "全量微调")

	if family == "Alignment" {
		if b != nil {
			tf := b.TaskFamilyByID(family)
			if tf != nil {
				for _, m := range tf.SupportedMethods {
					if m == "DPO" {
						return "DPO"
					}
				}
			}
		}
		return "DPO"
	}

	if b == nil {
		if preferPEFT {
			if wantQLoRA {
				return "QLoRA"
			}
			return "LoRA"
		}
		if wantFullFT {
			return "FullFineTuning"
		}
		return "SFT"
	}
	tf := b.TaskFamilyByID(family)
	if tf == nil {
		return "SFT"
	}
	for _, m := range tf.SupportedMethods {
		if preferPEFT {
			if wantQLoRA && m == "QLoRA" {
				return "QLoRA"
			}
			if m == "LoRA" || m == "QLoRA" {
				return m
			}
		}
		if !preferPEFT && wantFullFT && m == "FullFineTuning" {
			return "FullFineTuning"
		}
	}
	if len(tf.SupportedMethods) > 0 {
		return tf.SupportedMethods[0]
	}
	return "SFT"
}

// MergeMethodDefaults 将方法注册表中的默认参数合并到 RunSpec。
func MergeMethodDefaults(rs *models.RunSpec) {
	if rs == nil {
		return
	}
	b := registry.Get()
	if b == nil {
		return
	}
	md := b.MethodByID(rs.TrainingMethod.Name)
	if md == nil || md.DefaultParams == nil {
		return
	}
	if rs.TrainingMethod.Params == nil {
		rs.TrainingMethod.Params = make(map[string]interface{})
	}
	for k, v := range md.DefaultParams {
		if _, ok := rs.TrainingMethod.Params[k]; !ok {
			rs.TrainingMethod.Params[k] = v
		}
	}
}
