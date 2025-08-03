# Coolify Deployment Guide - NXT Backend

## Quick Start with Local Docker Image

Since GitHub Container Registry requires authentication setup, you can deploy directly using the locally built Docker image.

### Option 1: Local Docker Image (Recommended for immediate deployment)

1. **Verify the image exists**:
   ```bash
   docker images | grep nxt-backend
   ```

2. **Coolify Configuration**:
   - **Image**: `nxt-backend:latest`
   - **Source**: Local Docker image
   - **Port**: `3000`
   - **Environment**: Production

### Option 2: GitHub Container Registry (Future setup)

1. **Enable GitHub Packages**:
   - Go to your GitHub repository settings
   - Navigate to "Packages" section
   - Ensure "Container Registry" is enabled

2. **Create Personal Access Token**:
   - GitHub Settings → Developer settings → Personal access tokens
   - Create token with `write:packages` and `read:packages` scopes
   - Use this token for `docker login ghcr.io`

3. **Push image**:
   ```bash
   docker login ghcr.io -u YOUR_USERNAME -p YOUR_TOKEN
   docker push ghcr.io/garet/nxt-backend:v1.0.0
   ```

## Coolify Deployment Steps

### 1. Create New Application
1. Login to your Coolify dashboard
2. Click "New Application"
3. Select "Docker" as source
4. Choose "Local Docker" option

### 2. Configuration
```yaml
# Application Settings
Name: nxt-backend
Image: nxt-backend:latest
Port: 3000
Restart Policy: Always

# Environment Variables
DATABASE_URL: your_neon_database_url
NILEDB_API_KEY: your_niledb_api_key
NODE_ENV: production
PORT: 3000
JWT_SECRET: your_jwt_secret
ENCRYPTION_KEY: your_encryption_key
OPENAI_API_KEY: your_openai_key
CLOUDFLARE_API_TOKEN: your_cloudflare_token
```

### 3. Health Check
- **Path**: `/health`
- **Method**: GET
- **Expected Response**: `{"status":"ok","timestamp":"..."}`
- **Timeout**: 30 seconds

### 4. Resource Limits
```yaml
Memory: 512MB
CPU: 0.5 cores
Storage: 1GB
```

### 5. Networking
- **Internal Port**: 3000
- **External Port**: Auto-assign (Coolify will provide URL)
- **Protocol**: HTTP/HTTPS

## Verification Steps

1. **Check deployment logs** in Coolify dashboard
2. **Test health endpoint**:
   ```bash
   curl https://your-coolify-url/health
   ```
3. **Test API endpoints**:
   ```bash
   curl https://your-coolify-url/api/health
   ```

## Troubleshooting

### Common Issues

1. **Image not found**:
   - Ensure Docker image is built locally: `docker build -t nxt-backend:latest .`

2. **Database connection failed**:
   - Verify `DATABASE_URL` environment variable
   - Check if Neon database is accessible

3. **Port conflicts**:
   - Coolify automatically assigns external ports
   - Internal port should always be 3000

4. **Memory issues**:
   - Increase memory limit to 1GB if needed
   - Monitor logs for OOM errors

## Monitoring

### Coolify Dashboard
- Real-time logs
- Resource usage monitoring
- Health check status
- Deployment history

### Application Metrics
- Available at `/health` endpoint
- Includes uptime, memory usage, and request counts

## Next Steps

1. **Deploy backend** using Coolify
2. **Set up Cloudflare Worker** (see `cloudflare-worker/README.md`)
3. **Configure custom domain** in Coolify
4. **Set up SSL certificates** (automatic with Coolify)
5. **Deploy frontend** to connect to backend

## Support

If you encounter issues:
1. Check Coolify logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure Docker daemon is running
4. Test locally with `docker run -p 3000:3000 nxt-backend:latest`