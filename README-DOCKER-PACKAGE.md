# Docker Package Deployment Guide

## Pre-built Docker Image Ready for Coolify

The backend has been successfully built as a Docker container and is ready for deployment to Coolify.

### Image Details
- **Image Name**: `nxt-backend:latest`
- **Tagged for GitHub Packages**: `ghcr.io/garet/nxt-backend:v1.0.0`
- **Size**: ~200MB (optimized for production)
- **Base**: Node.js 20 Alpine (lightweight and secure)

### Features Included
- ✅ All CI/CD pipeline fixes applied
- ✅ Production-ready configuration
- ✅ Health check endpoints
- ✅ Cluster mode with 8 workers
- ✅ Environment variable support
- ✅ Database connection pooling
- ✅ Error handling and logging

### Coolify Deployment Instructions

1. **Pull the image** (if using GitHub Packages):
   ```bash
   docker pull ghcr.io/garet/nxt-backend:v1.0.0
   ```

2. **Environment Variables Required**:
   ```bash
   # Database
   DATABASE_URL=your_neon_database_url
   NILEDB_API_KEY=your_niledb_api_key
   
   # Server
   PORT=3000
   NODE_ENV=production
   
   # Security
   JWT_SECRET=your_jwt_secret
   ENCRYPTION_KEY=your_encryption_key
   
   # External Services
   OPENAI_API_KEY=your_openai_key
   CLOUDFLARE_API_TOKEN=your_cloudflare_token
   ```

3. **Port Mapping**:
   - Container: `3000`
   - Host: `3000` (or any available port)

4. **Health Check**:
   - Endpoint: `http://localhost:3000/health`
   - Method: GET
   - Expected response: `{"status":"ok","timestamp":"..."}`

### Alternative: Local Docker Run
If you want to test locally before Coolify:
```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=your_url \
  -e NODE_ENV=production \
  nxt-backend:latest
```

### Image Verification
To verify the image is working:
```bash
docker run --rm -p 3000:3000 nxt-backend:latest
curl http://localhost:3000/health
```

The container is production-ready and includes all the fixes from the last 48 hours of development.