package utils

import (
	"strings"
)

// EvaluationInsight 评估失败原因洞察：从原始 error_message 解析出可读的归类、摘要与建议
type EvaluationInsight struct {
	Category    string   `json:"category"`    // 问题归类
	Summary     string   `json:"summary"`     // 简要说明
	Suggestions []string `json:"suggestions"` // 建议操作（列表）
}

// InsightFromErrorMessage 根据评估失败时的原始错误信息，生成「失败原因洞察」便于用户理解与修改
func InsightFromErrorMessage(raw string) EvaluationInsight {
	raw = strings.TrimSpace(raw)
	lower := strings.ToLower(raw)

	// 1. 测试集格式：缺少文本列或标签列
	if strings.Contains(raw, "测试集需包含文本列") || strings.Contains(raw, "需包含文本列") {
		return EvaluationInsight{
			Category: "测试集格式问题",
			Summary:  "当前测试集缺少脚本可识别的「文本」列，评估无法进行。",
			Suggestions: []string{
				"在测试集中增加一列文本内容，列名可为：text、content、review、sentence、comment、instruction、input 之一。",
				"若使用 CSV，确保表头包含上述列名之一；若为 JSON，确保有对应字段。",
				"确认文件编码为 UTF-8，且无多余 BOM。",
			},
		}
	}
	if strings.Contains(raw, "测试集需包含标签列") || strings.Contains(raw, "需包含标签列") {
		return EvaluationInsight{
			Category: "测试集格式问题",
			Summary:  "当前测试集缺少脚本可识别的「标签」列。",
			Suggestions: []string{
				"在测试集中增加一列标签，列名可为：label、labels 或 output。",
				"标签值建议为 0/1 或 positive/negative 等二分类格式，与训练时一致。",
				"检查 CSV 表头或 JSON 字段是否包含上述列名之一。",
			},
		}
	}
	if strings.Contains(raw, "KeyError") && (strings.Contains(lower, "text") || strings.Contains(lower, "label")) {
		return EvaluationInsight{
			Category: "测试集格式问题",
			Summary:  "测试集缺少必要的列（文本列或标签列），导致脚本报错。",
			Suggestions: []string{
				"文本列名需为：text、content、review、sentence、comment、instruction、input 之一。",
				"标签列名需为：label、labels 或 output 之一。",
				"用 Excel 或文本编辑器打开测试集，确认表头/字段名与上述一致。",
			},
		}
	}

	// 2. 路径/文件不存在（模型或测试集）
	if strings.Contains(lower, "no such file") || strings.Contains(lower, "does not exist") ||
		strings.Contains(raw, "找不到") || strings.Contains(raw, "not exist") {
		return EvaluationInsight{
			Category: "路径或文件缺失",
			Summary:  "脚本无法找到模型目录或测试集文件，请确认路径是否正确。",
			Suggestions: []string{
				"确认模型已训练完成且未删除，模型目录应位于 data/models/job_* 下。",
				"确认所选测试集已上传/处理完成（状态为「就绪」），且文件仍在 data/uploads 或对应路径。",
				"若曾移动或删除过数据/模型文件，可尝试重新训练或重新上传测试集后再评估。",
			},
		}
	}

	// 3. 序列长度超限（token > 512）
	if strings.Contains(raw, "Token indices sequence length") || strings.Contains(raw, "longer than") && strings.Contains(raw, "512") {
		return EvaluationInsight{
			Category: "输入文本过长",
			Summary:  "部分样本的文本长度超过模型最大 token 数（如 512），导致推理报错。",
			Suggestions: []string{
				"评估脚本已支持自动截断，若仍报错请确认使用的是最新版脚本。",
				"或对测试集做预处理：过滤或截断过长的句子（如每条保留前 200 字）。",
				"重新导出/清洗测试集，确保单条文本不要过长。",
			},
		}
	}

	// 4. Python 执行失败（未返回合法 JSON、或进程错误）
	if strings.Contains(raw, "python execution failed") || strings.Contains(raw, "failed to parse python output") {
		insight := EvaluationInsight{
			Category: "脚本执行或环境异常",
			Summary:  "Python 评估脚本执行失败或未返回合法结果，请根据下方「原始输出」排查。",
			Suggestions: []string{
				"查看下方「原始输出」中的 output 部分，通常包含 Python 的报错或 traceback。",
				"确认本机已安装 Python，且已安装依赖：pip install transformers pandas scikit-learn matplotlib。",
				"若报错与 CUDA/GPU 相关，可尝试在 CPU 上运行（或设置环境变量禁用 GPU）。",
			},
		}
		if strings.Contains(lower, "no module named") {
			insight.Summary = "缺少 Python 依赖包，脚本无法运行。"
			insight.Suggestions = []string{
				"在终端执行：pip install transformers pandas scikit-learn matplotlib torch。",
				"若使用 conda，请先激活对应环境再安装上述包。",
			}
		}
		if strings.Contains(lower, "python was not found") || strings.Contains(lower, "py is not recognized") {
			insight.Summary = "未找到 Python 解释器，请安装 Python 并加入 PATH。"
			insight.Suggestions = []string{
				"从 python.org 安装 Python，安装时勾选「Add Python to PATH」。",
				"或在项目 .env 中设置 PYTHON_PATH 为 python 可执行文件的完整路径。",
			}
		}
		return insight
	}

	// 5. 数据含空值（NaN）
	if strings.Contains(raw, "Input contains NaN") || strings.Contains(raw, "NaN") && strings.Contains(lower, "stratif") {
		return EvaluationInsight{
			Category: "测试集数据质量",
			Summary:  "测试集中存在空值（NaN），导致指标计算或划分时报错。",
			Suggestions: []string{
				"用 Excel 或 Pandas 打开测试集，检查文本列、标签列是否有空单元格。",
				"删除空行或对空标签/空文本进行填充或过滤后再重新上传为测试集。",
				"确保标签列为 0/1 或可识别的二分类值，无空白或非法字符。",
			},
		}
	}

	// 6. 模型加载失败（HF / 本地路径）
	if strings.Contains(lower, "cannot load") || strings.Contains(lower, "model") && strings.Contains(lower, "load") ||
		strings.Contains(raw, "OSError") && strings.Contains(lower, "model") {
		return EvaluationInsight{
			Category: "模型加载失败",
			Summary:  "无法从指定路径加载模型文件，可能目录不完整或格式不兼容。",
			Suggestions: []string{
				"确认模型目录内包含 config.json、pytorch_model.bin 或 model.safetensors 等文件。",
				"不要删除或移动训练完成后生成的 data/models/job_* 目录。",
				"若曾重新安装过 transformers，请确保版本与训练时兼容。",
			},
		}
	}

	// 7. 显存/内存不足
	if strings.Contains(lower, "cuda") && (strings.Contains(lower, "out of memory") || strings.Contains(lower, "oom")) ||
		strings.Contains(lower, "out of memory") {
		return EvaluationInsight{
			Category: "显存或内存不足",
			Summary:  "评估时显存或内存不足，无法完成推理。",
			Suggestions: []string{
				"在 CPU 上运行评估：设置环境变量 CUDA_VISIBLE_DEVICES=-1 后重启后端再试。",
				"或减小测试集规模（如先取前 500 条）进行测试。",
			},
		}
	}

	// 8. 原数据集已删除（无法获取测试集路径）
	if strings.Contains(raw, "原数据集已删除") || strings.Contains(raw, "test dataset has no cleaned file path") {
		return EvaluationInsight{
			Category: "测试数据不可用",
			Summary:  "未指定测试集且训练任务关联的原始数据集已删除，无法自动使用其数据。",
			Suggestions: []string{
				"创建评估任务时请显式选择一份「测试数据集」（已就绪的测试集）。",
				"或从现有训练集中重新「划分测试集」，再选择该测试集进行评估。",
			},
		}
	}

	// 9. 评估进程异常（panic / 未知）
	if strings.Contains(raw, "评估进程异常") {
		return EvaluationInsight{
			Category: "服务端进程异常",
			Summary:  "评估在执行过程中发生未捕获的异常。",
			Suggestions: []string{
				"查看运行后端的终端或日志中的完整报错信息。",
				"确认模型与测试集格式符合要求后，重试一次评估。",
			},
		}
	}

	// 10. 用户取消
	if strings.Contains(raw, "用户取消") {
		return EvaluationInsight{
			Category: "已取消",
			Summary:  "该评估任务已被用户中止。",
			Suggestions: []string{"无需处理；若需重新评估，请新建评估任务。"},
		}
	}

	// 10. 系统填充的通用提示（说明真实错误未写入，多为未执行迁移 006 或异常未落入可记录路径）
	if strings.Contains(raw, "未生成报告或评估异常") && strings.Contains(raw, "可能原因") {
		return EvaluationInsight{
			Category: "未记录到具体错误",
			Summary:  "当前显示的是系统通用提示，说明具体失败原因尚未写入数据库。",
			Suggestions: []string{
				"请查看运行后端的终端窗口（执行 go run 或 server 的窗口）中的完整报错，根据关键词排查。",
				"若未执行过数据库迁移 006、007，请执行：Get-Content internal/database/migrations/006_add_evaluation_status.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training；007 同理，这样后续失败原因会正确保存并显示。",
				"创建评估时务必选择「测试数据集」中一份已就绪的测试集；确认测试集含 text/content/… 等文本列和 label/labels/output 标签列。",
			},
		}
	}

	// 默认：无法精确归类，仍给出通用建议
	return EvaluationInsight{
		Category: "其他错误",
		Summary:  "根据原始报错暂时无法自动归类，请结合下方「原始输出」与以下建议排查。",
		Suggestions: []string{
			"仔细阅读下方「原始输出」中的关键词（如 KeyError、FileNotFoundError、No module named 等）。",
			"确认测试集包含「文本列」与「标签列」，列名与说明文档一致。",
			"确认模型目录完整、Python 依赖已安装，必要时查看后端控制台完整日志。",
		},
	}
}
