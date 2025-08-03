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
