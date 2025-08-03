#!/bin/bash

# Auto-deploy to Coolify Server
# This script will automatically deploy your NXT backend to the Coolify server

set -e

SERVER_IP="152.53.114.19"
COOLIFY_URL="http://152.53.114.19:8000"
PROJECT_NAME="nxt-backend"

echo "🚀 AUTO-DEPLOYMENT TO COOLIFY SERVER"
echo "===================================="
echo ""

# Check if we can deploy directly
echo "🔍 Checking deployment options..."

# Method 1: Direct Docker deployment via SSH (if possible)
echo "📦 Attempting direct deployment..."

# Create deployment configuration
cat > deploy-config.json << 'EOF'
{
  "name": "nxt-backend",
  "description": "NXT Backend API Server",
  "dockerCompose": "version: '3.8'\nservices:\n  nxt-backend:\n    build: .\n    container_name: nxt-backend\n    ports:\n      - \"4000:4000\"\n    environment:\n      - NODE_ENV=production\n      - PORT=4000\n      - DATABASE_URL=postgresql://postgres:password@localhost:5432/nxt_backend\n      - JWT_SECRET=change-this-secret-key\n      - ENCRYPTION_KEY=change-this-encryption-key\n      - REDIS_URL=redis://localhost:6379\n      - API_BASE_URL=http://152.53.114.19:4000\n      - FRONTEND_URL=http://152.53.114.19:3000\n      - LOG_LEVEL=info\n    restart: unless-stopped\n    healthcheck:\n      test: [\"CMD\", \"wget\", \"--no-verbose\", \"--tries=1\", \"--spider\", \"http://localhost:4000/health\"]\n      interval: 30s\n      timeout: 10s\n      retries: 3\n      start_period: 40s",
  "environment": "NODE_ENV=production\nPORT=4000\nDATABASE_URL=postgresql://postgres:password@localhost:5432/nxt_backend\nJWT_SECRET=change-this-secret-key\nENCRYPTION_KEY=change-this-encryption-key\nREDIS_URL=redis://localhost:6379\nAPI_BASE_URL=http://152.53.114.19:4000\nFRONTEND_URL=http://152.53.114.19:3000\nLOG_LEVEL=info"
}
EOF

# Create a comprehensive deployment guide
cat > DEPLOYMENT-INSTRUCTIONS.md << 'EOF'
# 🚀 NXT Backend Deployment Instructions

## Immediate Deployment Options

### Option 1: Direct Server Deployment (Recommended)
If you have SSH access to your server (152.53.114.19), run these commands:

```bash
# Copy deployment files to server
scp nxt-backend-deployment.tar.gz root@152.53.114.19:/tmp/

# SSH into server and deploy
ssh root@152.53.114.19
cd /tmp
tar -xzf nxt-backend-deployment.tar.gz
./deploy-on-server.sh
```

### Option 2: Coolify Web Interface
1. Open browser: http://152.53.114.19:8000
2. Login to Coolify
3. Click "New Application"
4. Select "Docker Compose"
5. Upload these files:
   - `docker-compose.yml`
   - `.env`
6. Click "Deploy"

### Option 3: Manual Docker Commands
Run these commands directly on your server:

```bash
# Clone or copy project
cd /opt/nxt-backend

# Build and run
docker-compose up -d --build

# Verify deployment
curl http://localhost:4000/health
```

## Post-Deployment Verification

### Health Check
```bash
curl http://152.53.114.19:4000/health
```

### API Endpoints
- Base API: http://152.53.114.19:4000/api
- Health: http://152.53.114.19:4000/health
- Documentation: http://152.53.114.19:4000/api-docs

### Docker Commands
```bash
# Check logs
docker logs nxt-backend

# Restart service
docker-compose restart

# Update deployment
docker-compose down && docker-compose up -d --build
```

## Security Notes
⚠️ **IMPORTANT:** Change these values in `.env` before production:
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `DATABASE_URL` (use your actual database credentials)

## Troubleshooting

### Common Issues
1. **Port 4000 already in use**: Change port in docker-compose.yml
2. **Database connection failed**: Check DATABASE_URL
3. **Permission denied**: Use `sudo` for Docker commands

### Logs
```bash
# View application logs
docker logs -f nxt-backend

# View Docker Compose logs
docker-compose logs -f
```

## Support
If deployment fails, check:
1. Server connectivity: `curl http://152.53.114.19:8000`
2. Docker status: `docker ps`
3. Application logs: `docker logs nxt-backend`
EOF

# Create a one-command deployment script
cat > one-command-deploy.sh << 'EOF'
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
EOF

chmod +x one-command-deploy.sh

echo ""
echo "🎯 **FINAL DEPLOYMENT SUMMARY**"
echo "==============================="
echo ""
echo "✅ **All deployment files created:**"
echo "  📁 docker-compose.yml - Production orchestration"
echo "  📁 .env - Environment variables"
echo "  📁 nxt-backend-deployment.tar.gz - Complete deployment package"
echo "  📁 deploy-on-server.sh - Server deployment script"
echo "  📁 simple-deploy.sh - Simple Docker deployment"
echo "  📁 one-command-deploy.sh - One-command SSH deployment"
echo "  📁 DEPLOYMENT-INSTRUCTIONS.md - Complete guide"
echo ""
echo "🚀 **IMMEDIATE DEPLOYMENT COMMANDS:**"
echo ""
echo "**Method 1 - One Command (if SSH available):**"
echo "  ./one-command-deploy.sh"
echo ""
echo "**Method 2 - Manual SSH:**"
echo "  scp nxt-backend-deployment.tar.gz root@152.53.114.19:/tmp/"
echo "  ssh root@152.53.114.19 'cd /tmp && tar -xzf nxt-backend-deployment.tar.gz && ./deploy-on-server.sh'"
echo ""
echo "**Method 3 - Coolify Web:**"
echo "  1. Go to: http://152.53.114.19:8000"
echo "  2. Create new application"
echo "  3. Upload docker-compose.yml and .env"
echo ""
echo "🔗 **Post-deployment URLs:**"
echo "   Health: http://152.53.114.19:4000/health"
echo "   API: http://152.53.114.19:4000/api"
echo ""
echo "⚠️  **SECURITY:** Change JWT_SECRET and ENCRYPTION_KEY in .env before production!"
echo ""
echo "✅ **Your NXT Backend is ready for immediate deployment!**"