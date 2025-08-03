#!/bin/bash

# Direct Coolify Deployment Script
# This script will deploy the NXT backend directly to your Coolify server

set -e

# Configuration
COOLIFY_URL="http://152.53.114.19:8000"
PROJECT_NAME="nxt-backend"
API_TOKEN="${COOLIFY_API_TOKEN:-}"  # Set this environment variable if needed

echo "🚀 Direct Coolify Deployment for NXT Backend"
echo "============================================"

# Check if we can reach the Coolify server
echo "🔍 Checking Coolify server connectivity..."
if curl -s -o /dev/null -w "%{http_code}" "$COOLIFY_URL" | grep -q "200\|302"; then
    echo "✅ Coolify server is accessible at $COOLIFY_URL"
else
    echo "❌ Cannot reach Coolify server at $COOLIFY_URL"
    echo "Please ensure:"
    echo "1. Server is running"
    echo "2. Port 8000 is accessible"
    echo "3. Network connectivity is working"
    exit 1
fi

# Create deployment configuration
echo "📋 Creating deployment configuration..."

# Create docker-compose.yml for direct deployment
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
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - REDIS_URL=${REDIS_URL}
      - API_BASE_URL=${API_BASE_URL}
      - FRONTEND_URL=${FRONTEND_URL}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Create .env file with production configuration
cat > .env << 'EOF'
# Production Environment Variables
NODE_ENV=production
PORT=4000

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/nxt_backend

# Security
JWT_SECRET=your-jwt-secret-key-here
ENCRYPTION_KEY=your-encryption-key-here

# Redis Configuration
REDIS_URL=redis://localhost:6379

# URLs
API_BASE_URL=http://152.53.114.19:4000
FRONTEND_URL=http://152.53.114.19:3000

# Logging
LOG_LEVEL=info
EOF

# Create deployment payload
echo "📦 Creating deployment payload..."

# Create a deployment archive
tar -czf deployment.tar.gz \
    docker-compose.yml \
    .env \
    Dockerfile \
    .dockerignore \
    package.json \
    package-lock.json \
    src/ \
    config/ \
    public/ \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=*.log

echo "✅ Deployment package created: deployment.tar.gz"

# Alternative: Direct Docker deployment approach
echo "🐳 Setting up direct Docker deployment..."

# Create a deployment script for the server
cat > remote-deploy.sh << 'EOF'
#!/bin/bash
# Remote deployment script to run on the Coolify server

set -e

PROJECT_DIR="/opt/coolify/applications/nxt-backend"
BACKUP_DIR="/opt/coolify/backups/nxt-backend-$(date +%Y%m%d-%H%M%S)"

echo "🚀 Starting NXT Backend deployment..."

# Create project directory
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Backup existing deployment if it exists
if [ -d "current" ]; then
    echo "📦 Backing up existing deployment..."
    mkdir -p "$BACKUP_DIR"
    cp -r current/* "$BACKUP_DIR/"
fi

# Create new deployment
mkdir -p current
cd current

# Copy deployment files
cp ../docker-compose.yml .
cp ../.env .

# Build and start the application
echo "🏗️ Building Docker image..."
docker-compose build --no-cache

echo "🚀 Starting services..."
docker-compose up -d

# Wait for health check
echo "⏳ Waiting for service to be healthy..."
sleep 30

# Check if service is running
if curl -f http://localhost:4000/health > /dev/null 2>&1; then
    echo "✅ NXT Backend is running successfully!"
    echo "📊 Health endpoint: http://152.53.114.19:4000/health"
    echo "🔗 API base: http://152.53.114.19:4000/api"
else
    echo "❌ Service health check failed"
    echo "📋 Checking logs..."
    docker-compose logs
    exit 1
fi

echo "🎉 Deployment completed successfully!"
EOF

chmod +x remote-deploy.sh

# Create a simple deployment method using SSH
cat > ssh-deploy.sh << 'EOF'
#!/bin/bash
# SSH-based deployment script

SERVER_IP="152.53.114.19"
SERVER_USER="root"  # Adjust as needed
PROJECT_DIR="/opt/nxt-backend"

echo "🚀 Deploying via SSH to $SERVER_IP..."

# Create deployment directory on server
ssh $SERVER_USER@$SERVER_IP "mkdir -p $PROJECT_DIR"

# Copy deployment files
scp -r docker-compose.yml .env $SERVER_USER@$SERVER_IP:$PROJECT_DIR/

# Execute deployment on server
ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
cd /opt/nxt-backend

# Stop existing containers
docker-compose down || true

# Build and start new containers
docker-compose up -d --build

# Verify deployment
sleep 20
curl -f http://localhost:4000/health || exit 1

echo "✅ Deployment completed successfully!"
ENDSSH

echo "✅ SSH deployment script created"
EOF

chmod +x ssh-deploy.sh

# Create a one-liner deployment command
cat > deploy-now.sh << 'EOF'
#!/bin/bash
# One-liner deployment command

echo "🚀 Deploying NXT Backend to Coolify server..."

# Method 1: Direct Docker deployment (if Docker is accessible)
if command -v docker &> /dev/null; then
    echo "📦 Using direct Docker deployment..."
    
    # Build and run directly on the server
    docker build -t nxt-backend:latest .
    docker run -d \
        --name nxt-backend \
        -p 4000:4000 \
        -e NODE_ENV=production \
        -e PORT=4000 \
        --restart unless-stopped \
        nxt-backend:latest
    
    echo "✅ Container started successfully!"
    echo "📊 Checking health..."
    sleep 10
    curl -f http://152.53.114.19:4000/health || echo "⚠️ Health check failed - check logs"
else
    echo "❌ Docker not found - using manual deployment"
    echo "Please use the deployment package in ./coolify-deploy-package/"
fi
EOF

chmod +x deploy-now.sh

echo ""
echo "🎯 **DEPLOYMENT READY**"
echo "======================"
echo ""
echo "📁 Files created:"
echo "  - docker-compose.yml"
echo "  - .env"
echo "  - deployment.tar.gz"
echo "  - remote-deploy.sh"
echo "  - ssh-deploy.sh"
echo "  - deploy-now.sh"
echo ""
echo "🚀 **Choose your deployment method:**"
echo ""
echo "1. **Direct Docker (if server has Docker):**"
echo "   ./deploy-now.sh"
echo ""
echo "2. **SSH Deployment (if you have SSH access):**"
echo "   ./ssh-deploy.sh"
echo ""
echo "3. **Manual Coolify Upload:**"
echo "   - Copy deployment.tar.gz to server"
echo "   - Extract and run ./remote-deploy.sh"
echo ""
echo "4. **Coolify Web Interface:**"
echo "   - Go to: http://152.53.114.19:8000"
echo "   - Upload docker-compose.yml and .env"
echo ""
echo "🔗 **Post-deployment URLs:**"
echo "   Health: http://152.53.114.19:4000/health"
echo "   API: http://152.53.114.19:4000/api"
echo ""
echo "✅ All deployment files are ready!"