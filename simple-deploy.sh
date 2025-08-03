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
