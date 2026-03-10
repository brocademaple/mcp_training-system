package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all configuration for the application
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Storage  StorageConfig
	Python   PythonConfig
}

// ServerConfig holds server configuration
type ServerConfig struct {
	Host string
	Port string
}

// DatabaseConfig holds database configuration
type DatabaseConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
}

// RedisConfig holds Redis configuration
type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
}

// StorageConfig holds storage paths configuration
type StorageConfig struct {
	UploadDir  string
	CleanedDir string
	ModelDir   string
	ReportDir  string
}

// PythonConfig holds Python configuration
type PythonConfig struct {
	PythonPath string
	ScriptsDir string
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	// Load .env file if exists (ignore error if not found)
	_ = godotenv.Load()

	// Parse Redis DB
	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))

	config := &Config{
		Server: ServerConfig{
			Host: getEnv("SERVER_HOST", "0.0.0.0"),
			Port: getEnv("SERVER_PORT", "8080"),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "mcp_user"),
			Password: getEnv("DB_PASSWORD", "mcp_password"),
			DBName:   getEnv("DB_NAME", "mcp_training"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       redisDB,
		},
		Storage: StorageConfig{
			UploadDir:  getEnv("UPLOAD_DIR", "./data/uploads"),
			CleanedDir: getEnv("CLEANED_DIR", "./data/cleaned"),
			ModelDir:   getEnv("MODEL_DIR", "./data/models"),
			ReportDir:  getEnv("REPORT_DIR", "./reports"),
		},
		Python: PythonConfig{
			PythonPath: getEnv("PYTHON_PATH", "python3"),
			ScriptsDir: getEnv("PYTHON_SCRIPTS_DIR", "./python_scripts"),
		},
	}

	return config, nil
}

// getEnv gets environment variable with default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
