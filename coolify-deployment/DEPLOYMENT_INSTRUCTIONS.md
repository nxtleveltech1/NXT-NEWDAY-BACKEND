# Coolify Deployment Instructions

## Files Created:
- .env.coolify (environment variables)
- docker-compose.coolify.yml (Coolify configuration)

## Deployment Steps:

### Method 1: Direct Upload to Coolify
1. Access Coolify: http://152.53.114.19:8000
2. Click "New Application"
3. Select "Docker Compose"
4. Upload docker-compose.coolify.yml
5. Upload .env.coolify
6. Deploy

### Method 2: Manual Configuration
1. SSH to server: ssh root@152.53.114.19
2. Create directory: mkdir -p /opt/coolify/applications/nxt-backend
3. Upload files via SCP:
   scp -r .\coolify-deployment\* root@152.53.114.19:/opt/coolify/applications/nxt-backend/
4. Deploy via Coolify web interface

### Method 3: Direct Docker Run
If you have server access, run:
docker run -d --name nxt-backend -p 4000:4000 --env-file .env.coolify nxt-backend:latest

## Verification:
- Health check: http://152.53.114.19:4000/health
- API base: http://152.53.114.19:4000/api

## Important Notes:
- Update DATABASE_URL with your actual Neon database connection string
- Update JWT_SECRET and SESSION_SECRET with secure random values
- Update API keys with your actual credentials
