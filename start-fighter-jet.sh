#!/bin/bash

# FIGHTER JET BACKEND DEPLOYMENT SCRIPT
# Starts both the main backend and analytics microservice
# Optimized for maximum performance

echo "🚀 Starting Fighter Jet Backend System..."
echo "🎯 Target: 0.335ms response time"

# Set performance environment variables
export NODE_ENV=production
export UV_THREADPOOL_SIZE=32
export NODE_OPTIONS="--max-old-space-size=2048 --expose-gc --optimize-for-size"

# Kill existing processes
echo "🛑 Stopping existing services..."
pkill -f "node.*index.js" 2>/dev/null || true
pkill -f "node.*analytics-microservice.js" 2>/dev/null || true

# Wait for ports to be released
sleep 2

# Start Analytics Microservice first (on port 4001)
echo "📊 Starting Analytics Microservice..."
nohup node --max-old-space-size=1024 --expose-gc analytics-microservice.js > analytics.log 2>&1 &
ANALYTICS_PID=$!
echo "📊 Analytics Microservice PID: $ANALYTICS_PID"

# Wait for analytics service to start
sleep 3

# Start Fighter Jet Main Backend (on port 4000)
echo "🚀 Starting Fighter Jet Main Backend..."
nohup node --max-old-space-size=2048 --expose-gc --optimize-for-size index.js > backend.log 2>&1 &
BACKEND_PID=$!
echo "🚀 Fighter Jet Backend PID: $BACKEND_PID"

# Wait for services to initialize
sleep 5

# Health checks
echo ""
echo "🔍 Performing health checks..."

# Check main backend
if curl -s http://localhost:4000/health >/dev/null; then
    echo "✅ Fighter Jet Backend: HEALTHY (Port 4000)"
else
    echo "❌ Fighter Jet Backend: FAILED"
    exit 1
fi

# Check analytics service
if curl -s http://localhost:4001/analytics/health >/dev/null; then
    echo "✅ Analytics Microservice: HEALTHY (Port 4001)"
else
    echo "⚠️ Analytics Microservice: WARNING (Port 4001)"
fi

echo ""
echo "🚀 FIGHTER JET SYSTEM DEPLOYED SUCCESSFULLY!"
echo ""
echo "📡 Main Backend: http://localhost:4000"
echo "📊 Analytics Service: http://localhost:4001"
echo ""
echo "🎯 ENDPOINTS:"
echo "  Health Check: http://localhost:4000/health"
echo "  Performance Metrics: http://localhost:4000/metrics"
echo "  Fast Query: http://localhost:4000/api/fast-query"
echo "  Cached Data: http://localhost:4000/api/cached-data"
echo ""
echo "📊 ANALYTICS ENDPOINTS:"
echo "  Dashboard: http://localhost:4001/analytics/dashboard"
echo "  Performance: http://localhost:4001/analytics/performance"
echo "  Database Stats: http://localhost:4001/analytics/database"
echo ""
echo "📋 PROCESS IDs:"
echo "  Main Backend: $BACKEND_PID"
echo "  Analytics: $ANALYTICS_PID"
echo ""
echo "📁 LOG FILES:"
echo "  Backend: backend.log"
echo "  Analytics: analytics.log"
echo ""
echo "🛡️ READY FOR FIGHTER JET PERFORMANCE!"

# Save PIDs for later use
echo $BACKEND_PID > backend.pid
echo $ANALYTICS_PID > analytics.pid