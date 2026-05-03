package agents

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"mcp-training-system/internal/services"
	"mcp-training-system/internal/utils"
)

// DataAgent handles data processing operations.
type DataAgent struct {
	db        *sql.DB
	executor  *utils.PythonExecutor
	explainer *services.AgentExplainer
	templates []dataTaskTemplate
}

type dataTaskTemplate struct {
	TaskType      string   `json:"task_type"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	RequiredCols  []string `json:"required_columns"`
	OptionalCols  []string `json:"optional_columns"`
	LabelRequired bool     `json:"label_required"`
}

// NewDataAgent creates a new data agent.
func NewDataAgent(db *sql.DB, executor *utils.PythonExecutor) *DataAgent {
	a := &DataAgent{
		db:        db,
		executor:  executor,
		explainer: services.NewAgentExplainerFromEnv(),
		templates: defaultDataTaskTemplates(),
	}
	a.tryLoadTemplatesFromAssets()
	return a
}

// CleanData cleans a dataset by removing duplicates and missing values.
func (a *DataAgent) CleanData(datasetID int, dataAgentPrompt string) error {
	utils.Info("DataAgent: Starting data cleaning for dataset %d", datasetID)
	if dataAgentPrompt != "" {
		utils.Info("DataAgent: data_agent_prompt (for future use): %s", dataAgentPrompt)
	}

	var pathVal sql.NullString
	err := a.db.QueryRow(
		"SELECT original_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&pathVal)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return fmt.Errorf("failed to query dataset: %v", err)
	}
	if !pathVal.Valid || pathVal.String == "" {
		utils.Error("DataAgent: No original_file_path for dataset %d", datasetID)
		return fmt.Errorf("dataset has no file path")
	}
	filePath := pathVal.String
	utils.Info("DataAgent: Cleaning file: %s", filePath)

	result, err := a.executor.Execute("data/clean_data.py", filePath)
	if err != nil {
		utils.Error("DataAgent: Python script failed: %v", err)
		a.db.Exec(
			"UPDATE datasets SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
			err.Error(), datasetID,
		)
		return err
	}

	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("DataAgent: Cleaning failed: %s", errMsg)
		a.db.Exec(
			"UPDATE datasets SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
			errMsg, datasetID,
		)
		return fmt.Errorf("cleaning failed: %s", errMsg)
	}

	cleanedRows := int(result["cleaned_rows"].(float64))
	columnCount := len(result["columns"].([]interface{}))
	outputPath := result["output_path"].(string)

	_, err = a.db.Exec(`
        UPDATE datasets
        SET cleaned_file_path = $1,
            row_count = $2,
            column_count = $3,
            status = 'ready',
            updated_at = NOW()
        WHERE id = $4
    `,
		outputPath,
		cleanedRows,
		columnCount,
		datasetID,
	)

	if err != nil {
		utils.Error("DataAgent: Failed to update database: %v", err)
		return fmt.Errorf("failed to update database: %v", err)
	}

	utils.Info("DataAgent: Data cleaning completed for dataset %d", datasetID)
	return nil
}

// AnalyzeData returns deterministic script statistics.
func (a *DataAgent) AnalyzeData(datasetID int) (map[string]interface{}, error) {
	utils.Info("DataAgent: Starting data analysis for dataset %d", datasetID)

	var pathVal sql.NullString
	err := a.db.QueryRow(
		"SELECT cleaned_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&pathVal)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return nil, fmt.Errorf("failed to query dataset: %v", err)
	}
	if !pathVal.Valid || pathVal.String == "" {
		return nil, fmt.Errorf("dataset has no cleaned file path (not ready yet)")
	}
	filePath := pathVal.String

	result, err := a.executor.Execute("data/analyze_data.py", filePath)
	if err != nil {
		utils.Error("DataAgent: Analysis failed: %v", err)
		return nil, err
	}

	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("DataAgent: Analysis failed: %s", errMsg)
		return nil, fmt.Errorf("analysis failed: %s", errMsg)
	}

	utils.Info("DataAgent: Data analysis completed for dataset %d", datasetID)
	return result, nil
}

// BuildDataReport runs deterministic analysis + template matching + optional LLM explanation.
func (a *DataAgent) BuildDataReport(datasetID int) (map[string]interface{}, error) {
	analysis, err := a.AnalyzeData(datasetID)
	if err != nil {
		return nil, err
	}

	report := a.buildRuleReport(analysis)
	report["dataset_id"] = datasetID
	report["explanation_source"] = "rule"

	llmInput := map[string]interface{}{
		"dataset_id":  datasetID,
		"analysis":    analysis,
		"rule_report": report,
	}
	if a.explainer != nil && a.explainer.Enabled() {
		if llmOut, llmErr := a.explainer.ExplainDataReport(llmInput); llmErr == nil {
			mergeDataReportWithLLM(report, llmOut)
			report["explanation_source"] = "llm+rule"
		} else {
			report["llm_error"] = llmErr.Error()
		}
	}

	return report, nil
}

// SplitDatasetResult is the split output.
type SplitDatasetResult struct {
	TrainPath  string
	TestPath   string
	TrainCount int
	TestCount  int
}

// SplitDataset splits existing dataset into train/test files.
func (a *DataAgent) SplitDataset(inputPath, trainRatio, outputDir string) (*SplitDatasetResult, error) {
	utils.Info("DataAgent: Splitting dataset %s with train_ratio=%s into %s", inputPath, trainRatio, outputDir)
	result, err := a.executor.Execute("data/split_dataset.py", inputPath, trainRatio, outputDir)
	if err != nil {
		return nil, err
	}
	if result["status"] != "success" {
		errMsg := "split failed"
		if em, ok := result["error_message"].(string); ok {
			errMsg = em
		}
		return nil, fmt.Errorf("%s", errMsg)
	}
	trainPath, _ := result["train_path"].(string)
	testPath, _ := result["test_path"].(string)
	if trainPath == "" || testPath == "" {
		return nil, fmt.Errorf("split script did not return train_path or test_path")
	}
	trainCount := 0
	testCount := 0
	if v, ok := result["train_count"].(float64); ok {
		trainCount = int(v)
	}
	if v, ok := result["test_count"].(float64); ok {
		testCount = int(v)
	}
	return &SplitDatasetResult{
		TrainPath:  trainPath,
		TestPath:   testPath,
		TrainCount: trainCount,
		TestCount:  testCount,
	}, nil
}

func (a *DataAgent) buildRuleReport(analysis map[string]interface{}) map[string]interface{} {
	columns := toStringSlice(analysis["columns"])
	hints := toStringSlice(analysis["task_type_hints"])
	textColumn := strings.TrimSpace(toString(analysis["text_column"]))
	labelColumn := strings.TrimSpace(toString(analysis["label_column"]))

	taskType, confidence := a.matchTaskTemplate(columns, hints, labelColumn != "")

	rowCount := toInt(analysis["row_count"])
	nullRatio := toFloat(analysis["null_ratio"])
	duplicateRatio := toFloat(analysis["duplicate_ratio"])
	emptyTextRatio := toFloat(analysis["empty_text_ratio"])
	imbalance := calcLabelImbalance(analysis["label_distribution"])

	reliabilityScore := 1.0
	trainabilityScore := 1.0

	if nullRatio > 0.10 {
		reliabilityScore -= 0.25
	}
	if duplicateRatio > 0.20 {
		reliabilityScore -= 0.25
	}
	if emptyTextRatio > 0.05 {
		reliabilityScore -= 0.20
	}
	if rowCount < 100 {
		reliabilityScore -= 0.10
		trainabilityScore -= 0.20
	}
	if textColumn == "" {
		trainabilityScore -= 0.40
	}
	if (taskType == "text_classification" || taskType == "sentiment_analysis") && labelColumn == "" {
		trainabilityScore -= 0.50
	}
	if imbalance > 10 {
		trainabilityScore -= 0.20
	}

	reliability := bucketScore(reliabilityScore)
	trainability := bucketScore(trainabilityScore)

	issueCodes := uniqueIssueCodes(append(toStringSlice(analysis["issues"]), ruleDerivedIssueCodes(rowCount, nullRatio, duplicateRatio, emptyTextRatio, imbalance, textColumn, labelColumn)...))
	issuesCN := translateIssues(issueCodes)
	recommendations := buildRecommendations(issueCodes)

	stats := map[string]interface{}{
		"row_count":          rowCount,
		"column_count":       toInt(analysis["column_count"]),
		"text_column":        nullableString(textColumn),
		"label_column":       nullableString(labelColumn),
		"num_classes":        nullableInt(toInt(analysis["num_classes"])),
		"null_ratio":         nullRatio,
		"duplicate_ratio":    duplicateRatio,
		"empty_text_ratio":   emptyTextRatio,
		"avg_text_length":    toFloat(analysis["avg_text_length"]),
		"short_text_ratio":   toFloat(analysis["short_text_ratio"]),
		"unique_text_ratio":  toFloat(analysis["unique_text_ratio"]),
		"label_distribution": normalizeMap(analysis["label_distribution"]),
	}

	summary := fmt.Sprintf("该数据集初步识别为%s，可靠性%s、可训练性%s，建议先处理关键数据质量问题后再启动训练。", taskTypeToCN(taskType), reliabilityToCN(reliability), trainabilityToCN(trainability))

	if len(recommendations) == 0 {
		recommendations = []string{"数据质量整体可接受，可直接进入小规模试训并观察验证指标。"}
	}

	return map[string]interface{}{
		"task_type":       taskType,
		"confidence":      confidence,
		"trainability":    trainability,
		"reliability":     reliability,
		"issues":          issuesCN,
		"issue_codes":     issueCodes,
		"summary":         summary,
		"recommendations": recommendations,
		"stats":           stats,
	}
}

func (a *DataAgent) matchTaskTemplate(columns, hints []string, hasLabel bool) (string, float64) {
	if len(columns) == 0 {
		return "other", 0.35
	}

	colSet := make(map[string]struct{}, len(columns))
	for _, col := range columns {
		colSet[strings.ToLower(strings.TrimSpace(col))] = struct{}{}
	}

	bestType := "other"
	bestScore := -999.0
	for _, t := range a.templates {
		score := 0.0
		missingRequired := 0

		for _, req := range t.RequiredCols {
			reqLower := strings.ToLower(strings.TrimSpace(req))
			if hasColumnLike(colSet, reqLower) {
				score += 1.0
			} else {
				missingRequired++
				score -= 0.7
			}
		}
		for _, opt := range t.OptionalCols {
			optLower := strings.ToLower(strings.TrimSpace(opt))
			if hasColumnLike(colSet, optLower) {
				score += 0.25
			}
		}
		for _, hint := range hints {
			if strings.EqualFold(strings.TrimSpace(hint), t.TaskType) {
				score += 1.0
				break
			}
		}
		if t.LabelRequired && !hasLabel {
			score -= 0.8
		}
		if missingRequired == 0 {
			score += 0.3
		}

		if score > bestScore {
			bestScore = score
			bestType = t.TaskType
		}
	}

	confidence := 0.45 + bestScore*0.08
	if bestType == "other" {
		confidence = 0.40
	}
	if confidence < 0.35 {
		confidence = 0.35
	}
	if confidence > 0.95 {
		confidence = 0.95
	}

	if len(hints) > 0 && bestType == "other" {
		bestType = strings.ToLower(strings.TrimSpace(hints[0]))
	}
	if bestType == "" {
		bestType = "other"
	}

	return bestType, round2(confidence)
}

func (a *DataAgent) tryLoadTemplatesFromAssets() {
	if a.executor == nil {
		return
	}
	filePath := filepath.Join(a.executor.ScriptsDir, "data", "assets", "task_templates.json")
	b, err := os.ReadFile(filePath)
	if err != nil {
		return
	}

	var parsed []dataTaskTemplate
	if err := json.Unmarshal(b, &parsed); err != nil {
		return
	}
	if len(parsed) > 0 {
		a.templates = parsed
		utils.Info("DataAgent: loaded %d task templates from %s", len(parsed), filePath)
	}
}

func defaultDataTaskTemplates() []dataTaskTemplate {
	return []dataTaskTemplate{
		{TaskType: "text_classification", RequiredCols: []string{"text", "label"}, OptionalCols: []string{"content", "category", "class"}, LabelRequired: true},
		{TaskType: "sentiment_analysis", RequiredCols: []string{"text", "sentiment"}, OptionalCols: []string{"label", "review"}, LabelRequired: true},
		{TaskType: "named_entity_recognition", RequiredCols: []string{"tokens", "tags"}, OptionalCols: []string{"ner_tags", "text"}, LabelRequired: true},
		{TaskType: "summarization", RequiredCols: []string{"source", "summary"}, OptionalCols: []string{"title", "text"}, LabelRequired: false},
		{TaskType: "text_generation", RequiredCols: []string{"instruction", "output"}, OptionalCols: []string{"input", "history"}, LabelRequired: false},
	}
}

func mergeDataReportWithLLM(report map[string]interface{}, llm map[string]interface{}) {
	if v := strings.TrimSpace(toString(llm["task_type"])); v != "" {
		report["task_type"] = v
	}
	if v := toFloat(llm["confidence"]); v > 0 {
		report["confidence"] = round2(v)
	}
	if v := strings.TrimSpace(toString(llm["trainability"])); v != "" {
		report["trainability"] = strings.ToLower(v)
	}
	if v := strings.TrimSpace(toString(llm["reliability"])); v != "" {
		report["reliability"] = strings.ToLower(v)
	}
	if v := strings.TrimSpace(toString(llm["summary"])); v != "" {
		report["summary"] = v
	}
	if xs := toStringSlice(llm["issues"]); len(xs) > 0 {
		report["issues"] = xs
	}
	if xs := toStringSlice(llm["recommendations"]); len(xs) > 0 {
		report["recommendations"] = xs
	}
}

func hasColumnLike(set map[string]struct{}, target string) bool {
	if _, ok := set[target]; ok {
		return true
	}
	for col := range set {
		if strings.Contains(col, target) || strings.Contains(target, col) {
			return true
		}
	}
	return false
}

func calcLabelImbalance(raw interface{}) float64 {
	m := normalizeMap(raw)
	if len(m) < 2 {
		return 0
	}
	maxV := 0.0
	minV := 0.0
	first := true
	for _, v := range m {
		f := toFloat(v)
		if f <= 0 {
			continue
		}
		if first {
			maxV, minV = f, f
			first = false
			continue
		}
		if f > maxV {
			maxV = f
		}
		if f < minV {
			minV = f
		}
	}
	if minV <= 0 {
		return 0
	}
	return maxV / minV
}

func ruleDerivedIssueCodes(rowCount int, nullRatio, dupRatio, emptyTextRatio, imbalance float64, textCol, labelCol string) []string {
	issues := make([]string, 0, 8)
	if rowCount < 50 {
		issues = append(issues, "row_count_low")
	}
	if nullRatio > 0.10 {
		issues = append(issues, "high_null_ratio")
	}
	if dupRatio > 0.20 {
		issues = append(issues, "high_duplicate_ratio")
	}
	if strings.TrimSpace(textCol) == "" {
		issues = append(issues, "text_column_missing")
	}
	if emptyTextRatio > 0.05 {
		issues = append(issues, "empty_text_rows")
	}
	if strings.TrimSpace(labelCol) == "" {
		issues = append(issues, "label_column_missing")
	}
	if imbalance > 10 {
		issues = append(issues, "label_imbalance")
	}
	return issues
}

func uniqueIssueCodes(input []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(input))
	for _, item := range input {
		s := strings.TrimSpace(strings.ToLower(item))
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

func translateIssues(codes []string) []string {
	out := make([]string, 0, len(codes))
	for _, c := range codes {
		switch c {
		case "row_count_low":
			out = append(out, "样本量偏少")
		case "high_null_ratio":
			out = append(out, "缺失值比例偏高")
		case "high_duplicate_ratio":
			out = append(out, "重复样本比例偏高")
		case "empty_text_rows":
			out = append(out, "存在空文本样本")
		case "text_column_missing":
			out = append(out, "缺少可识别文本字段")
		case "label_column_missing":
			out = append(out, "缺少标签字段")
		case "single_class":
			out = append(out, "标签类别不足（单类别）")
		case "label_imbalance":
			out = append(out, "标签分布不均衡")
		default:
			out = append(out, c)
		}
	}
	return out
}

func buildRecommendations(codes []string) []string {
	rec := make([]string, 0, 6)
	for _, c := range codes {
		switch c {
		case "row_count_low":
			rec = append(rec, "优先补充样本量，建议每类至少 100 条起步。")
		case "high_null_ratio", "empty_text_rows":
			rec = append(rec, "清理空值与空文本，训练前确保关键列非空。")
		case "high_duplicate_ratio":
			rec = append(rec, "去重后再训练，避免重复样本导致评估偏高。")
		case "label_imbalance":
			rec = append(rec, "对少数类进行重采样或类别加权，缓解类别不平衡。")
		case "text_column_missing":
			rec = append(rec, "确认文本输入列名称，并映射为 text/source/instruction 等标准字段。")
		case "label_column_missing", "single_class":
			rec = append(rec, "补齐标签列并检查标签空间，确保可监督训练。")
		}
	}
	if len(rec) > 3 {
		rec = rec[:3]
	}
	return rec
}

func bucketScore(v float64) string {
	if v >= 0.75 {
		return "high"
	}
	if v >= 0.45 {
		return "medium"
	}
	return "low"
}

func taskTypeToCN(task string) string {
	switch strings.ToLower(strings.TrimSpace(task)) {
	case "text_classification":
		return "文本分类"
	case "named_entity_recognition":
		return "命名实体识别"
	case "summarization":
		return "摘要"
	case "text_generation":
		return "指令生成"
	case "sentiment_analysis":
		return "情感分析"
	default:
		return "通用文本任务"
	}
}

func reliabilityToCN(v string) string {
	switch v {
	case "high":
		return "高"
	case "medium":
		return "中"
	default:
		return "低"
	}
}

func trainabilityToCN(v string) string {
	switch v {
	case "high":
		return "高"
	case "medium":
		return "中"
	default:
		return "低"
	}
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func nullableString(v string) interface{} {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func nullableInt(v int) interface{} {
	if v <= 0 {
		return nil
	}
	return v
}

func normalizeMap(v interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	switch m := v.(type) {
	case map[string]interface{}:
		for k, vv := range m {
			out[k] = vv
		}
	case map[interface{}]interface{}:
		for k, vv := range m {
			out[toString(k)] = vv
		}
	}
	return out
}

func toFloat(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(strings.TrimSpace(x), "%f", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

func toInt(v interface{}) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case float32:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(x), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

func toString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	default:
		return fmt.Sprintf("%v", x)
	}
}

func toStringSlice(v interface{}) []string {
	out := []string{}
	switch xs := v.(type) {
	case []string:
		for _, item := range xs {
			s := strings.TrimSpace(item)
			if s != "" {
				out = append(out, s)
			}
		}
	case []interface{}:
		for _, item := range xs {
			s := strings.TrimSpace(toString(item))
			if s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}
