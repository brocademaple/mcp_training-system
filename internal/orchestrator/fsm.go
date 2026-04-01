package orchestrator

// 编排状态（与 Vibe Spec 对齐；可与 current_step 并存便于旧前端）。
const (
	StateReceived         = "RECEIVED"
	StateTaskIdentified   = "TASK_IDENTIFIED"
	StateMethodSelected   = "METHOD_SELECTED"
	StateDomainResolved   = "DOMAIN_RESOLVED"
	StateDataValidated    = "DATA_VALIDATED"
	StateTrainingRunning  = "TRAINING_RUNNING"
	StateTrainingFinished = "TRAINING_FINISHED"
	StateEvaluating       = "EVALUATING"
	StateCompleted        = "COMPLETED"
)

const (
	FailTaskParse    = "FAILED_TASK_PARSE"
	FailDataSchema   = "FAILED_DATA_SCHEMA"
	FailTraining     = "FAILED_TRAINING"
	FailEvaluation   = "FAILED_EVALUATION"
)

// MapLegacyStepToOrchestration 将旧 current_step 映射为编排状态（用于未回填 orchestration_state 的行）。
func MapLegacyStepToOrchestration(status, currentStep string) string {
	if status == "completed" {
		return StateCompleted
	}
	if status == "failed" {
		if currentStep == "clean_data" {
			return FailDataSchema
		}
		if currentStep == "train" {
			return FailTraining
		}
		if currentStep == "evaluate" {
			return FailEvaluation
		}
		return "FAILED"
	}
	switch currentStep {
	case "clean_data":
		return StateDomainResolved
	case "train":
		return StateTrainingRunning
	case "evaluate":
		return StateEvaluating
	default:
		if status == "running" {
			return StateReceived
		}
		return StateReceived
	}
}
