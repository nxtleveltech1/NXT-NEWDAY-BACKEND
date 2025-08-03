# NXT Backend Coolify Deployment

## Quick Start

1. **Access Coolify**: http://152.53.114.19:8000
2. **Create Application**: New → Docker Compose
3. **Upload Files**: docker-compose.yml and .env
4. **Deploy**: Click deploy and monitor logs

## Files
- `docker-compose.yml`: Coolify configuration
- `.env`: Environment variables (update with your values)
- `deploy.sh`: Server deployment script
- `deploy-commands.txt`: Step-by-step commands

## Configuration Required
Update these values in .env:
- DATABASE_URL: Your Neon database connection string
- JWT_SECRET: Generate a secure random string
- SESSION_SECRET: Generate a secure random string
- API keys: Your actual API keys

## Verification
- Health endpoint: http://152.53.114.19:4000/health
- API base: http://152.53.114.19:4000/api
