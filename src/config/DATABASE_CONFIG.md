# Database Configuration Guide

This directory contains the database configuration for the NXT NEW DAY backend using Drizzle ORM with Neon serverless PostgreSQL.

## Setup Instructions

1. **Environment Variables**
   - Copy the `.env` file in the BACKEND directory
   - Update the `DATABASE_URL` with your actual Neon connection string
   - You can get your connection string from the Neon dashboard

2. **Configuration File Structure**
   - `database.js` - Main database configuration with connection pooling
   - `database.example.js` - Examples of how to use the database connection

## Features

- **Serverless-optimized**: Uses Neon's serverless adapter for optimal performance
- **Connection Pooling**: Configured with appropriate pool settings for serverless environments
- **Environment-based Configuration**: Supports different settings for development/production
- **Graceful Shutdown**: Properly closes database connections on process termination
- **WebSocket Support**: Includes WebSocket configuration for local development

## Usage

```javascript
import { db } from './config/database.js';
import { sql } from 'drizzle-orm';

// Execute raw SQL
const result = await db.execute(sql`SELECT * FROM users`);

// Test connection
import { testConnection } from './config/database.js';
const isConnected = await testConnection();
```

## Environment Variables

- `DATABASE_URL` (required): Your Neon PostgreSQL connection string
- `DB_POOL_MIN` (optional): Minimum pool size (default: 2)
- `DB_POOL_MAX` (optional): Maximum pool size (default: 10)
- `DB_POOL_IDLE_TIMEOUT` (optional): Idle timeout in milliseconds (default: 30000)

## Connection Pool Settings

The configuration uses conservative pool settings suitable for serverless:
- Min connections: 2
- Max connections: 10
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds

These can be adjusted based on your application's needs.