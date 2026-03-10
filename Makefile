.PHONY: help build run test clean docker-up docker-down db-init install

# Default target
help:
	@echo "MCP Training System - Makefile Commands"
	@echo "========================================"
	@echo "make install      - Install all dependencies"
	@echo "make docker-up    - Start Docker services (PostgreSQL, Redis)"
	@echo "make docker-down  - Stop Docker services"
	@echo "make db-init      - Initialize database schema"
	@echo "make build        - Build the application"
	@echo "make run          - Run the application"
	@echo "make test         - Run integration tests"
	@echo "make clean        - Clean build artifacts and data"
	@echo "make dev          - Quick start for development"

# Install dependencies
install:
	@echo "Installing Go dependencies..."
	go mod download
	@echo "Installing Python dependencies..."
	pip3 install -r python_scripts/requirements.txt
	@echo "Creating necessary directories..."
	mkdir -p data/uploads data/cleaned data/models reports logs
	@echo "Dependencies installed successfully!"

# Docker operations
docker-up:
	@echo "Starting Docker services..."
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	sleep 5
	@echo "Docker services started!"

docker-down:
	@echo "Stopping Docker services..."
	docker-compose down
	@echo "Docker services stopped!"

# Database initialization
db-init:
	@echo "Initializing database..."
	@sleep 2
	psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/001_init.sql
	@echo "Database initialized successfully!"

# Build application
build:
	@echo "Building application..."
	go build -o mcp-server cmd/server/main.go
	@echo "Build complete! Binary: ./mcp-server"

# Run application
run:
	@echo "Starting MCP Training System..."
	go run cmd/server/main.go

# Run tests
test:
	@echo "Running integration tests..."
	@chmod +x tests/integration/e2e_test.sh
	@bash tests/integration/e2e_test.sh

# Clean build artifacts and data
clean:
	@echo "Cleaning build artifacts..."
	rm -f mcp-server
	rm -rf data/uploads/* data/cleaned/* data/models/* reports/* logs/*
	@echo "Clean complete!"

# Quick start for development
dev: docker-up db-init
	@echo "Development environment ready!"
	@echo "Starting server..."
	@make run

# Full setup (first time)
setup: install docker-up db-init
	@echo "=========================================="
	@echo "Setup complete!"
	@echo "Run 'make run' to start the server"
	@echo "=========================================="
