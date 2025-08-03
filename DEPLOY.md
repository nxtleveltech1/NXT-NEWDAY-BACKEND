                                                                                                                                                                                                                                                                                                                                                                                                                                                                        
                                                                                                                                                                                                                                                                                                                                                                                                                                                                         nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn # 🚀 NXT Backend Deployment - Clean Production Ready

## **TERMINAL COMMAND TO START SERVER NOW**

### **Linux/Mac:**
```bash
bash deploy.sh
```

### **Windows:**
```cmd
deploy-windows.bat
```

## **Quick Start - 3 Simple Steps**

### **Step 1: Build Docker Image**
```bash
docker build -t nxt-backend:latest .
```

### **Step 2: Deploy to Coolify**
**Option A - Coolify Web Interface:**
1. Go to: http://152.53.114.19:8000
2. Create new application
3. Upload `docker-compose.yml` and `.env`

**Option B - SSH:**
```bash
scp docker-compose.yml .env root@152.53.114.19:/opt/nxt-backend/
ssh root@152.53.114.19 'cd /opt/nxt-backend && docker-compose up -d'
```

**Option C - Direct Docker:**
```bash
docker run -d --name nxt-backend -p 4000:4000 nxt-backend:latest
```

### **Step 3: Verify Deployment**
```bash
curl http://152.53.114.19:4000/health
```

## **Files Ready for Deployment**
- ✅ `Dockerfile` - Production container
- ✅ `docker-compose.yml` - Production orchestration
- ✅ `.env` - Environment variables
- ✅ `deploy.sh` - Linux deployment script
- ✅ `deploy-windows.bat` - Windows deployment script

## **Post-Deployment URLs**
- **Health Check**: http://152.53.114.19:4000/health
- **API Base**: http://152.53.114.19:4000/api
- **Documentation**: http://152.53.114.19:4000/api-docs

## **Security Checklist**
⚠️ **Before production, update these in .env:**
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `DATABASE_URL`

## **Quick Commands**
```bash
# Check if running
curl http://152.53.114.19:4000/health

# View logs
docker logs nxt-backend

# Restart
docker-compose restart
```

## **Clean Structure**
- **Root**: Essential deployment files only
- **ARCHIVED_CLEAN**: All previous deployment scripts moved here
- **Ready for immediate deployment**