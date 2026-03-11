package utils

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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

// CommandArgs returns the executable name and arguments to run a Python script (for exec.Command).
// On Windows: 若 .env 中配置了 PYTHON_PATH（如 python、python3 或完整路径），则优先使用，避免因系统无 py 导致 9009。
// 仅在 PYTHON_PATH 为空时使用 "py -3"。
func (e *PythonExecutor) CommandArgs(script string, args ...string) (name string, cmdArgs []string) {
	scriptPath := filepath.Join(e.ScriptsDir, script)
	fullArgs := append([]string{scriptPath}, args...)
	if runtime.GOOS == "windows" {
		if e.PythonPath != "" {
			return e.PythonPath, fullArgs
		}
		return "py", append([]string{"-3", scriptPath}, args...)
	}
	return e.PythonPath, fullArgs
}

// runCommand runs the given Python command and returns output and error.
func runCommand(pythonExe string, args []string) ([]byte, error) {
	cmd := exec.Command(pythonExe, args...)
	return cmd.CombinedOutput()
}

// isWindowsPythonNotFound returns true if the error is Windows "Python not found" (exit 9009 or typical message).
func isWindowsPythonNotFound(err error, output []byte) bool {
	if err == nil {
		return false
	}
	if runtime.GOOS != "windows" {
		return false
	}
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 9009 {
		return true
	}
	msg := string(output)
	return len(msg) > 0 && (strings.Contains(msg, "Python was not found") || strings.Contains(msg, "py is not recognized"))
}

// Execute runs a Python script with arguments and returns JSON result.
// On Windows, tries "py -3" first (Python launcher), then the configured PYTHON_PATH, so that
// both "Python from python.org" (py) and direct "python"/"python3" in PATH work.
func (e *PythonExecutor) Execute(script string, args ...string) (map[string]interface{}, error) {
	scriptPath := filepath.Join(e.ScriptsDir, script)
	cmdArgs := append([]string{scriptPath}, args...)

	var output []byte
	var err error

	if runtime.GOOS == "windows" {
		// Windows: try "py -3" first (standard when Python is installed from python.org)
		launcherArgs := append([]string{"-3", scriptPath}, args...)
		output, err = runCommand("py", launcherArgs)
		if err != nil && isWindowsPythonNotFound(err, output) {
			// Fallback to configured PYTHON_PATH (e.g. python or python3)
			output, err = runCommand(e.PythonPath, cmdArgs)
		}
	} else {
		output, err = runCommand(e.PythonPath, cmdArgs)
		if err != nil && e.PythonPath == "python3" {
			output, err = runCommand("python", cmdArgs)
		}
	}

	if err != nil {
		msg := fmt.Sprintf("python execution failed: %v, output: %s", err, string(output))
		if runtime.GOOS == "windows" && isWindowsPythonNotFound(err, output) {
			msg += " (Windows: 请安装 Python 并将「py」或「python」加入 PATH，或在 .env 中设置 PYTHON_PATH 为 python 可执行文件路径)"
		}
		return nil, fmt.Errorf("%s", msg)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python output: %v, output: %s", err, string(output))
	}
	return result, nil
}
