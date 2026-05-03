package config

// QwenDashScopeBaseURLOption 与阿里云百炼「OpenAI 兼容模式」文档一致的可选 Base URL（末尾勿带 /）。
// 参考：help.aliyun.com / model-studio OpenAI 兼容接口说明。
var QwenDashScopeBaseURLOptions = []map[string]string{
	{
		"value": "https://dashscope.aliyuncs.com/compatible-mode/v1",
		"label": "https://dashscope.aliyuncs.com/compatible-mode/v1",
	},
	{
		"value": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		"label": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
	},
	{
		"value": "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
		"label": "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
	},
	{
		"value": "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
		"label": "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
	},
}

// QwenDashScopeModelOptions 常用对话模型（意图解析走 chat/completions；以百炼控制台可用名为准）。
var QwenDashScopeModelOptions = []map[string]string{
	{"value": "qwen-turbo", "label": "qwen-turbo（轻量、低延迟）"},
	{"value": "qwen-flash", "label": "qwen-flash"},
	{"value": "qwen-plus", "label": "qwen-plus"},
	{"value": "qwen-max", "label": "qwen-max"},
	{"value": "qwen-long", "label": "qwen-long（长文本）"},
	{"value": "qwen2.5-7b-instruct", "label": "qwen2.5-7b-instruct"},
	{"value": "qwen2.5-14b-instruct", "label": "qwen2.5-14b-instruct"},
	{"value": "qwen2.5-32b-instruct", "label": "qwen2.5-32b-instruct"},
	{"value": "qwen2.5-72b-instruct", "label": "qwen2.5-72b-instruct"},
}
