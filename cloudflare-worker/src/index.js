/**
 * NXT New Day API Gateway - Cloudflare Worker
 * Provides edge-level analytics, AI features, and routing
 */

// Configuration
const CONFIG = {
  // Backend URLs - update these with your actual Coolify deployment URLs
  BACKEND_URLS: {
    production: 'https://api.nxtdotx.co.za',
    staging: 'https://staging-api.nxtdotx.co.za',
    development: 'http://localhost:4000'
  },
  
  // Analytics configuration
  ANALYTICS: {
    enabled: true,
    logLevel: 'info',
    includeHeaders: ['user-agent', 'referer', 'x-forwarded-for']
  },
  
  // Rate limiting
  RATE_LIMIT: {
    enabled: true,
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
    keyGenerator: 'ip' // 'ip' or 'user'
  },
  
  // Caching
  CACHE: {
    enabled: true,
    ttl: 300, // 5 minutes
    cacheablePaths: ['/api/suppliers', '/api/products', '/api/pricing']
  },
  
  // AI features
  AI: {
    enabled: true,
    anomalyDetection: true,
    predictiveRouting: false
  }
};

// Analytics storage (using KV store)
class AnalyticsCollector {
  constructor(env) {
    this.env = env;
  }

  async logRequest(request, response, duration) {
    if (!CONFIG.ANALYTICS.enabled) return;

    const log = {
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      status: response.status,
      duration,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('cf-connecting-ip'),
      country: request.cf?.country,
      colo: request.cf?.colo
    };

    // Store in KV for later analysis
    const key = `analytics:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    await this.env.ANALYTICS_KV?.put(key, JSON.stringify(log), {
      expirationTtl: 86400 // 24 hours
    });
  }

  async getMetrics(timeRange = '1h') {
    // Implementation for retrieving metrics
    const keys = await this.env.ANALYTICS_KV?.list({ prefix: 'analytics:' });
    return keys?.keys || [];
  }
}

// Rate limiter
class RateLimiter {
  constructor(env) {
    this.env = env;
  }

  async checkLimit(identifier) {
    if (!CONFIG.RATE_LIMIT.enabled) return { allowed: true };

    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - CONFIG.RATE_LIMIT.windowMs;

    // Get current count
    const count = await this.env.RATE_LIMIT_KV?.get(key);
    const requests = count ? JSON.parse(count) : [];

    // Clean old requests
    const validRequests = requests.filter(time => time > windowStart);

    if (validRequests.length >= CONFIG.RATE_LIMIT.maxRequests) {
      return { allowed: false, resetTime: windowStart + CONFIG.RATE_LIMIT.windowMs };
    }

    // Add current request
    validRequests.push(now);
    await this.env.RATE_LIMIT_KV?.put(key, JSON.stringify(validRequests), {
      expirationTtl: Math.ceil(CONFIG.RATE_LIMIT.windowMs / 1000)
    });

    return { allowed: true, remaining: CONFIG.RATE_LIMIT.maxRequests - validRequests.length };
  }
}

// Cache manager
class CacheManager {
  constructor(env) {
    this.env = env;
  }

  async get(key) {
    if (!CONFIG.CACHE.enabled) return null;
    return await this.env.CACHE_KV?.get(key);
  }

  async set(key, value, ttl = CONFIG.CACHE.ttl) {
    if (!CONFIG.CACHE.enabled) return;
    await this.env.CACHE_KV?.put(key, value, { expirationTtl: ttl });
  }

  isCacheable(url) {
    return CONFIG.CACHE.cacheablePaths.some(path => url.includes(path));
  }

  generateKey(url, method) {
    return `cache:${method}:${url}`;
  }
}

// AI features
class AIFeatures {
  constructor(env) {
    this.env = env;
  }

  async detectAnomaly(request, response) {
    if (!CONFIG.AI.anomalyDetection) return false;

    // Simple anomaly detection based on response time and status
    const responseTime = response.headers.get('cf-worker-response-time');
    const status = response.status;

    // Flag slow responses or error statuses
    return responseTime > 5000 || status >= 500;
  }

  async routeIntelligently(request) {
    if (!CONFIG.AI.predictiveRouting) return 'production';

    // Simple routing based on geography
    const country = request.cf?.country;
    
    // Route EU users to EU backend
    if (['DE', 'FR', 'IT', 'ES', 'NL'].includes(country)) {
      return 'eu';
    }
    
    return 'production';
  }
}

// Main worker
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    
    // Initialize services
    const analytics = new AnalyticsCollector(env);
    const rateLimiter = new RateLimiter(env);
    const cache = new CacheManager(env);
    const ai = new AIFeatures(env);

    try {
      const url = new URL(request.url);
      
      // Only process API routes
      if (!url.pathname.startsWith('/api')) {
        return new Response('Not Found', { status: 404 });
      }

      // Rate limiting
      const clientIP = request.headers.get('cf-connecting-ip');
      const rateLimitResult = await rateLimiter.checkLimit(clientIP);
      
      if (!rateLimitResult.allowed) {
        return new Response('Rate limit exceeded', { 
          status: 429,
          headers: {
            'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
          }
        });
      }

      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Cache check for GET requests
      let response;
      if (request.method === 'GET' && cache.isCacheable(url.pathname)) {
        const cacheKey = cache.generateKey(url.pathname, request.method);
        const cached = await cache.get(cacheKey);
        
        if (cached) {
          return new Response(cached, {
            headers: { ...corsHeaders, 'X-Cache': 'HIT' }
          });
        }
      }

      // Determine backend URL
      const backendUrl = CONFIG.BACKEND_URLS.production;
      const targetUrl = `${backendUrl}${url.pathname}${url.search}`;

      // Forward request to backend
      const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

      // Add proxy headers
      modifiedRequest.headers.set('X-Forwarded-For', clientIP);
      modifiedRequest.headers.set('X-Real-IP', clientIP);
      modifiedRequest.headers.set('X-Forwarded-Proto', url.protocol);

      // Make request to backend
      response = await fetch(modifiedRequest);

      // Cache successful GET responses
      if (request.method === 'GET' && response.ok && cache.isCacheable(url.pathname)) {
        const cacheKey = cache.generateKey(url.pathname, request.method);
        const responseClone = response.clone();
        const responseText = await responseClone.text();
        await cache.set(cacheKey, responseText);
      }

      // Add response headers
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers),
          ...corsHeaders,
          'X-RateLimit-Remaining': rateLimitResult.remaining?.toString() || 'unknown',
          'X-Cache': 'MISS'
        }
      });

      // Analytics logging
      const duration = Date.now() - startTime;
      ctx.waitUntil(analytics.logRequest(request, response, duration));

      // AI anomaly detection
      const isAnomaly = await ai.detectAnomaly(request, response);
      if (isAnomaly) {
        console.warn('Anomaly detected:', {
          url: url.pathname,
          status: response.status,
          duration
        });
      }

      return modifiedResponse;

    } catch (error) {
      console.error('Worker error:', error);
      
      // Log error to analytics
      const duration = Date.now() - startTime;
      ctx.waitUntil(analytics.logRequest(request, 
        new Response('Internal Server Error', { status: 500 }), duration));

      return new Response('Internal Server Error', { 
        status: 500,
        headers: corsHeaders
      });
    }
  }
};