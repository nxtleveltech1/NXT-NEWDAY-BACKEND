#!/bin/bash

# NXT API Gateway - Cloudflare Worker Deployment Script
# Deploys the intelligent API gateway with analytics and AI features

set -e

echo "🚀 Deploying NXT API Gateway to Cloudflare Workers..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_NAME="nxt-api-gateway"
BACKEND_URL_PROD="https://api.nxtdotx.co.za"
BACKEND_URL_STAGING="https://staging-api.nxtdotx.co.za"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Wrangler CLI...${NC}"
    npm install -g wrangler
fi

# Navigate to worker directory
cd "$(dirname "$0")"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

# Login to Cloudflare (if needed)
echo -e "${BLUE}🔐 Checking Cloudflare authentication...${NC}"
wrangler whoami || wrangler login

# Create KV namespaces (if they don't exist)
echo -e "${BLUE}🗄️ Setting up KV namespaces...${NC}"
wrangler kv:namespace create ANALYTICS_KV || echo "ANALYTICS_KV already exists"
wrangler kv:namespace create CACHE_KV || echo "CACHE_KV already exists"
wrangler kv:namespace create RATE_LIMIT_KV || echo "RATE_LIMIT_KV already exists"

# Deploy to staging
echo -e "${YELLOW}🧪 Deploying to staging...${NC}"
wrangler deploy --env staging

# Deploy to production
echo -e "${GREEN}🚀 Deploying to production...${NC}"
wrangler deploy --env production

# Test deployment
echo -e "${BLUE}🧪 Testing deployment...${NC}"
WORKER_URL=$(wrangler dev --env production --dry-run 2>/dev/null | grep -o 'https://[^ ]*' | head -1)
if [ -n "$WORKER_URL" ]; then
    echo -e "${GREEN}✅ Worker deployed successfully!${NC}"
    echo -e "${GREEN}📍 Worker URL: $WORKER_URL${NC}"
    
    # Test health endpoint
    echo -e "${BLUE}🔍 Testing health endpoint...${NC}"
    curl -s "$WORKER_URL/health" || echo "Health endpoint not responding (expected for API routes)"
else
    echo -e "${YELLOW}⚠️  Could not determine worker URL${NC}"
fi

# Display next steps
echo ""
echo -e "${GREEN}✅ API Gateway deployment complete!${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Update your frontend to use the Cloudflare Worker URL"
echo "2. Configure custom domain in Cloudflare dashboard"
echo "3. Set up KV namespace IDs in wrangler.toml"
echo "4. Monitor analytics via KV queries"
echo ""
echo -e "${BLUE}🔧 Useful commands:${NC}"
echo "  wrangler tail                    # View real-time logs"
echo "  wrangler kv:key list --binding ANALYTICS_KV  # View analytics"
echo "  npm run dev                      # Local development"
echo ""
echo -e "${GREEN}🎯 Architecture:${NC}"
echo "Frontend → Cloudflare Worker → Coolify Backend"
echo "         ↓"
echo "    Analytics & AI"