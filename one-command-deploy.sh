#!/bin/bash
# One-command deployment for NXT Backend

SERVER="152.53.114.19"
PROJECT_DIR="/opt/nxt-backend"

echo "🚀 Deploying NXT Backend to $SERVER..."

# Check if we can SSH
if ssh -o ConnectTimeout=5 root@$SERVER "echo 'SSH connection successful'" 2>/dev/null; then
    echo "✅ SSH access confirmed"
    
    # Deploy via SSH
    ssh root@$SERVER << 'ENDSSH'
    set -e
    
    # Create project directory
    sudo mkdir -p /opt/nxt-backend
    cd /opt/nxt-backend
    
    # Create docker-compose.yml
    cat > docker-compose.yml << 'DOCKER_EOF'
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
      - JWT_SECRET=production-secret-key
      - ENCRYPTION_KEY=production-encryption-key
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
DOCKER_EOF

    # Create simple Dockerfile if not exists
    if [ ! -f Dockerfile ]; then
        cat > Dockerfile << 'DOCKERFILE_EOF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["node", "src/app.js"]
DOCKERFILE_EOF
    fi

    # Create package.json if not exists
    if [ ! -f package.json ]; then
        cat > package.json << 'PACKAGE_EOF'
{
  "name": "nxt-backend",
  "version": "1.0.0",
  "description": "NXT Backend API",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "dotenv": "^16.3.1"
  }
}
PACKAGE_EOF
    fi

    # Create basic app.js
    mkdir -p src
    cat > src/app.js << 'APP_EOF'
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api', (req, res) => {
    res.json({ message: 'NXT Backend API is running' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
APP_EOF

    # Deploy
    echo "🏗️ Building and starting services..."
    sudo docker-compose down 2>/dev/null || true
    sudo docker-compose up -d --build
    
    echo "⏳ Waiting for service to start..."
    sleep 30
    
    # Health check
    if curl -f http://localhost:4000/health > /dev/null 2>&1; then
        echo "✅ Service is running!"
        echo "📊 Health: http://$SERVER:4000/health"
        echo "🔗 API: http://$SERVER:4000/api"
    else
        echo "❌ Service failed to start"
        sudo docker-compose logs --tail=20
    fi
ENDSSH
    
else
    echo "❌ SSH access not available"
    echo "Please use one of these methods:"
    echo "1. Upload files via Coolify web interface"
    echo "2. Use SCP to copy files to server"
    echo "3. Provide SSH credentials"
fi
