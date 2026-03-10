package mcp

import (
	"database/sql"
	"fmt"

	"github.com/redis/go-redis/v9"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/utils"
)

// Coordinator coordinates communication between agents
type Coordinator struct {
	dataAgent       *agents.DataAgent
	trainingAgent   *agents.TrainingAgent
	evaluationAgent *agents.EvaluationAgent
}

// NewCoordinator creates a new MCP coordinator
func NewCoordinator(
	dataAgent *agents.DataAgent,
	trainingAgent *agents.TrainingAgent,
	evaluationAgent *agents.EvaluationAgent,
) *Coordinator {
	return &Coordinator{
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
		return c.evaluationAgent.Evaluate(modelID, testDatasetID)
	default:
		return fmt.Errorf("unknown action: %s", msg.Action)
	}
}

// ExecuteWorkflow executes a complete workflow: upload -> clean -> train -> evaluate
func (c *Coordinator) ExecuteWorkflow(datasetID int) error {
	utils.Info("MCP Coordinator: Starting workflow for dataset %d", datasetID)

	// Step 1: Clean data
	msg1 := NewRequest("coordinator", "data-agent", "clean_data", map[string]interface{}{
		"dataset_id": float64(datasetID),
	})
	resp1, err := c.RouteMessage(msg1)
	if err != nil {
		utils.Error("Workflow failed at clean_data: %v", err)
		return err
	}
	utils.Info("Workflow: Data cleaning completed - %v", resp1.Payload)

	utils.Info("Workflow: Complete! Dataset ready for training")
	return nil
}
