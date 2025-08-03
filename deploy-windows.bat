@echo off
REM Clean Windows Deployment Script for NXT Backend
REM Deploy to Coolify Server (152.53.114.19:8000)

set SERVER_IP=152.53.114.19
set COOLIFY_URL=http://152.53.114.19:8000

echo 🚀 NXT Backend Production Deployment
echo ==================================

echo 🔍 Checking server connectivity...
curl -s -o nul -w "%%{http_code}" %COOLIFY_URL% | findstr "200 302" > nul
if %errorlevel% neq 0 (
    echo ❌ Cannot reach Coolify server
    pause
    exit /b 1
)
echo ✅ Coolify server accessible at %COOLIFY_URL%

echo 🏗️ Building Docker image...
docker build -t nxt-backend:latest .

echo 📋 Creating production files...

echo version: '3.8' > docker-compose.yml
echo services: >> docker-compose.yml
echo   nxt-backend: >> docker-compose.yml
echo     image: nxt-backend:latest >> docker-compose.yml
echo     container_name: nxt-backend >> docker-compose.yml
echo     ports: >> docker-compose.yml
echo       - "4000:4000" >> docker-compose.yml
echo     environment: >> docker-compose.yml
echo       - NODE_ENV=production >> docker-compose.yml
echo       - PORT=4000 >> docker-compose.yml
echo       - JWT_SECRET=your-jwt-secret-change-this >> docker-compose.yml
echo       - ENCRYPTION_KEY=your-encryption-key-change-this >> docker-compose.yml
echo     restart: unless-stopped >> docker-compose.yml
echo     healthcheck: >> docker-compose.yml
echo       test: ["CMD", "curl", "-f", "http://localhost:4000/health"] >> docker-compose.yml
echo       interval: 30s >> docker-compose.yml
echo       timeout: 10s >> docker-compose.yml
echo       retries: 3 >> docker-compose.yml

echo NODE_ENV=production > .env
echo PORT=4000 >> .env
echo JWT_SECRET=your-super-secret-jwt-key-change-this-immediately >> .env
echo ENCRYPTION_KEY=your-32-character-encryption-key-here >> .env
echo API_BASE_URL=http://%SERVER_IP%:4000 >> .env
echo FRONTEND_URL=http://%SERVER_IP%:3000 >> .env

echo ✅ Production files created!
echo.
echo 🚀 DEPLOYMENT OPTIONS:
echo.
echo 1. Coolify Web Interface:
echo    - Go to: %COOLIFY_URL%
echo    - Create new application
echo    - Upload docker-compose.yml and .env
echo.
echo 2. SSH Deployment:
echo    scp docker-compose.yml .env root@%SERVER_IP%:/opt/nxt-backend/
echo    ssh root@%SERVER_IP% "cd /opt/nxt-backend && docker-compose up -d"
echo.
echo 3. Direct Docker:
echo    docker run -d --name nxt-backend -p 4000:4000 nxt-backend:latest
echo.
echo 🔗 After deployment:
echo    Health: http://%SERVER_IP%:4000/health
echo    API: http://%SERVER_IP%:4000/api
echo.
pause