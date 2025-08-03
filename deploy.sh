#!/bin/bash

# NXT New Day Backend Deployment Script
# This script prepares and deploys the backend to Coolify

set -e

echo "🚀 Starting NXT New Day Backend deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required files exist
echo "📋 Checking required files..."
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found${NC}"
    exit 1
fi

if [ ! -f "Dockerfile" ]; then
    echo -e "${RED}❌ Dockerfile not found${NC}"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found - make sure to set environment variables in Coolify${NC}"
fi

# Build Docker image locally for testing
echo "🔨 Building Docker image..."
docker build -t nxt-newday-backend:latest .

# Run tests
echo "🧪 Running tests..."
npm run test:niledb-integration

# Check if tests passed
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed${NC}"
else
    echo -e "${RED}❌ Tests failed - deployment aborted${NC}"
    exit 1
fi

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf deployment.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=coverage \
    --exclude=*.log \
    --exclude=.env \
    --exclude=deployment.tar.gz \
    .

echo -e "${GREEN}✅ Deployment package created: deployment.tar.gz${NC}"
echo ""
echo "📋 Next steps for Coolify deployment:"
echo "1. Upload deployment.tar.gz to your Coolify instance"
echo "2. Set environment variables in Coolify dashboard"
echo "3. Configure port mapping (4000:4000)"
echo "4. Deploy!"
echo ""
echo "🎯 Environment variables to set in Coolify:"
echo "   - DATABASE_URL"
echo "   - REDIS_URL"
echo "   - JWT_SECRET"
echo "   - PORT=4000"
echo "   - NODE_ENV=production"