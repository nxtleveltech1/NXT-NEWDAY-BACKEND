#!/bin/bash
# NXT NEW DAY Production Deployment Script
# Story 1.7: Production Deployment & Cutover

set -e

echo "🚀 Starting NXT NEW DAY Production Deployment"
echo "============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_ENV=${1:-production}
BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="./logs/deployment_$(date +%Y%m%d_%H%M%S).log"

# Create directories
mkdir -p backups logs

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "Environment: $DEPLOYMENT_ENV"
echo "Backup Directory: $BACKUP_DIR"
echo "Log File: $LOG_FILE"
echo ""

# Function to log messages
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function to check prerequisites
check_prerequisites() {
    log "🔍 Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker is not installed${NC}"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}❌ Docker Compose is not installed${NC}"
        exit 1
    fi
    
    # Check environment file
    if [ ! -f ".env.$DEPLOYMENT_ENV" ]; then
        echo -e "${RED}❌ Environment file .env.$DEPLOYMENT_ENV not found${NC}"
        exit 1
    fi
    
    log "✅ Prerequisites check passed"
}

# Function to create backup
create_backup() {
    log "💾 Creating backup..."
    mkdir -p "$BACKUP_DIR"
    
    # Backup current deployment
    if [ -f "docker-compose.production.yml" ]; then
        cp docker-compose.production.yml "$BACKUP_DIR/"
    fi
    
    # Backup environment
    if [ -f ".env.$DEPLOYMENT_ENV" ]; then
        cp ".env.$DEPLOYMENT_ENV" "$BACKUP_DIR/"
    fi
    
    # Backup application code
    tar -czf "$BACKUP_DIR/application_backup.tar.gz" --exclude=node_modules --exclude=logs --exclude=backups .
    
    log "✅ Backup created at $BACKUP_DIR"
}

# Function to run pre-deployment validation
pre_deployment_validation() {
    log "🔍 Running pre-deployment validation..."
    
    # Run tests
    echo -e "${YELLOW}Running tests...${NC}"
    npm test --silent || {
        echo -e "${RED}❌ Tests failed${NC}"
        exit 1
    }
    
    # Check environment variables
    echo -e "${YELLOW}Validating environment variables...${NC}"
    source ".env.$DEPLOYMENT_ENV"
    
    required_vars=(
        "DATABASE_URL"
        "VITE_STACK_PROJECT_ID"
        "VITE_STACK_PUBLISHABLE_CLIENT_KEY"
        "STACK_SECRET_SERVER_KEY"
    )
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo -e "${RED}❌ Required environment variable $var is not set${NC}"
            exit 1
        fi
    done
    
    log "✅ Pre-deployment validation passed"
}

# Function to deploy application
deploy_application() {
    log "🚀 Deploying application..."
    
    # Copy environment file
    cp ".env.$DEPLOYMENT_ENV" .env
    
    # Build and start services
    echo -e "${YELLOW}Building Docker images...${NC}"
    docker-compose -f docker-compose.production.yml build
    
    echo -e "${YELLOW}Starting services...${NC}"
    docker-compose -f docker-compose.production.yml up -d
    
    # Wait for services to be ready
    echo -e "${YELLOW}Waiting for services to be ready...${NC}"
    sleep 30
    
    # Health check
    if curl -f http://localhost:4000/health > /dev/null 2>&1; then
        log "✅ Application deployed successfully"
    else
        echo -e "${RED}❌ Application health check failed${NC}"
        exit 1
    fi
}

# Function to run data migration
run_data_migration() {
    log "📊 Running data migration..."
    
    # Run migration scripts
    echo -e "${YELLOW}Executing database migrations...${NC}"
    node src/db/migrations/data-migration-suite.js || {
        echo -e "${RED}❌ Data migration failed${NC}"
        exit 1
    }
    
    log "✅ Data migration completed"
}

# Function to post-deployment validation
post_deployment_validation() {
    log "✅ Running post-deployment validation..."
    
    # Check all endpoints
    endpoints=(
        "http://localhost:4000/health"
        "http://localhost:4000/api/suppliers"
        "http://localhost:4000/api/analytics/health"
    )
    
    for endpoint in "${endpoints[@]}"; do
        if curl -f "$endpoint" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ $endpoint - OK${NC}"
        else
            echo -e "${RED}❌ $endpoint - FAILED${NC}"
            exit 1
        fi
    done
    
    log "✅ Post-deployment validation passed"
}

# Function to rollback on failure
rollback() {
    log "🔄 Rolling back deployment..."
    
    # Stop current services
    docker-compose -f docker-compose.production.yml down
    
    # Restore from backup
    if [ -d "$BACKUP_DIR" ]; then
        cp "$BACKUP_DIR/docker-compose.production.yml" . 2>/dev/null || true
        cp "$BACKUP_DIR/.env.$DEPLOYMENT_ENV" . 2>/dev/null || true
    fi
    
    log "✅ Rollback completed"
}

# Main deployment process
main() {
    log "🚀 Starting deployment process..."
    
    # Set trap for cleanup on failure
    trap 'echo -e "${RED}❌ Deployment failed. Rolling back...${NC}"; rollback; exit 1' ERR
    
    check_prerequisites
    create_backup
    pre_deployment_validation
    deploy_application
    run_data_migration
    post_deployment_validation
    
    echo ""
    echo -e "${GREEN}🎉 DEPLOYMENT SUCCESSFUL!${NC}"
    echo -e "${GREEN}============================${NC}"
    echo "Deployment Environment: $DEPLOYMENT_ENV"
    echo "Application URL: http://localhost:4000"
    echo "Monitoring: http://localhost:3000 (Grafana)"
    echo "Logs: $LOG_FILE"
    echo "Backup: $BACKUP_DIR"
    echo ""
    echo -e "${BLUE}📊 Quick Health Check:${NC}"
    echo "Application: $(curl -s http://localhost:4000/health || echo 'FAILED')"
    echo "Analytics: $(curl -s http://localhost:4000/api/analytics/health | jq -r '.data.status' 2>/dev/null || echo 'FAILED')"
    
    log "🎉 Deployment completed successfully"
}

# Run main function
main "$@"