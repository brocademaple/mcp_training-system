package main

import (
	"fmt"
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/config"
	"mcp-training-system/internal/database"
	"mcp-training-system/internal/handlers"
	"mcp-training-system/internal/mcp"
	"mcp-training-system/internal/middleware"
	"mcp-training-system/internal/registry"
	"mcp-training-system/internal/services"
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

	// 绾喕绻?2.0 濞翠焦鎸夌痪鑳€冪€涙ê婀敍鍫㈢搼娴犺渹绨幍褑顢戞潻浣盒?010閿?
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS pipeline_instances (
			id SERIAL PRIMARY KEY,
			session_id VARCHAR(255) NOT NULL,
			dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
			status VARCHAR(50) NOT NULL DEFAULT 'pending',
			current_step VARCHAR(100),
			job_id INTEGER REFERENCES training_jobs(id) ON DELETE SET NULL,
			model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
			eval_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL,
			error_msg TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		log.Printf("Warning: ensure pipeline_instances table: %v", err)
	} else {
		utils.Info("pipeline_instances table ready")
	}
	// 婢х偛濮?data_agent_prompt 閸掓绱欓懟銉ょ瑝鐎涙ê婀敍?
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS data_agent_prompt TEXT`); err != nil {
		log.Printf("Warning: add data_agent_prompt column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS plan_id VARCHAR(255)`); err != nil {
		log.Printf("Warning: add plan_id column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS plan_summary TEXT`); err != nil {
		log.Printf("Warning: add plan_summary column: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS run_spec JSONB`); err != nil {
		log.Printf("Warning: add training_jobs.run_spec: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS orchestration_state VARCHAR(64)`); err != nil {
		log.Printf("Warning: add orchestration_state: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS failure_code VARCHAR(64)`); err != nil {
		log.Printf("Warning: add failure_code: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS run_spec JSONB`); err != nil {
		log.Printf("Warning: add pipeline_instances.run_spec: %v", err)
	}
	// 013: datasets.derived_from_dataset_id — see internal/database/migrations/013_add_dataset_derived_from.sql
	if _, err := db.Exec(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS derived_from_dataset_id INTEGER REFERENCES datasets (id) ON DELETE SET NULL`); err != nil {
		log.Printf("Warning: add datasets.derived_from_dataset_id: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_datasets_derived_from ON datasets (derived_from_dataset_id) WHERE derived_from_dataset_id IS NOT NULL`); err != nil {
		log.Printf("Warning: add idx_datasets_derived_from: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS ai_analysis JSONB`); err != nil {
		log.Printf("Warning: add datasets.ai_analysis: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS agent_data_report JSONB`); err != nil {
		log.Printf("Warning: add datasets.agent_data_report: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS agent_advice JSONB`); err != nil {
		log.Printf("Warning: add evaluations.agent_advice: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS projects (
		id SERIAL PRIMARY KEY,
		user_id INTEGER NOT NULL DEFAULT 1,
		name VARCHAR(255) NOT NULL,
		description TEXT,
		session_root VARCHAR(255) NOT NULL UNIQUE,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		log.Printf("Warning: ensure projects table: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`); err != nil {
		log.Printf("Warning: add training_jobs.project_id: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`); err != nil {
		log.Printf("Warning: add evaluations.project_id: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`); err != nil {
		log.Printf("Warning: add pipeline_instances.project_id: %v", err)
	}

	if _, err := registry.LoadFromDir("."); err != nil {
		log.Printf("Warning: registry load: %v", err)
	} else {
		utils.Info("Task/method/domain registries loaded")
	}
	if err := services.LoadIntentPatterns("."); err != nil {
		log.Printf("Warning: intent patterns load: %v", err)
	} else {
		utils.Info("Intent patterns loaded")
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Agent.IntentResolverProvider)) {
	case "aliyun":
		if strings.TrimSpace(cfg.Agent.AliyunDashScopeAPIKey) != "" {
			utils.Info("Intent resolver: aliyun (DashScope model %s)", cfg.Agent.AliyunIntentModel)
		} else {
			utils.Info("Intent resolver: aliyun requested but no API key; will use rules at runtime")
		}
	case "hybrid":
		utils.Info("Intent resolver: hybrid (DashScope with rules fallback)")
	default:
		utils.Info("Intent resolver: rules (keyword patterns)")
	}

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
	mcpStore := mcp.NewStore(redisClient)

	// Initialize Python executor
	executor := utils.NewPythonExecutor(cfg.Python.PythonPath, cfg.Python.ScriptsDir)

	// Initialize Agents
	dataAgent := agents.NewDataAgent(db, executor)
	trainingAgent := agents.NewTrainingAgent(db, redisClient, executor, ".")
	evalAgent := agents.NewEvaluationAgent(db, executor, cfg.Storage.ReportDir, ".")
	utils.Info("Agents initialized")

	// Initialize MCP Coordinator
	coordinator := mcp.NewCoordinator(db, dataAgent, trainingAgent, evalAgent)
	utils.Info("MCP Coordinator initialized")

	// Initialize Handlers (baseDir "." for resolving relative model paths)
	datasetHandler := handlers.NewDatasetHandler(db, dataAgent, cfg.Storage.UploadDir, mcpStore)
	trainingHandler := handlers.NewTrainingHandler(db, trainingAgent, evalAgent, mcpStore)
	evalHandler := handlers.NewEvaluationHandler(db, evalAgent, cfg.Storage.ReportDir, mcpStore)
	modelHandler := handlers.NewModelHandler(db, ".")
	syncHandler := handlers.NewSyncHandler(db, ".", cfg.Storage.UploadDir)
	trainingWSHandler := handlers.NewTrainingWSHandler(redisClient)
	pipelineHandler := handlers.NewPipelineHandler(db, coordinator)
	envAgentCfg := cfg.Agent
	llmFile, errLLM := config.LoadLLMSettingsFile(cfg.LLMSettingsPath)
	if errLLM != nil {
		log.Printf("Warning: load LLM settings file %s: %v", cfg.LLMSettingsPath, errLLM)
		llmFile = config.DefaultLLMSettingsFile()
	}
	mergedAgent := config.MergeEnvAgentWithLLMFile(envAgentCfg, llmFile)
	agentStore := config.NewAgentStore(mergedAgent)
	agentHandler := handlers.NewAgentHandler(db, agentStore, mcpStore)
	settingsHandler := handlers.NewSettingsHandler(agentStore, cfg.LLMSettingsPath, envAgentCfg)
	registryHandler := handlers.NewRegistryHandler()
	mcpHandler := handlers.NewMCPHandler(mcpStore)
	projectHandler := handlers.NewProjectHandler(db)
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
		api.POST("/datasets/:id/analyze", datasetHandler.AnalyzeDataset)
		api.POST("/agent/datasets/:id/analyze", datasetHandler.AnalyzeDatasetForAgent)
		api.GET("/agent/datasets/:id/report", datasetHandler.GetDatasetAgentReport)
		api.POST("/datasets/:id/confirm-analysis", datasetHandler.ConfirmDatasetAnalysis)
		api.POST("/datasets/:id/retry-clean", datasetHandler.RetryCleanDataset)
		api.POST("/datasets/:id/split", datasetHandler.SplitDataset)
		api.PATCH("/datasets/:id", datasetHandler.UpdateDatasetName)
		api.DELETE("/datasets/:id", datasetHandler.DeleteDataset)
		api.POST("/datasets/bulk-delete", datasetHandler.BulkDeleteDatasets)

		// Training routes
		api.POST("/training/jobs", trainingHandler.CreateJob)
		api.GET("/training/jobs", trainingHandler.GetJobs)
		api.GET("/training/jobs/:id/logs", trainingHandler.GetJobLogs)
		api.GET("/training/jobs/:id/raw-logs", trainingHandler.GetRawLogs)
		api.GET("/training/jobs/:id", trainingHandler.GetJobStatus)
		api.POST("/training/jobs/:id/restart", trainingHandler.RestartJob)
		api.POST("/training/jobs/:id/cancel", trainingHandler.CancelJob)
		api.DELETE("/training/jobs/:id", trainingHandler.DeleteJob)

		// Evaluation routes
		api.POST("/evaluations", evalHandler.CreateEvaluation)
		api.GET("/evaluations", evalHandler.GetEvaluations)
		api.GET("/evaluations/:id/insight", evalHandler.GetEvaluationInsight)
		api.GET("/agent/evaluations/:id/advice", evalHandler.GetEvaluationAdvice)
		api.GET("/evaluations/:id", evalHandler.GetEvaluationResult)
		api.POST("/evaluations/:id/cancel", evalHandler.CancelEvaluation)
		api.DELETE("/evaluations/:id", evalHandler.DeleteEvaluation)
		api.GET("/reports/download/:id", evalHandler.DownloadReport)
		api.GET("/reports/preview/:id", evalHandler.PreviewReport)

		// Model routes
		api.GET("/models", modelHandler.GetModels)
		api.POST("/models/recover-from-disk", modelHandler.RecoverModelsFromDisk)
		api.GET("/models/:id/download", modelHandler.DownloadModel)

		// 娑撯偓闁款喖鎮撳銉窗娴?data/uploads 娑?data/models 鐞涖儱鍙忛弫鐗堝祦闂嗗棎鈧焦膩閸ㄥ寮风拋顓犵矊娴犺濮熺拋鏉跨秿
		api.POST("/sync-from-disk", syncHandler.SyncFromDisk)

		// Pipeline routes (2.0 Agent閻?
		api.POST("/agent/plan", agentHandler.CreatePlan)
		api.POST("/agent/resolve-intent", agentHandler.ResolveIntent)
		// LLM settings
		api.GET("/agent/llm-settings", settingsHandler.GetLLMSettings)
		api.PUT("/agent/llm-settings", settingsHandler.PutLLMSettings)
		api.POST("/agent/llm-settings/test-qwen", settingsHandler.PostTestQwenDashScope)
		api.POST("/agent/llm-settings/test-provider", settingsHandler.PostTestProviderConnectivity)
		api.GET("/settings/llm", settingsHandler.GetLLMSettings)
		api.PUT("/settings/llm", settingsHandler.PutLLMSettings)
		api.GET("/registry", registryHandler.GetBundle)
		api.POST("/pipelines", pipelineHandler.CreatePipeline)
		api.GET("/pipelines", pipelineHandler.ListPipelines)
		api.GET("/pipelines/:id", pipelineHandler.GetPipelineStatus)
		api.GET("/mcp/session/:session_id", mcpHandler.GetSessionContext)
		api.GET("/mcp/session/:session_id/events", mcpHandler.GetSessionEvents)
		api.GET("/mcp/session/:session_id/events/stream", mcpHandler.StreamSessionEvents)
		api.POST("/mcp/session/:session_id/events/user", mcpHandler.PostUserSessionEvent)
		api.GET("/projects", projectHandler.ListProjects)
		api.POST("/projects", projectHandler.CreateProject)
		api.GET("/projects/:id", projectHandler.GetProject)
		api.PATCH("/projects/:id", projectHandler.PatchProject)
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

