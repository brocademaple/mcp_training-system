package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/config"
	"mcp-training-system/internal/database"
	"mcp-training-system/internal/handlers"
	"mcp-training-system/internal/middleware"
	"mcp-training-system/internal/utils"
)

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize logger
	if err := utils.InitLogger("./logs"); err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}

	utils.Info("Starting MCP Training System...")

	// Connect to PostgreSQL
	db, err := database.NewPostgresDB(
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.DBName,
	)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	utils.Info("Connected to PostgreSQL")

	// Connect to Redis
	redisClient, err := database.NewRedisClient(
		cfg.Redis.Host,
		cfg.Redis.Port,
		cfg.Redis.Password,
		cfg.Redis.DB,
	)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	utils.Info("Connected to Redis")

	// Initialize Python executor
	executor := utils.NewPythonExecutor(cfg.Python.PythonPath, cfg.Python.ScriptsDir)

	// Initialize Agents
	dataAgent := agents.NewDataAgent(db, executor)
	trainingAgent := agents.NewTrainingAgent(db, redisClient, executor)
	evalAgent := agents.NewEvaluationAgent(db, executor, cfg.Storage.ReportDir)
	utils.Info("Agents initialized")

	// Initialize Handlers (baseDir "." for resolving relative model paths)
	datasetHandler := handlers.NewDatasetHandler(db, dataAgent, cfg.Storage.UploadDir)
	trainingHandler := handlers.NewTrainingHandler(db, trainingAgent)
	evalHandler := handlers.NewEvaluationHandler(db, evalAgent, cfg.Storage.ReportDir)
	modelHandler := handlers.NewModelHandler(db, ".")
	trainingWSHandler := handlers.NewTrainingWSHandler(redisClient)
	utils.Info("Handlers initialized")

	// Setup Gin router
	router := gin.Default()
	router.Use(middleware.CORSMiddleware())
	router.Use(middleware.ErrorHandler())

	// API routes
	api := router.Group("/api/v1")
	{
		// Dataset routes
		api.POST("/datasets/upload", datasetHandler.UploadDataset)
		api.POST("/datasets/from-url", datasetHandler.ImportFromURL)
		api.GET("/datasets", datasetHandler.GetDatasets)
		api.GET("/datasets/:id", datasetHandler.GetDatasetDetail)
		api.GET("/datasets/:id/preview", datasetHandler.GetDatasetPreview)
		api.POST("/datasets/:id/retry-clean", datasetHandler.RetryCleanDataset)
		api.DELETE("/datasets/:id", datasetHandler.DeleteDataset)

		// Training routes
		api.POST("/training/jobs", trainingHandler.CreateJob)
		api.GET("/training/jobs", trainingHandler.GetJobs)
		api.GET("/training/jobs/:id/logs", trainingHandler.GetJobLogs)
		api.GET("/training/jobs/:id", trainingHandler.GetJobStatus)
		api.POST("/training/jobs/:id/restart", trainingHandler.RestartJob)
		api.POST("/training/jobs/:id/cancel", trainingHandler.CancelJob)
		api.DELETE("/training/jobs/:id", trainingHandler.DeleteJob)

		// Evaluation routes
		api.POST("/evaluations", evalHandler.CreateEvaluation)
		api.GET("/evaluations", evalHandler.GetEvaluations)
		api.GET("/evaluations/:id", evalHandler.GetEvaluationResult)
		api.GET("/reports/download/:id", evalHandler.DownloadReport)

		// Model routes
		api.GET("/models", modelHandler.GetModels)
		api.GET("/models/:id/download", modelHandler.DownloadModel)
	}

	// WebSocket (no /api prefix)
	router.GET("/ws/training/:id", func(c *gin.Context) {
		trainingWSHandler.Serve(c)
	})

	utils.Info("Routes configured")

	// Start server
	addr := fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port)
	utils.Info("Server starting on %s", addr)

	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
