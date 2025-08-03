# Coolify Deployment Script for Windows
# Run this script to prepare deployment files for your Coolify server

Write-Host "🚀 Preparing NXT Backend Deployment for Coolify..." -ForegroundColor Green

# Configuration
$AppName = "nxt-backend"
$ImageName = "nxt-backend:latest"
$Port = "4000"
$ServerIP = "152.53.114.19"

# Create deployment directory
$DeployDir = "coolify-deployment"
if (Test-Path $DeployDir) {
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Path $DeployDir | Out-Null

# Create environment file
$envContent = @"
# Core Application
NODE_ENV=production
PORT=4000
JWT_SECRET=your_jwt_secret_here_change_this
SESSION_SECRET=your_session_secret_here_change_this

# CORS Configuration
CORS_ORIGIN=https://nxtdotx.co.za,https://www.nxtdotx.co.za

# Database Configuration (update with your actual Neon database URL)
DATABASE_URL=postgresql://username:password@host:port/database

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# AI & Analytics
AI_ANALYTICS_URL=http://localhost:4000
OPENAI_API_KEY=your_openai_api_key_here
CLOUDFLARE_API_TOKEN=your_cloudflare_token_here
"@

$envContent | Out-File -FilePath "$DeployDir\.env.coolify" -Encoding UTF8
Write-Host "✅ Created .env.coolify" -ForegroundColor Green

# Create Docker Compose file
$composeContent = @"
version: '3.8'

services:
  backend:
    image: $ImageName
    container_name: $AppName
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.coolify
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    labels:
      - "coolify.managed=true"
      - "coolify.name=$AppName"
      - "coolify.port=4000"
      - "coolify.healthcheck=/health"
"@

$composeContent | Out-File -FilePath "$DeployDir\docker-compose.coolify.yml" -Encoding UTF8
Write-Host "✅ Created docker-compose.coolify.yml" -ForegroundColor Green

# Create deployment instructions
$instructions = @"
# Coolify Deployment Instructions

## Files Created:
- .env.coolify (environment variables)
- docker-compose.coolify.yml (Coolify configuration)

## Deployment Steps:

### Method 1: Direct Upload to Coolify
1. Access Coolify: http://$ServerIP`:8000
2. Click "New Application"
3. Select "Docker Compose"
4. Upload docker-compose.coolify.yml
5. Upload .env.coolify
6. Deploy

### Method 2: Manual Configuration
1. SSH to server: ssh root@$ServerIP
2. Create directory: mkdir -p /opt/coolify/applications/$AppName
3. Upload files via SCP:
   scp -r .\coolify-deployment\* root@$ServerIP`:/opt/coolify/applications/$AppName/
4. Deploy via Coolify web interface

### Method 3: Direct Docker Run
If you have server access, run:
docker run -d --name $AppName -p 4000:4000 --env-file .env.coolify $ImageName

## Verification:
- Health check: http://$ServerIP`:4000/health
- API base: http://$ServerIP`:4000/api

## Important Notes:
- Update DATABASE_URL with your actual Neon database connection string
- Update JWT_SECRET and SESSION_SECRET with secure random values
- Update API keys with your actual credentials
"@

$instructions | Out-File -FilePath "$DeployDir\DEPLOYMENT_INSTRUCTIONS.md" -Encoding UTF8
Write-Host "✅ Created DEPLOYMENT_INSTRUCTIONS.md" -ForegroundColor Green

# Create a simple deployment batch file
$batchContent = @"
@echo off
echo Deploying to Coolify server...
echo Server: $ServerIP
echo App: $AppName
echo.
echo Files ready for deployment in: $DeployDir
echo.
echo Next steps:
echo 1. Access http://$ServerIP`:8000
echo 2. Create new application
echo 3. Upload docker-compose.coolify.yml
echo 4. Upload .env.coolify
echo 5. Deploy
pause
"@

$batchContent | Out-File -FilePath "$DeployDir\deploy.bat" -Encoding ASCII
Write-Host "✅ Created deploy.bat" -ForegroundColor Green

# Copy the built Docker image info
@"
Image: $ImageName
Size: $(docker images $ImageName --format "table {{.Size}}" | Select-Object -Skip 1)
Built: $(Get-Date)
"@ | Out-File -FilePath "$DeployDir\image-info.txt" -Encoding UTF8

Write-Host ""
Write-Host "🎉 Deployment package created successfully!" -ForegroundColor Green
Write-Host "📁 Files location: $(Get-Location)\$DeployDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Copy the files from $DeployDir to your Coolify server" -ForegroundColor White
Write-Host "2. Access http://$ServerIP`:8000" -ForegroundColor White
Write-Host "3. Create new application with Docker Compose" -ForegroundColor White
Write-Host "4. Upload the configuration files" -ForegroundColor White
Write-Host "5. Deploy and monitor" -ForegroundColor White

# Open the deployment directory
Start-Process explorer.exe $DeployDir