#!/bin/bash
# Final Coolify Deployment Script
# This script will help you deploy the NXT backend to your Coolify server

set -e

echo "🚀 NXT Backend Coolify Deployment"
echo "================================="
echo ""

# Server details
SERVER_IP="152.53.114.19"
COOLIFY_URL="http://152.53.114.19:8000"
APP_NAME="nxt-backend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is available
print_status "Checking Docker availability..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Build the Docker image
print_status "Building Docker image..."
docker build -t nxt-backend:latest .

# Create deployment package
print_status "Creating deployment package..."
mkdir -p coolify-deploy-package

# Create environment file
cat > coolify-deploy-package/.env << 'EOF'
# Core Application
NODE_ENV=production
PORT=4000
JWT_SECRET=your-secure-jwt-secret-change-this
SESSION_SECRET=your-secure-session-secret-change-this

# CORS Configuration
CORS_ORIGIN=https://nxtdotx.co.za,https://www.nxtdotx.co.za

# Database Configuration
DATABASE_URL=postgresql://username:password@host:port/database

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# API Keys
OPENAI_API_KEY=your-openai-api-key
CLOUDFLARE_API_TOKEN=your-cloudflare-token
EOF

# Create Docker Compose for Coolify
cat > coolify-deploy-package/docker-compose.yml << 'EOF'
version: '3.8'

services:
  backend:
    image: nxt-backend:latest
    container_name: nxt-backend
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Create deployment commands
cat > coolify-deploy-package/deploy-commands.txt << 'EOF'
# Coolify Deployment Commands

## 1. Upload to server
scp -r coolify-deploy-package/* root@152.53.114.19:/opt/coolify/applications/nxt-backend/

## 2. SSH to server
ssh root@152.53.114.19

## 3. Navigate to directory
cd /opt/coolify/applications/nxt-backend/

## 4. Deploy via Coolify
# Access http://152.53.114.19:8000
# Create new application
# Select Docker Compose
# Upload docker-compose.yml
# Upload .env
# Deploy

## 5. Alternative: Direct Docker deployment
docker run -d \
  --name nxt-backend \
  -p 4000:4000 \
  --env-file .env \
  --restart unless-stopped \
  nxt-backend:latest

## 6. Verify deployment
curl http://152.53.114.19:4000/health
EOF

# Create a simple deployment script for the server
cat > coolify-deploy-package/deploy.sh << 'EOF'
#!/bin/bash
# Run this on the Coolify server

echo "🚀 Deploying NXT Backend to Coolify..."

# Stop existing container if running
docker stop nxt-backend 2>/dev/null || true
docker rm nxt-backend 2>/dev/null || true

# Run the container
docker run -d \
  --name nxt-backend \
  -p 4000:4000 \
  --env-file .env \
  --restart unless-stopped \
  nxt-backend:latest

echo "✅ Deployment complete!"
echo "🌐 Access your backend at: http://152.53.114.19:4000"
echo "🔍 Health check: http://152.53.114.19:4000/health"
EOF

chmod +x coolify-deploy-package/deploy.sh

# Create README
cat > coolify-deploy-package/README.md << 'EOF'
# NXT Backend Coolify Deployment

## Quick Start

1. **Access Coolify**: http://152.53.114.19:8000
2. **Create Application**: New → Docker Compose
3. **Upload Files**: docker-compose.yml and .env
4. **Deploy**: Click deploy and monitor logs

## Files
- `docker-compose.yml`: Coolify configuration
- `.env`: Environment variables (update with your values)
- `deploy.sh`: Server deployment script
- `deploy-commands.txt`: Step-by-step commands

## Configuration Required
Update these values in .env:
- DATABASE_URL: Your Neon database connection string
- JWT_SECRET: Generate a secure random string
- SESSION_SECRET: Generate a secure random string
- API keys: Your actual API keys

## Verification
- Health endpoint: http://152.53.114.19:4000/health
- API base: http://152.53.114.19:4000/api
EOF

print_status "✅ Deployment package created!"
print_status "📁 Location: ./coolify-deploy-package"
print_status ""
print_status "📋 Next steps:"
print_status "1. Copy coolify-deploy-package to your server"
print_status "2. Access Coolify at $COOLIFY_URL"
print_status "3. Create new application with Docker Compose"
print_status "4. Upload docker-compose.yml and .env"
print_status "5. Deploy and monitor"
print_status ""
print_status "🎯 Ready to deploy!"

# List created files
echo ""
echo "📦 Created files:"
ls -la coolify-deploy-package/