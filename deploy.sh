#!/bin/bash

# Clean Production Deployment Script
# Deploy NXT Backend to Coolify Server (152.53.114.19:8000)

set -e

SERVER_IP="152.53.114.19"
COOLIFY_URL="http://152.53.114.19:8000"

echo "🚀 NXT Backend Production Deployment"
echo "=================================="
echo ""

# Check server connectivity
echo "🔍 Checking server connectivity..."
if curl -s -o /dev/null -w "%{http_code}" "$COOLIFY_URL" | grep -q "200\|302"; then
    echo "✅ Coolify server accessible at $COOLIFY_URL"
else
    echo "❌ Cannot reach Coolify server"
    exit 1
fi

# Build Docker image
echo "🏗️ Building Docker image..."
docker build -t nxt-backend:latest .

# Create production docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  nxt-backend:
    image: nxt-backend:latest
    container_name: nxt-backend
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
      - PORT=4000
      - DATABASE_URL=${DATABASE_URL:-postgresql://postgres:password@localhost:5432/nxt_backend}
      - JWT_SECRET=${JWT_SECRET:-your-jwt-secret-change-this}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-your-encryption-key-change-this}
      - REDIS_URL=${REDIS_URL:-redis://localhost:6379}
      - API_BASE_URL=${API_BASE_URL:-http://152.53.114.19:4000}
      - FRONTEND_URL=${FRONTEND_URL:-http://152.53.114.19:3000}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Create production .env
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

echo "✅ Production files created:"
echo "  📁 docker-compose.yml"
echo "  📁 .env"
echo "  📦 Docker image: nxt-backend:latest"

echo ""
echo "🚀 **DEPLOYMENT OPTIONS:**"
echo ""
echo "1. **Coolify Web Interface:**"
echo "   - Go to: $COOLIFY_URL"
echo "   - Create new application"
echo "   - Upload docker-compose.yml and .env"
echo ""
echo "2. **SSH Deployment:**"
echo "   scp docker-compose.yml .env root@$SERVER_IP:/opt/nxt-backend/"
echo "   ssh root@$SERVER_IP 'cd /opt/nxt-backend && docker-compose up -d'"
echo ""
echo "3. **Direct Docker:**"
echo "   docker run -d --name nxt-backend -p 4000:4000 nxt-backend:latest"
echo ""
echo "🔗 **After deployment:**"
echo "   Health: http://$SERVER_IP:4000/health"
echo "   API: http://$SERVER_IP:4000/api"
echo ""
echo "⚠️  **IMPORTANT:** Update JWT_SECRET and ENCRYPTION_KEY in .env before production!"