# NXT New Day Backend - Deployment Guide

## Architecture Overview

This backend is designed to run on **Coolify** (Node.js hosting) with the following deployment strategy:

- **Frontend**: Vercel (already configured)
- **Backend**: Coolify (Docker-based deployment)
- **Database**: Neon PostgreSQL (already configured)
- **Optional**: Cloudflare Worker as API Gateway (not required for basic setup)

## Quick Start

### 1. Coolify Deployment

#### Option A: Git-based Deployment (Recommended)
1. Push your code to a Git repository
2. In Coolify:
   - Create new application
   - Select Git repository
   - Set build context to `./`
   - Set Dockerfile path to `./Dockerfile`
   - Set port to `4000`

#### Option B: Manual Deployment
```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment script
./deploy.sh
```

### 2. Environment Variables

Set these in Coolify dashboard:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `PORT` | Server port | `4000` |
| `NODE_ENV` | Environment | `production` |

### 3. Health Check

The backend includes a health check endpoint:
- **URL**: `http://your-domain.com/health`
- **Method**: GET
- **Response**: `{"status":"healthy","timestamp":"...","uptime":...}`

## File Structure

```
├── Dockerfile          # Production Docker image
├── docker-compose.yml  # Local development with Docker
├── coolify.json        # Coolify configuration
├── deploy.sh          # Deployment automation script
├── health.js          # Health check server
├── .dockerignore      # Docker ignore patterns
└── README-DEPLOYMENT.md # This file
```

## Testing Before Deployment

```bash
# Run tests
npm run test:niledb-integration

# Build Docker image locally
docker build -t nxt-backend:test .

# Run container locally
docker run -p 4000:4000 --env-file .env nxt-backend:test
```

## Monitoring

- **Health Check**: `/health` endpoint
- **Logs**: Available in Coolify dashboard
- **Metrics**: Basic uptime monitoring via health checks

## Troubleshooting

### Common Issues

1. **Port already in use**: Ensure port 4000 is available
2. **Database connection**: Verify DATABASE_URL format
3. **Build failures**: Check Dockerfile syntax and dependencies

### Debug Commands

```bash
# Check container logs
docker logs <container-id>

# Test health endpoint
curl http://localhost:4000/health

# Check environment variables
docker exec <container-id> env
```

## Architecture Decision

**Why Coolify instead of Cloudflare Workers?**
- Full Node.js environment support
- Native PostgreSQL/Redis connections
- Long-lived TCP connections
- Clustering support
- No architectural changes required

## Next Steps

1. ✅ All tests passing (18/18)
2. ✅ Docker configuration complete
3. ✅ Coolify deployment files ready
4. 🔄 Deploy to Coolify
5. 🔄 Configure domain and SSL
6. 🔄 Update frontend API endpoints

## Support

For deployment issues:
1. Check Coolify logs
2. Verify environment variables
3. Test health endpoint
4. Review application logs