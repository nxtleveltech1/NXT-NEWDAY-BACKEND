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
