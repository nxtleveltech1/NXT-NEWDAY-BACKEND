#!/bin/bash

# Coolify Deployment Script for NXT Backend
# Run this script on your Coolify server (152.53.114.19)

set -e

echo "🚀 Starting NXT Backend Deployment to Coolify..."

# Configuration
COOLIFY_URL="http://152.53.114.19:8000"
APP_NAME="nxt-backend"
IMAGE_NAME="nxt-backend:latest"
PORT="4000"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
print_status "Checking Docker status..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Build the Docker image
print_status "Building Docker image..."
docker build -t $IMAGE_NAME .

# Check if image was built successfully
if docker image inspect $IMAGE_NAME > /dev/null 2>&1; then
    print_status "Docker image $IMAGE_NAME built successfully"
else
    print_error "Failed to build Docker image"
    exit 1
fi

# Create environment file for Coolify
print_status "Creating environment configuration..."
cat > .env.coolify << EOF
# Core Application
NODE_ENV=production
PORT=4000
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here

# CORS Configuration
CORS_ORIGIN=https://nxtdotx.co.za,https://www.nxtdotx.co.za

# Database Configuration (update with your actual values)
DATABASE_URL=postgresql://username:password@host:port/database

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# AI & Analytics
AI_ANALYTICS_URL=http://localhost:4000
OPENAI_API_KEY=your_openai_api_key
CLOUDFLARE_API_TOKEN=your_cloudflare_token
EOF

print_status "Environment file created: .env.coolify"

# Create Docker Compose file for Coolify
print_status "Creating Docker Compose configuration..."
cat > docker-compose.coolify.yml << EOF
version: '3.8'

services:
  backend:
    image: $IMAGE_NAME
    container_name: $APP_NAME
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.coolify
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    labels:
      - "coolify.managed=true"
      - "coolify.name=$APP_NAME"
      - "coolify.port=4000"
      - "coolify.healthcheck=/health"
EOF

print_status "Docker Compose file created: docker-compose.coolify.yml"

# Test the Docker image locally
print_status "Testing Docker image locally..."
docker run -d --name test-$APP_NAME -p 4000:4000 --env-file .env.coolify $IMAGE_NAME

# Wait for container to start
sleep 10

# Test health endpoint
print_status "Testing health endpoint..."
if curl -f http://localhost:4000/health > /dev/null 2>&1; then
    print_status "✅ Health check passed"
    docker stop test-$APP_NAME
    docker rm test-$APP_NAME
else
    print_warning "Health check failed, but continuing with deployment"
    docker stop test-$APP_NAME || true
    docker rm test-$APP_NAME || true
fi

# Create deployment instructions
print_status "Creating deployment instructions..."
cat > DEPLOYMENT_INSTRUCTIONS.md << EOF
# Coolify Deployment Instructions

## Quick Deploy Commands

1. **Upload files to server:**
   \`\`\`bash
   scp -r . root@152.53.114.19:/opt/coolify/applications/nxt-backend/
   \`\`\`

2. **SSH to server:**
   \`\`\`bash
   ssh root@152.53.114.19
   \`\`\`

3. **Deploy with Coolify:**
   - Go to http://152.53.114.19:8000
   - Click "New Application"
   - Select "Docker Compose"
   - Upload docker-compose.coolify.yml
   - Configure environment variables
   - Deploy

## Manual Docker Run (Alternative)
\`\`\`bash
docker run -d \
  --name nxt-backend \
  -p 4000:4000 \
  --env-file .env.coolify \
  --restart unless-stopped \
  nxt-backend:latest
\`\`\`

## Verification
- Health check: http://152.53.114.19:4000/health
- API base: http://152.53.114.19:4000/api
\`\`\`

print_status "🎉 Deployment preparation complete!"
print_status "Files created:"
print_status "  - .env.coolify (environment variables)"
print_status "  - docker-compose.coolify.yml (Coolify configuration)"
print_status "  - DEPLOYMENT_INSTRUCTIONS.md (detailed guide)"

print_status ""
print_status "Next steps:"
print_status "1. Copy these files to your Coolify server"
print_status "2. Access http://152.53.114.19:8000"
print_status "3. Create new application with Docker Compose"
print_status "4. Upload docker-compose.coolify.yml"
print_status "5. Deploy and monitor"

echo ""
echo "🚀 Ready to deploy!"