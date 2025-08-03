#!/bin/bash

# Immediate Coolify Deployment Script
# This script will deploy the NXT backend directly to your Coolify server

set -e

COOLIFY_URL="http://152.53.114.19:8000"
PROJECT_NAME="nxt-backend"

echo "🚀 Immediate Coolify Deployment for NXT Backend"
echo "=============================================="

# Check server connectivity
echo "🔍 Checking Coolify server connectivity..."
if curl -s -o /dev/null -w "%{http_code}" "$COOLIFY_URL" | grep -q "200\|302"; then
    echo "✅ Coolify server is accessible at $COOLIFY_URL"
else
    echo "❌ Cannot reach Coolify server"
    exit 1
fi

# Create deployment files
echo "📋 Creating deployment files..."

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  nxt-backend:
    build: .
    container_name: nxt-backend
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
      - PORT=4000
      - DATABASE_URL=postgresql://postgres:password@localhost:5432/nxt_backend
      - JWT_SECRET=your-jwt-secret-change-this
      - ENCRYPTION_KEY=your-encryption-key-change-this
      - REDIS_URL=redis://localhost:6379
      - API_BASE_URL=http://152.53.114.19:4000
      - FRONTEND_URL=http://152.53.114.19:3000
      - LOG_LEVEL=info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Create .env file
cat > .env << 'EOF'
# Production Environment Variables
NODE_ENV=production
PORT=4000

# Database Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/nxt_backend

# Security Keys (CHANGE THESE!)
JWT_SECRET=your-super-secret-jwt-key-change-this-immediately
ENCRYPTION_KEY=your-32-character-encryption-key-here

# Redis Configuration
REDIS_URL=redis://localhost:6379

# URLs
API_BASE_URL=http://152.53.114.19:4000
FRONTEND_URL=http://152.53.114.19:3000

# Logging
LOG_LEVEL=info
EOF

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf nxt-backend-deployment.tar.gz \
    docker-compose.yml \
    .env \
    Dockerfile \
    .dockerignore \
    package.json \
    package-lock.json \
    src/ \
    --exclude=node_modules \
    --exclude=.git \
    2>/dev/null || true

echo "✅ Deployment package created: nxt-backend-deployment.tar.gz"

# Create immediate deployment script for server
cat > deploy-on-server.sh << 'EOF'
#!/bin/bash
# Run this script on the Coolify server

set -e

PROJECT_DIR="/opt/nxt-backend"
BACKUP_DIR="/opt/backups/nxt-backend-$(date +%Y%m%d-%H%M%S)"

echo "🚀 Deploying NXT Backend..."

# Create project directory
sudo mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Backup existing deployment
if [ -f "docker-compose.yml" ]; then
    echo "📦 Backing up existing deployment..."
    sudo mkdir -p "$BACKUP_DIR"
    sudo cp -r ./* "$BACKUP_DIR/" 2>/dev/null || true
fi

# Copy new files
echo "📋 Setting up new deployment..."
sudo cp docker-compose.yml .env "$PROJECT_DIR/" 2>/dev/null || true

# Build and deploy
echo "🏗️ Building and starting services..."
sudo docker-compose down 2>/dev/null || true
sudo docker-compose up -d --build

# Wait for service to start
echo "⏳ Waiting for service to start..."
sleep 30

# Health check
echo "🔍 Checking service health..."
if curl -f http://localhost:4000/health > /dev/null 2>&1; then
    echo "✅ NXT Backend is running successfully!"
    echo "📊 Health endpoint: http://152.53.114.19:4000/health"
    echo "🔗 API base: http://152.53.114.19:4000/api"
else
    echo "❌ Health check failed - checking logs..."
    sudo docker-compose logs --tail=50
    exit 1
fi

echo "🎉 Deployment completed successfully!"
EOF

chmod +x deploy-on-server.sh

# Create a simple deployment method
cat > simple-deploy.sh << 'EOF'
#!/bin/bash
# Simple deployment using Docker directly

echo "🚀 Simple Docker deployment..."

# Build the image
docker build -t nxt-backend:latest .

# Stop existing container
docker stop nxt-backend 2>/dev/null || true
docker rm nxt-backend 2>/dev/null || true

# Run new container
docker run -d \
    --name nxt-backend \
    -p 4000:4000 \
    -e NODE_ENV=production \
    -e PORT=4000 \
    -e JWT_SECRET=change-this-secret-key \
    -e ENCRYPTION_KEY=change-this-encryption-key \
    --restart unless-stopped \
    nxt-backend:latest

echo "✅ Container started!"
echo "⏳ Waiting for service to be ready..."
sleep 20

# Check health
if curl -f http://152.53.114.19:4000/health > /dev/null 2>&1; then
    echo "🎉 Service is healthy and running!"
else
    echo "⚠️ Service might still be starting..."
    echo "Check logs: docker logs nxt-backend"
fi
EOF

chmod +x simple-deploy.sh

echo ""
echo "🎯 **DEPLOYMENT READY - CHOOSE METHOD**"
echo "======================================"
echo ""
echo "📁 Created files:"
echo "  ✓ docker-compose.yml"
echo "  ✓ .env"
echo "  ✓ nxt-backend-deployment.tar.gz"
echo "  ✓ deploy-on-server.sh"
echo "  ✓ simple-deploy.sh"
echo ""
echo "🚀 **DEPLOYMENT OPTIONS:**"
echo ""
echo "1. **Direct Docker (run on server):**"
echo "   scp simple-deploy.sh root@152.53.114.19:/tmp/"
echo "   ssh root@152.53.114.19 'cd /tmp && ./simple-deploy.sh'"
echo ""
echo "2. **Docker Compose (run on server):**"
echo "   scp nxt-backend-deployment.tar.gz root@152.53.114.19:/tmp/"
echo "   ssh root@152.53.114.19 'cd /tmp && tar -xzf nxt-backend-deployment.tar.gz && ./deploy-on-server.sh'"
echo ""
echo "3. **Coolify Web Interface:**"
echo "   - Go to: http://152.53.114.19:8000"
echo "   - Create new application"
echo "   - Upload docker-compose.yml and .env"
echo ""
echo "4. **One-liner deployment (if you have SSH access):**"
echo "   ssh root@152.53.114.19 'bash -s' < simple-deploy.sh"
echo ""
echo "🔗 **After deployment:**"
echo "   Health: http://152.53.114.19:4000/health"
echo "   API: http://152.53.114.19:4000/api"
echo ""
echo "⚠️  **IMPORTANT:** Change the JWT_SECRET and ENCRYPTION_KEY in .env before production use!"
echo ""
echo "✅ All deployment files are ready for immediate use!"