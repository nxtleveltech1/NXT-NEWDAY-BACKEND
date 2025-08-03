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
