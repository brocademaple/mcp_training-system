package services

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	_ = LoadIntentPatterns("../../")
	os.Exit(m.Run())
}

func TestResolveIntentFromGoal_sentiment(t *testing.T) {
	r := ResolveIntentFromGoal("用电商评论做正负情感分类")
	if r.InferredIntent != "sentiment" {
		t.Fatalf("intent want sentiment, got %s", r.InferredIntent)
	}
	if r.Confidence != "high" && r.Confidence != "medium" {
		t.Fatalf("unexpected confidence: %s", r.Confidence)
	}
}

func TestResolveIntentFromGoal_ner(t *testing.T) {
	r := ResolveIntentFromGoal("抽取新闻中的人名地名机构名，做NER")
	if r.InferredIntent != "ner" {
		t.Fatalf("intent want ner, got %s", r.InferredIntent)
	}
}

func TestResolveIntentFromGoal_summary(t *testing.T) {
	r := ResolveIntentFromGoal("对长文章做摘要生成")
	if r.InferredIntent != "summary" {
		t.Fatalf("intent want summary, got %s", r.InferredIntent)
	}
	if r.TrainMode != "sft_lora" {
		t.Fatalf("train_mode want sft_lora, got %s", r.TrainMode)
	}
}

func TestResolveIntentFromGoal_alignment(t *testing.T) {
	r := ResolveIntentFromGoal("用 DPO 做人类反馈偏好对齐")
	if r.InferredIntent != "alignment" {
		t.Fatalf("intent want alignment, got %s", r.InferredIntent)
	}
}

func TestResolveIntentFromGoal_extraction(t *testing.T) {
	r := ResolveIntentFromGoal("从合同文本做关系抽取并输出JSON")
	if r.InferredIntent != "extraction" {
		t.Fatalf("intent want extraction, got %s", r.InferredIntent)
	}
}

func TestResolveIntentFromGoal_matching(t *testing.T) {
	r := ResolveIntentFromGoal("做 FAQ 匹配和重排序")
	if r.InferredIntent != "matching" {
		t.Fatalf("intent want matching, got %s", r.InferredIntent)
	}
}

func TestResolveIntentFromGoal_financeDomain(t *testing.T) {
	r := ResolveIntentFromGoal("金融股票情感分析")
	if r.DomainHint != "Finance" {
		t.Fatalf("domain want Finance, got %s", r.DomainHint)
	}
}

func TestResolveIntentFromGoal_empty(t *testing.T) {
	r := ResolveIntentFromGoal("")
	if r.InferredIntent != "sentiment" || r.Confidence != "low" {
		t.Fatalf("empty goal: %+v", r)
	}
}
