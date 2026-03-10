package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

var (
	infoLogger  *log.Logger
	errorLogger *log.Logger
)

// InitLogger initializes the logger
func InitLogger(logDir string) error {
	// Ensure log directory exists
	if err := EnsureDir(logDir); err != nil {
		return err
	}

	// Create log file
	logFile := filepath.Join(logDir, fmt.Sprintf("app_%s.log", time.Now().Format("2006-01-02")))
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		return fmt.Errorf("failed to open log file: %v", err)
	}

	// Create loggers
	infoLogger = log.New(file, "[INFO] ", log.Ldate|log.Ltime|log.Lshortfile)
	errorLogger = log.New(file, "[ERROR] ", log.Ldate|log.Ltime|log.Lshortfile)

	return nil
}

// Info logs an info message
func Info(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if infoLogger != nil {
		infoLogger.Output(2, msg)
	}
	fmt.Printf("[INFO] %s\n", msg)
}

// Error logs an error message
func Error(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if errorLogger != nil {
		errorLogger.Output(2, msg)
	}
	fmt.Printf("[ERROR] %s\n", msg)
}

// Warning logs a warning message
func Warning(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if infoLogger != nil {
		infoLogger.Output(2, "[WARNING] "+msg)
	}
	fmt.Printf("[WARNING] %s\n", msg)
}
