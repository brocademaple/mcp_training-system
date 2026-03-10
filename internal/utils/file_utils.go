package utils

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"time"
)

// SaveUploadedFile saves an uploaded file to the destination directory
func SaveUploadedFile(file multipart.File, filename string, destDir string) (string, error) {
	// Ensure destination directory exists
	if err := EnsureDir(destDir); err != nil {
		return "", err
	}

	// Create destination file path
	destPath := filepath.Join(destDir, filename)

	// Create destination file
	destFile, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %v", err)
	}
	defer destFile.Close()

	// Copy file content
	if _, err := io.Copy(destFile, file); err != nil {
		return "", fmt.Errorf("failed to copy file: %v", err)
	}

	return destPath, nil
}

// EnsureDir ensures a directory exists, creates it if not
func EnsureDir(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %v", err)
		}
	}
	return nil
}

// GetFileSize returns the size of a file in bytes
func GetFileSize(path string) (int64, error) {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("failed to get file info: %v", err)
	}
	return fileInfo.Size(), nil
}

// ValidateCSVFile validates if a file is a valid CSV file
func ValidateCSVFile(path string) error {
	// Check file extension
	ext := filepath.Ext(path)
	if ext != ".csv" {
		return fmt.Errorf("invalid file extension: %s, expected .csv", ext)
	}

	// Check if file exists and is readable
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	return nil
}

// GetTimestamp returns current Unix timestamp
func GetTimestamp() int64 {
	return time.Now().Unix()
}
