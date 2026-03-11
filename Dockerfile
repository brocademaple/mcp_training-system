# Stage 1: Build Go server
FROM golang:1.21-alpine AS builder
WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Stage 2: Runtime with Python + training dependencies
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies: CPU-only PyTorch (避免拉取 2GB+ CUDA 包导致超时)，再装其余依赖
COPY python_scripts/requirements-docker.txt ./python_scripts/
RUN pip install --no-cache-dir --default-timeout=300 \
    torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir --default-timeout=300 -r python_scripts/requirements-docker.txt

# Copy Go binary, Python scripts, and entrypoint
COPY --from=builder /build/server ./
COPY python_scripts ./python_scripts
COPY scripts/docker-entrypoint.sh ./scripts/
RUN chmod +x ./scripts/docker-entrypoint.sh

# Data dirs (will be overridden by volumes in docker-compose; here for standalone run)
RUN mkdir -p /app/data/uploads /app/data/cleaned /app/data/models /app/reports

# Default env (override in docker-compose)
ENV SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8080 \
    UPLOAD_DIR=/app/data/uploads \
    CLEANED_DIR=/app/data/cleaned \
    MODEL_DIR=/app/data/models \
    REPORT_DIR=/app/reports \
    PYTHON_PATH=python3 \
    PYTHON_SCRIPTS_DIR=/app/python_scripts

EXPOSE 8080

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["./server"]
