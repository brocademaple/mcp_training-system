package mcp

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
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
		return c.dataAgent.CleanData(datasetID)
	case "analyze_data":
		datasetID := int(msg.Payload["dataset_id"].(float64))
		_, err := c.dataAgent.AnalyzeData(datasetID)
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

// RunPipeline executes a complete pipeline: clean -> train -> evaluate
func (c *Coordinator) RunPipeline(datasetID int, trainConfig map[string]interface{}) (*models.PipelineInstance, error) {
	sessionID := uuid.New().String()
	utils.Info("MCP Coordinator: Starting pipeline for dataset %d, session: %s", datasetID, sessionID)

	// Create pipeline instance
	var pipelineID int
	err := c.db.QueryRow(`
		INSERT INTO pipeline_instances (session_id, dataset_id, status, current_step)
		VALUES ($1, $2, 'running', 'clean_data')
		RETURNING id
	`, sessionID, datasetID).Scan(&pipelineID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pipeline instance: %v", err)
	}

	go c.executePipelineAsync(pipelineID, sessionID, datasetID, trainConfig)

	pipeline := &models.PipelineInstance{
		ID:          pipelineID,
		SessionID:   sessionID,
		DatasetID:   datasetID,
		Status:      "running",
		CurrentStep: "clean_data",
	}
	return pipeline, nil
}

func (c *Coordinator) executePipelineAsync(pipelineID int, sessionID string, datasetID int, trainConfig map[string]interface{}) {
	defer func() {
		if r := recover(); r != nil {
			utils.Error("Pipeline %d panic: %v", pipelineID, r)
			c.updatePipelineStatus(pipelineID, "failed", "", fmt.Sprintf("panic: %v", r))
		}
	}()

	// Step 1: Clean data
	if err := c.executeStep(pipelineID, sessionID, "clean_data", datasetID, nil); err != nil {
		c.updatePipelineStatus(pipelineID, "failed", "clean_data", err.Error())
		return
	}

	// Step 2: Create and train
	c.updatePipelineStep(pipelineID, "train")
	jobID, err := c.createTrainingJob(datasetID, trainConfig)
	if err != nil {
		c.updatePipelineStatus(pipelineID, "failed", "train", err.Error())
		return
	}
	c.updatePipelineJobID(pipelineID, jobID)

	if err := c.executeStep(pipelineID, sessionID, "train", jobID, nil); err != nil {
		c.updatePipelineStatus(pipelineID, "failed", "train", err.Error())
		return
	}

	// Get model_id from models table (训练完成后由 TrainingAgent 写入)
	var modelID int
	err = c.db.QueryRow("SELECT id FROM models WHERE job_id = $1 ORDER BY id DESC LIMIT 1", jobID).Scan(&modelID)
	if err != nil {
		c.updatePipelineStatus(pipelineID, "failed", "train", "no model created")
		return
	}
	c.updatePipelineModelID(pipelineID, modelID)

	// Step 3: Evaluate
	c.updatePipelineStep(pipelineID, "evaluate")
	if err := c.executeStep(pipelineID, sessionID, "evaluate", modelID, map[string]interface{}{"test_dataset_id": 0}); err != nil {
		c.updatePipelineStatus(pipelineID, "failed", "evaluate", err.Error())
		return
	}

	// 评估完成后写入 eval_id（EvaluationAgent 会创建一条 evaluations 记录）
	var evalID int
	_ = c.db.QueryRow("SELECT id FROM evaluations WHERE model_id = $1 ORDER BY id DESC LIMIT 1", modelID).Scan(&evalID)
	if evalID > 0 {
		c.updatePipelineEvalID(pipelineID, evalID)
	}

	c.updatePipelineStatus(pipelineID, "completed", "evaluate", "")
	utils.Info("Pipeline %d completed successfully", pipelineID)
}

func (c *Coordinator) executeStep(pipelineID int, sessionID, action string, targetID int, extra map[string]interface{}) error {
	var msg *MCPMessage
	payload := make(map[string]interface{})

	switch action {
	case "clean_data":
		payload["dataset_id"] = float64(targetID)
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
	// 从 config 构建 hyperparams，供训练脚本使用（含 base_model、epochs 等）
	hyperparams := make(map[string]interface{})
	if config != nil {
		for k, v := range config {
			if k == "model_type" {
				continue
			}
			hyperparams[k] = v
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
	err := c.db.QueryRow(`
		INSERT INTO training_jobs (user_id, dataset_id, name, model_type, hyperparams, status, total_epochs)
		VALUES (1, $1, $2, $3, $4, 'queued', $5)
		RETURNING id
	`, datasetID, fmt.Sprintf("流水线-数据集%d", datasetID), modelType, hyperparamsJSON, totalEpochs).Scan(&jobID)
	return jobID, err
}

func (c *Coordinator) updatePipelineStep(pipelineID int, step string) {
	c.db.Exec("UPDATE pipeline_instances SET current_step = $1, updated_at = NOW() WHERE id = $2", step, pipelineID)
}

func (c *Coordinator) updatePipelineStatus(pipelineID int, status, step, errMsg string) {
	c.db.Exec("UPDATE pipeline_instances SET status = $1, current_step = $2, error_msg = $3, updated_at = NOW() WHERE id = $4",
		status, step, errMsg, pipelineID)
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
	err := c.db.QueryRow(`
		SELECT id, session_id, dataset_id, status, current_step, job_id, model_id, eval_id, error_msg, created_at, updated_at
		FROM pipeline_instances WHERE id = $1
	`, pipelineID).Scan(&p.ID, &p.SessionID, &p.DatasetID, &p.Status, &p.CurrentStep, &p.JobID, &p.ModelID, &p.EvalID, &p.ErrorMsg, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}
