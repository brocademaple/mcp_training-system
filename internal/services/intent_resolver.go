package services

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"

	"gopkg.in/yaml.v3"
)

//go:embed defaults/intent_patterns.yaml
var intentPatternsEmbed embed.FS

// IntentPatternsDoc 对应 intent_registry/intent_patterns.yaml
type IntentPatternsDoc struct {
	Version                int           `yaml:"version"`
	Patterns               []PatternRule `yaml:"patterns"`
	DomainHints            []DomainHint  `yaml:"domain_hints"`
	LowConfidenceThreshold int           `yaml:"low_confidence_threshold"`
}

type PatternRule struct {
	ID               string   `yaml:"id"`
	Intent           string   `yaml:"intent"`
	Weight           int      `yaml:"weight"`
	Keywords         []string `yaml:"keywords"`
	NegativeKeywords []string `yaml:"negative_keywords"`
	ImpliesSFTLoRA   bool     `yaml:"implies_sft_lora"`
}

type DomainHint struct {
	Domain   string   `yaml:"domain"`
	Weight   int      `yaml:"weight"`
	Keywords []string `yaml:"keywords"`
}

// ResolveResult Agent 意图识别输出（供 API 与 BuildRulePlan 使用）
type ResolveResult struct {
	InferredIntent    string   `json:"inferred_intent"`
	TrainMode         string   `json:"train_mode"` // classic_clf | sft_lora
	DomainHint        string   `json:"domain_hint"`
	Confidence        string   `json:"confidence"` // high | medium | low
	MatchedTerms      []string `json:"matched_terms"`
	MatchedPatternIDs []string `json:"matched_pattern_ids"`
	Message           string   `json:"message"`
}

var (
	intentPatternsMu     sync.RWMutex
	intentPatternsLoaded *IntentPatternsDoc
	intentPatternsRoot   string
)

// LoadIntentPatterns 从 baseDir/intent_registry/intent_patterns.yaml 加载；失败则用嵌入默认。
func LoadIntentPatterns(baseDir string) error {
	intentPatternsRoot = filepath.Clean(baseDir)
	p := filepath.Join(intentPatternsRoot, "intent_registry", "intent_patterns.yaml")
	b, err := os.ReadFile(p)
	if err != nil {
		b, err = intentPatternsEmbed.ReadFile("defaults/intent_patterns.yaml")
		if err != nil {
			return fmt.Errorf("intent patterns: %w", err)
		}
	}
	var doc IntentPatternsDoc
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return err
	}
	if doc.LowConfidenceThreshold <= 0 {
		doc.LowConfidenceThreshold = 2
	}
	intentPatternsMu.Lock()
	intentPatternsLoaded = &doc
	intentPatternsMu.Unlock()
	return nil
}

func getIntentPatterns() *IntentPatternsDoc {
	intentPatternsMu.RLock()
	defer intentPatternsMu.RUnlock()
	return intentPatternsLoaded
}

// ResolveIntentFromGoal 根据用户自然语言推断 intent / train_mode / domain。
func ResolveIntentFromGoal(goal string) ResolveResult {
	doc := getIntentPatterns()
	if doc == nil {
		_ = LoadIntentPatterns(".")
		doc = getIntentPatterns()
	}
	if doc == nil {
		return ResolveResult{
			InferredIntent: "sentiment",
			TrainMode:      "classic_clf",
			DomainHint:     "General",
			Confidence:     "low",
			Message:        "意图规则未加载，已使用默认：情感分类。",
		}
	}

	g := strings.TrimSpace(goal)
	if g == "" {
		return ResolveResult{
			InferredIntent: "sentiment",
			TrainMode:      "classic_clf",
			DomainHint:     "General",
			Confidence:     "low",
			Message:        "未输入描述，已默认情感分类 + 通用领域。",
		}
	}

	lower := strings.ToLower(g)
	intentScores := make(map[string]int)
	var matchedTerms []string
	var matchedIDs []string
	suggestLoRA := strings.Contains(lower, "微调") || strings.Contains(lower, "lora") ||
		strings.Contains(lower, "sft") || strings.Contains(lower, "qlora")

	for _, rule := range doc.Patterns {
		if rule.Intent == "" {
			continue
		}
		if negHit(g, lower, rule.NegativeKeywords) {
			continue
		}
		w := rule.Weight
		if w <= 0 {
			w = 1
		}
		hit := false
		for _, kw := range rule.Keywords {
			if kw == "" {
				continue
			}
			if containsKeyword(g, lower, kw) {
				hit = true
				matchedTerms = appendUnique(matchedTerms, kw)
			}
		}
		if hit {
			intentScores[rule.Intent] += w
			matchedIDs = appendUnique(matchedIDs, rule.ID)
			if rule.ImpliesSFTLoRA {
				suggestLoRA = true
			}
		}
	}

	bestIntent, bestScore, second := pickTop2(intentScores)
	conf := "medium"
	if bestIntent == "" {
		bestIntent = "sentiment"
		conf = "low"
	} else {
		if second == 0 && bestScore > 0 {
			conf = "high"
		} else if second > 0 && bestScore >= 2*second {
			conf = "high"
		}
		if bestScore < doc.LowConfidenceThreshold {
			conf = "low"
		}
	}

	domain := "General"
	domainScore := 0
	for _, dh := range doc.DomainHints {
		hit := false
		for _, kw := range dh.Keywords {
			if containsKeyword(g, lower, kw) {
				hit = true
				matchedTerms = appendUnique(matchedTerms, kw)
			}
		}
		if hit {
			s := dh.Weight
			if s <= 0 {
				s = 1
			}
			if s > domainScore {
				domainScore = s
				domain = dh.Domain
			}
		}
	}

	trainMode := "classic_clf"
	spec := getTaskSpecByIntent(bestIntent)
	if spec.DefaultTrainMode == "sft_lora" {
		trainMode = "sft_lora"
	}
	if suggestLoRA {
		trainMode = "sft_lora"
	}

	sort.Strings(matchedTerms)
	sort.Strings(matchedIDs)

	msg := fmt.Sprintf("识别为「%s」任务，领域「%s」；训练方式建议「%s」。", labelIntent(bestIntent), domain, trainModeLabel(trainMode))
	if conf == "low" {
		msg = "描述较模糊，已给出默认建议，可在下方调整任务类型。" + msg
	}

	return ResolveResult{
		InferredIntent:    bestIntent,
		TrainMode:         trainMode,
		DomainHint:        domain,
		Confidence:        conf,
		MatchedTerms:      matchedTerms,
		MatchedPatternIDs: matchedIDs,
		Message:           msg,
	}
}

func negHit(g, lower string, negs []string) bool {
	for _, s := range negs {
		if s == "" {
			continue
		}
		if containsKeyword(g, lower, s) {
			return true
		}
	}
	return false
}

func containsKeyword(g, lowerG, kw string) bool {
	kw = strings.TrimSpace(kw)
	if kw == "" {
		return false
	}
	if isASCII(kw) {
		return strings.Contains(lowerG, strings.ToLower(kw))
	}
	return strings.Contains(g, kw)
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func pickTop2(scores map[string]int) (best string, bestV, secondV int) {
	type kv struct {
		k string
		v int
	}
	var list []kv
	for k, v := range scores {
		list = append(list, kv{k, v})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].v != list[j].v {
			return list[i].v > list[j].v
		}
		return list[i].k < list[j].k
	})
	if len(list) == 0 {
		return "", 0, 0
	}
	best = list[0].k
	bestV = list[0].v
	if len(list) > 1 {
		secondV = list[1].v
	}
	return
}

func appendUnique(arr []string, s string) []string {
	for _, x := range arr {
		if x == s {
			return arr
		}
	}
	return append(arr, s)
}

func labelIntent(id string) string {
	m := map[string]string{
		"sentiment": "情感分类", "topic": "主题分类", "binary": "二分类", "multiclass": "多分类",
		"intent": "意图识别", "ner": "命名实体", "summary": "摘要/生成", "extraction": "信息抽取",
		"rewriting": "文本改写", "matching": "匹配与排序", "infilling": "填空与推理", "alignment": "偏好对齐", "other": "其他",
	}
	if v, ok := m[id]; ok {
		return v
	}
	return id
}

func trainModeLabel(m string) string {
	if m == "sft_lora" {
		return "SFT/LoRA（生成/指令微调）"
	}
	return "经典分类（BERT 分类头）"
}
