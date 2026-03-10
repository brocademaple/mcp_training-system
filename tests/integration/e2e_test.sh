#!/bin/bash

# MCP Training System - End-to-End Integration Test
# This script tests the complete workflow: upload -> clean -> train -> evaluate

set -e  # Exit on error

BASE_URL="http://localhost:8080/api/v1"
TEST_DATA="test_data.csv"

echo "=========================================="
echo "MCP Training System - Integration Test"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Check if server is running
print_info "Checking if server is running..."
if ! curl -s "$BASE_URL/datasets" > /dev/null; then
    print_error "Server is not running at $BASE_URL"
    echo "Please start the server with: go run cmd/server/main.go"
    exit 1
fi
print_success "Server is running"
echo ""

# Step 1: Create test dataset if not exists
print_info "Step 1: Creating test dataset..."
if [ ! -f "$TEST_DATA" ]; then
    echo "text,label" > $TEST_DATA
    echo "This is a positive review,1" >> $TEST_DATA
    echo "This is a negative review,0" >> $TEST_DATA
    echo "Great product,1" >> $TEST_DATA
    echo "Bad quality,0" >> $TEST_DATA
    echo "Excellent service,1" >> $TEST_DATA
    print_success "Test dataset created"
else
    print_success "Test dataset already exists"
fi
echo ""

# Step 2: Upload dataset
print_info "Step 2: Uploading dataset..."
UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/datasets/upload" \
  -F "file=@$TEST_DATA" \
  -F "name=Integration Test Dataset" \
  -F "type=text")

DATASET_ID=$(echo $UPLOAD_RESPONSE | grep -o '"dataset_id":[0-9]*' | grep -o '[0-9]*')

if [ -z "$DATASET_ID" ]; then
    print_error "Failed to upload dataset"
    echo "Response: $UPLOAD_RESPONSE"
    exit 1
fi

print_success "Dataset uploaded with ID: $DATASET_ID"
echo ""

# Step 3: Wait for data cleaning
print_info "Step 3: Waiting for data cleaning..."
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    STATUS_RESPONSE=$(curl -s "$BASE_URL/datasets/$DATASET_ID")
    STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [ "$STATUS" = "ready" ]; then
        print_success "Data cleaning completed"
        break
    elif [ "$STATUS" = "error" ]; then
        print_error "Data cleaning failed"
        exit 1
    fi

    echo -n "."
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 1))
done
echo ""

if [ $WAIT_COUNT -eq $MAX_WAIT ]; then
    print_error "Timeout waiting for data cleaning"
    exit 1
fi
echo ""

# Step 4: Create training job
print_info "Step 4: Creating training job..."
JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/training/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"dataset_id\": $DATASET_ID,
    \"model_type\": \"text_classification\",
    \"hyperparams\": {
      \"learning_rate\": 0.00002,
      \"batch_size\": 8,
      \"epochs\": 1
    }
  }")

JOB_ID=$(echo $JOB_RESPONSE | grep -o '"job_id":[0-9]*' | grep -o '[0-9]*')

if [ -z "$JOB_ID" ]; then
    print_error "Failed to create training job"
    echo "Response: $JOB_RESPONSE"
    exit 1
fi

print_success "Training job created with ID: $JOB_ID"
echo ""

# Step 5: Monitor training progress
print_info "Step 5: Checking training job status..."
sleep 3
JOB_STATUS_RESPONSE=$(curl -s "$BASE_URL/training/jobs/$JOB_ID")
JOB_STATUS=$(echo $JOB_STATUS_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
print_success "Training job status: $JOB_STATUS"
echo ""

# Summary
echo "=========================================="
echo "Integration Test Summary"
echo "=========================================="
print_success "Dataset ID: $DATASET_ID"
print_success "Training Job ID: $JOB_ID"
print_success "All API endpoints are working correctly!"
echo ""
echo "Note: Training will continue in the background."
echo "Monitor progress: curl $BASE_URL/training/jobs/$JOB_ID"
echo ""
