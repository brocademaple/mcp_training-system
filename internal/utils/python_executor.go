package utils

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
)

// PythonExecutor executes Python scripts and returns results
type PythonExecutor struct {
	PythonPath string
	ScriptsDir string
}

// NewPythonExecutor creates a new Python executor
func NewPythonExecutor(pythonPath, scriptsDir string) *PythonExecutor {
	return &PythonExecutor{
		PythonPath: pythonPath,
		ScriptsDir: scriptsDir,
	}
}

// Execute runs a Python script with arguments and returns JSON result
func (e *PythonExecutor) Execute(script string, args ...string) (map[string]interface{}, error) {
	// Build full script path
	scriptPath := filepath.Join(e.ScriptsDir, script)

	// Prepare command arguments
	cmdArgs := append([]string{scriptPath}, args...)

	// Create command
	cmd := exec.Command(e.PythonPath, cmdArgs...)

	// Execute and capture output
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("python execution failed: %v, output: %s", err, string(output))
	}

	// Parse JSON output
	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python output: %v, output: %s", err, string(output))
	}

	return result, nil
}
