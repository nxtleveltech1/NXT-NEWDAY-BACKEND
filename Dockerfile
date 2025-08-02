# Production Dockerfile for NXT Backend

# Use official Node.js LTS image
FROM node:20-alpine AS base

# Install security updates and essential tools
RUN apk update && apk upgrade && \
    apk add --no-cache curl ca-certificates && \
    rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Expose the backend port
EXPOSE 4000

# Healthcheck (optional, for Docker Compose)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start the backend
CMD ["npm", "start"]