package mcp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/orchestrator"
	"mcp-training-system/internal/services"
	"mcp-training-system/internal/utils"
)

// Coordinator coordinates communication between agents
type Coordinator struct {
	db              *sql.DB
	dataAgent       *agents.DataAgent
	trainingAgent   *agents.TrainingAgent
	evaluationAgent *agents.EvaluationAgent
}

// NewCoordinator creates a new MCP coordinator
func NewCoordinator(
	db *sql.DB,
	dataAgent *agents.DataAgent,
	trainingAgent *agents.TrainingAgent,
	evaluationAgent *agents.EvaluationAgent,
) *Coordinator {
	return &Coordinator{
		db:              db,
		dataAgent:       dataAgent,
		trainingAgent:   trainingAgent,
		evaluationAgent: evaluationAgent,
	}
}

// RouteMessage routes MCP messages to appropriate agents
func (c *Coordinator) RouteMessage(msg *MCPMessage) (*MCPMessage, error) {
	utils.Info("MCP Coordinator: Routing message to %s, action: %s", msg.To, msg.Action)

	var err error
	var response *MCPMessage

	switch msg.To {
	case "data-agent":
		err = c.handleDataAgentMessage(msg)
		response = NewResponse("data-agent", msg.From, msg.Action, map[string]interface{}{
			"status": "success",
		})

	case "training-agent":
		err = c.handleTrainingAgentMessage(msg)
		response = NewResponse("training-agent", msg.From, msg.Action, map[string]interface{}{
			"status": "success",
		})

	case "evaluation-agent":
		err = c.handleEvaluationAgentMessage(msg)
		response = NewResponse("evaluation-agent", msg.From, msg.Action, map[string]interface{}{
			"status": "success",
		})

	default:
		return nil, fmt.Errorf("unknown agent: %s", msg.To)
	}

	if err != nil {
		response.Payload["status"] = "error"
		response.Payload["error"] = err.Error()
	}

	return response, err
}

// handleDataAgentMessage handles messages for data agent
func (c *Coordinator) handleDataAgentMessage(msg *MCPMessage) error {
	switch msg.Action {
	case "clean_data":
		datasetID := int(msg.Payload["dataset_id"].(float64))
		var dataAgentPrompt string
		if p, ok := msg.Payload["data_agent_prompt"].(string); ok && p != "" {
			dataAgentPrompt = p
		}
		return c.dataAgent.CleanData(datasetID, dataAgentPrompt)
	case "analyze_data":
		datasetID := int(msg.Payload["dataset_id"].(float64))
		_, err := c.dataAgent.AnalyzeData(datasetID)
		return err
	case "validate_quality":
		filePath := msg.Payload["file_path"].(string)
		taskFamily := msg.Payload["task_family"].(string)
		_, _, err := c.dataAgent.ValidateQuality(filePath, taskFamily)
		return err
	default:
		return fmt.Errorf("unknown action: %s", msg.Action)
	}
}

// handleTrainingAgentMessage handles messages for training agent
func (c *Coordinator) handleTrainingAgentMessage(msg *MCPMessage) error {
	switch msg.Action {
	case "train":
		jobID := int(msg.Payload["job_id"].(float64))
		return c.trainingAgent.Train(jobID)
	default:
		return fmt.Errorf("unknown action: %s", msg.Action)
	}
}

// handleEvaluationAgentMessage handles messages for evaluation agent
func (c *Coordinator) handleEvaluationAgentMessage(msg *MCPMessage) error {
	switch msg.Action {
	case "evaluate":
		modelID := int(msg.Payload["model_id"].(float64))
		testDatasetID := 0
		if val, ok := msg.Payload["test_dataset_id"]; ok {
			testDatasetID = int(val.(float64))
		}
		return c.evaluationAgent.Evaluate(modelID, testDatasetID, 0)
	default:
		return fmt.Errorf("unknown action: %s", msg.Action)
	}
}

// RunPipeline executes a pipeline: 默认 clean -> train -> evaluate；agentFlow=train_only 时在训练完成后结束，不跑评估。
// pipelineRunSpec 可选：整条流水线的 RunSpec JSON；dataAgentPrompt 为用户在前端设定的 Data Agent 规划偏好。
func (c *Coordinator) RunPipeline(datasetID int, trainConfig map[string]interface{}, dataAgentPrompt, planID, planSummary string, pipelineRunSpec []byte, agentFlow string) (*models.PipelineInstance, error) {
	sessionID := uuid.New().String()
	utils.Info("MCP Coordinator: Starting pipeline for dataset %d, session: %s", datasetID, sessionID)

	var pipelineID int
	var runSpecArg interface{}
	if len(pipelineRunSpec) > 0 {
		runSpecArg = pipelineRunSpec
	}
	err := c.db.QueryRow(`
		INSERT INTO pipeline_instances (session_id, dataset_id, status, current_step, orchestration_state, data_agent_prompt, plan_id, plan_summary, run_spec)
		VALUES ($1, $2, 'running', 'clean_data', $6, NULLIF(TRIM($3), ''), NULLIF(TRIM($4), ''), NULLIF(TRIM($5), ''), $7)
		RETURNING id
	`, sessionID, datasetID, dataAgentPrompt, planID, planSummary, orchestrator.StateTaskIdentified, runSpecArg).Scan(&pipelineID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pipeline instance: %v", err)
	}

	go c.executePipelineAsync(pipelineID, sessionID, datasetID, trainConfig, dataAgentPrompt, agentFlow, pipelineRunSpec)

	pipeline := &models.PipelineInstance{
		ID:                 pipelineID,
		SessionID:          sessionID,
		DatasetID:          datasetID,
		Status:             "running",
		CurrentStep:        "clean_data",
		OrchestrationState: orchestrator.StateTaskIdentified,
		DataAgentPrompt:    dataAgentPrompt,
		PlanID:             planID,
		PlanSummary:        planSummary,
		RunSpec:            pipelineRunSpec,
	}
	return pipeline, nil
}

func (c *Coordinator) executePipelineAsync(pipelineID int, sessionID string, datasetID int, trainConfig map[string]interface{}, dataAgentPrompt string, agentFlow string, pipelineRunSpec []byte) {
	flow := strings.ToLower(strings.TrimSpace(agentFlow))
	defer func() {
		if r := recover(); r != nil {
			utils.Error("Pipeline %d panic: %v", pipelineID, r)
			c.updatePipelineFailed(pipelineID, "clean_data", fmt.Sprintf("panic: %v", r), orchestrator.FailTaskParse)
		}
	}()

	// 检查并释放超时任务
	c.dataAgent.CheckTaskTimeout()

	c.setOrchestrationState(pipelineID, orchestrator.StateMethodSelected, "")

	// Step 1: Clean data（将 data_agent_prompt 传入 payload，供 Data Agent 当前/后续使用）
	extraClean := make(map[string]interface{})
	if dataAgentPrompt != "" {
		extraClean["data_agent_prompt"] = dataAgentPrompt
	}
	c.setOrchestrationState(pipelineID, orchestrator.StateDomainResolved, "")
	if err := c.executeStep(pipelineID, sessionID, "clean_data", datasetID, extraClean); err != nil {
		c.updatePipelineFailed(pipelineID, "clean_data", err.Error(), orchestrator.FailDataSchema)
		return
	}

	// Step 1.5: Quality validation（Data Agent：validate_quality）
	// 将 run_spec 中的语义任务类型映射为 validate_quality.py 需要的 task_family：
	// Classification / SequenceTagging / Generation / Alignment
	taskFamily := func() string {
		var rs map[string]interface{}
		// pipelineRunSpec 可能为前端 RunSpec 结构（未必严格匹配 internal/models.RunSpec），因此使用容错解析
		if err := json.Unmarshal(pipelineRunSpec, &rs); err != nil {
			return "Classification"
		}
		taskSpec, ok := rs["task_spec"].(map[string]interface{})
		if !ok {
			return "Classification"
		}
		raw, ok := taskSpec["semantic_task_type"].(string)
		if !ok {
			return "Classification"
		}
		t := strings.ToLower(raw)
		if strings.Contains(t, "ner") {
			return "SequenceTagging"
		}
		if strings.Contains(t, "summar") {
			return "Generation"
		}
		if strings.Contains(t, "preference") || strings.Contains(t, "alignment") {
			return "Alignment"
		}
		return "Classification"
	}()

	var cleanedPath sql.NullString
	if err := c.db.QueryRow(
		"SELECT cleaned_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&cleanedPath); err != nil {
		c.updatePipelineFailed(pipelineID, "clean_data", fmt.Sprintf("query cleaned_file_path failed: %v", err), orchestrator.FailDataSchema)
		return
	}
	if !cleanedPath.Valid || cleanedPath.String == "" {
		c.updatePipelineFailed(pipelineID, "clean_data", "cleaned_file_path is empty; skip validate_quality", orchestrator.FailDataSchema)
		return
	}

	valid, result, err := c.dataAgent.ValidateQuality(cleanedPath.String, taskFamily)
	if err != nil {
		c.updatePipelineFailed(pipelineID, "clean_data", fmt.Sprintf("validate_quality error: %v", err), orchestrator.FailDataSchema)
		return
	}
	if !valid {
		c.updatePipelineFailed(
			pipelineID,
			"clean_data",
			fmt.Sprintf("validate_quality failed: %v", result["summary"]),
			orchestrator.FailDataSchema,
		)
		return
	}

	c.setOrchestrationState(pipelineID, orchestrator.StateDataValidated, "")

	// Step 2: Create and train
	c.updatePipelineStep(pipelineID, "train")
	jobID, err := c.createTrainingJob(datasetID, trainConfig)
	if err != nil {
		c.updatePipelineFailed(pipelineID, "train", err.Error(), orchestrator.FailTraining)
		return
	}
	c.updatePipelineJobID(pipelineID, jobID)

	c.setOrchestrationState(pipelineID, orchestrator.StateTrainingRunning, "")
	if err := c.executeStep(pipelineID, sessionID, "train", jobID, nil); err != nil {
		c.updatePipelineFailed(pipelineID, "train", err.Error(), orchestrator.FailTraining)
		return
	}
	c.setOrchestrationState(pipelineID, orchestrator.StateTrainingFinished, "")

	// Get model_id from models table (训练完成后由 TrainingAgent 写入)
	var modelID int
	err = c.db.QueryRow("SELECT id FROM models WHERE job_id = $1 ORDER BY id DESC LIMIT 1", jobID).Scan(&modelID)
	if err != nil {
		c.updatePipelineFailed(pipelineID, "train", "no model created", orchestrator.FailTraining)
		return
	}
	c.updatePipelineModelID(pipelineID, modelID)

	if flow == "train_only" {
		c.setOrchestrationState(pipelineID, orchestrator.StateCompleted, "")
		c.updatePipelineStatus(pipelineID, "completed", "train", "")
		utils.Info("Pipeline %d completed successfully (train_only, skip evaluate)", pipelineID)
		return
	}

	// Step 3: Evaluate
	c.updatePipelineStep(pipelineID, "evaluate")
	c.setOrchestrationState(pipelineID, orchestrator.StateEvaluating, "")
	if err := c.executeStep(pipelineID, sessionID, "evaluate", modelID, map[string]interface{}{"test_dataset_id": 0}); err != nil {
		c.updatePipelineFailed(pipelineID, "evaluate", err.Error(), orchestrator.FailEvaluation)
		return
	}

	// 评估完成后写入 eval_id（EvaluationAgent 会创建一条 evaluations 记录）
	var evalID int
	_ = c.db.QueryRow("SELECT id FROM evaluations WHERE model_id = $1 ORDER BY id DESC LIMIT 1", modelID).Scan(&evalID)
	if evalID > 0 {
		c.updatePipelineEvalID(pipelineID, evalID)
	}

	c.setOrchestrationState(pipelineID, orchestrator.StateCompleted, "")
	c.updatePipelineStatus(pipelineID, "completed", "evaluate", "")
	utils.Info("Pipeline %d completed successfully", pipelineID)
}

func (c *Coordinator) executeStep(pipelineID int, sessionID, action string, targetID int, extra map[string]interface{}) error {
	var msg *MCPMessage
	payload := make(map[string]interface{})

	switch action {
	case "clean_data":
		payload["dataset_id"] = float64(targetID)
		if extra != nil {
			if p, ok := extra["data_agent_prompt"]; ok && p != nil {
				payload["data_agent_prompt"] = p
			}
		}
		msg = NewRequest("coordinator", "data-agent", action, payload)
	case "train":
		payload["job_id"] = float64(targetID)
		msg = NewRequest("coordinator", "training-agent", action, payload)
	case "evaluate":
		payload["model_id"] = float64(targetID)
		if extra != nil {
			for k, v := range extra {
				payload[k] = v
			}
		}
		msg = NewRequest("coordinator", "evaluation-agent", action, payload)
	}

	msg.SessionID = sessionID
	msg.PipelineInstanceID = fmt.Sprintf("%d", pipelineID)

	_, err := c.RouteMessage(msg)
	return err
}

func (c *Coordinator) createTrainingJob(datasetID int, config map[string]interface{}) (int, error) {
	modelType := "text_classification"
	if mt, ok := config["model_type"].(string); ok && mt != "" {
		modelType = mt
	}
	var runSpecJSON []byte
	if raw, ok := config["run_spec"]; ok && raw != nil {
		switch t := raw.(type) {
		case map[string]interface{}:
			runSpecJSON, _ = json.Marshal(t)
		case string:
			runSpecJSON = []byte(t)
		case *models.RunSpec:
			runSpecJSON, _ = json.Marshal(t)
		}
	}
	hyperparams := make(map[string]interface{})
	if config != nil {
		for k, v := range config {
			if k == "model_type" || k == "run_spec" {
				continue
			}
			hyperparams[k] = v
		}
	}
	if len(runSpecJSON) > 0 {
		if rs, err := models.ParseRunSpec(runSpecJSON); err == nil {
			services.MergeMethodDefaults(rs)
			modelType = models.ExecutionModelType(rs)
			hyperparams = models.MergeRunSpecIntoHyperparams(hyperparams, rs)
		}
	}
	if hyperparams["epochs"] == nil {
		hyperparams["epochs"] = 3.0
	}
	if hyperparams["learning_rate"] == nil {
		hyperparams["learning_rate"] = 2e-5
	}
	if hyperparams["batch_size"] == nil {
		hyperparams["batch_size"] = 16.0
	}
	hyperparamsJSON, _ := json.Marshal(hyperparams)
	totalEpochs := 3
	if e, ok := hyperparams["epochs"].(float64); ok {
		totalEpochs = int(e)
	}

	var jobID int
	var rsArg interface{}
	if len(runSpecJSON) > 0 {
		rsArg = runSpecJSON
	}
	err := c.db.QueryRow(`
		INSERT INTO training_jobs (user_id, dataset_id, name, model_type, hyperparams, run_spec, status, total_epochs)
		VALUES (1, $1, $2, $3, $4, $5, 'queued', $6)
		RETURNING id
	`, datasetID, fmt.Sprintf("流水线-数据集%d", datasetID), modelType, hyperparamsJSON, rsArg, totalEpochs).Scan(&jobID)
	return jobID, err
}

func (c *Coordinator) updatePipelineStep(pipelineID int, step string) {
	c.db.Exec("UPDATE pipeline_instances SET current_step = $1, updated_at = NOW() WHERE id = $2", step, pipelineID)
}

func (c *Coordinator) updatePipelineStatus(pipelineID int, status, step, errMsg string) {
	c.db.Exec("UPDATE pipeline_instances SET status = $1, current_step = $2, error_msg = $3, updated_at = NOW() WHERE id = $4",
		status, step, errMsg, pipelineID)
}

func (c *Coordinator) setOrchestrationState(pipelineID int, state string, failureCode string) {
	var fc interface{}
	if failureCode != "" {
		fc = failureCode
	}
	_, _ = c.db.Exec(`UPDATE pipeline_instances SET orchestration_state = $1, failure_code = $2, updated_at = NOW() WHERE id = $3`,
		state, fc, pipelineID)
}

func (c *Coordinator) updatePipelineFailed(pipelineID int, step, errMsg, failCode string) {
	_, _ = c.db.Exec(`
		UPDATE pipeline_instances SET status = 'failed', current_step = $1, error_msg = $2,
			orchestration_state = $3, failure_code = $3, updated_at = NOW() WHERE id = $4
	`, step, errMsg, failCode, pipelineID)
}


func (c *Coordinator) updatePipelineJobID(pipelineID, jobID int) {
	c.db.Exec("UPDATE pipeline_instances SET job_id = $1, updated_at = NOW() WHERE id = $2", jobID, pipelineID)
}

func (c *Coordinator) updatePipelineModelID(pipelineID, modelID int) {
	c.db.Exec("UPDATE pipeline_instances SET model_id = $1, updated_at = NOW() WHERE id = $2", modelID, pipelineID)
}

func (c *Coordinator) updatePipelineEvalID(pipelineID, evalID int) {
	c.db.Exec("UPDATE pipeline_instances SET eval_id = $1, updated_at = NOW() WHERE id = $2", evalID, pipelineID)
}

// GetPipelineStatus retrieves pipeline status
func (c *Coordinator) GetPipelineStatus(pipelineID int) (*models.PipelineInstance, error) {
	var p models.PipelineInstance
	var orch, fail sql.NullString
	var runSpecBytes []byte
	err := c.db.QueryRow(`
		SELECT id, session_id, dataset_id, status, current_step, orchestration_state, failure_code, run_spec,
			job_id, model_id, eval_id, error_msg, data_agent_prompt, plan_id, plan_summary, created_at, updated_at
		FROM pipeline_instances WHERE id = $1
	`, pipelineID).Scan(&p.ID, &p.SessionID, &p.DatasetID, &p.Status, &p.CurrentStep, &orch, &fail, &runSpecBytes, &p.JobID, &p.ModelID, &p.EvalID, &p.ErrorMsg, &p.DataAgentPrompt, &p.PlanID, &p.PlanSummary, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if orch.Valid {
		p.OrchestrationState = orch.String
	} else {
		p.OrchestrationState = orchestrator.MapLegacyStepToOrchestration(p.Status, p.CurrentStep)
	}
	if fail.Valid {
		p.FailureCode = fail.String
	}
	if len(runSpecBytes) > 0 {
		p.RunSpec = runSpecBytes
	}
	return &p, nil
}
