# Backend Dockerfile
FROM node:20-alpine

# Install build dependencies and curl for health checks
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs backups uploads

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 4000

# Health check - use curl instead of node for better reliability
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start the application using cluster.js as defined in package.json
CMD ["node", "--max-old-space-size=2048", "--expose-gc", "cluster.js"]