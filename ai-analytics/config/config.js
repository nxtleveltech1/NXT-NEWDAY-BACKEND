require('dotenv').config();

const config = {
  // Server configuration
  server: {
    port: process.env.ANALYTICS_PORT || 4000,
    host: process.env.ANALYTICS_HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true
    }
  },

  // Database configuration
  database: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      keyPrefix: process.env.REDIS_PREFIX || 'analytics:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    },
    mongodb: {
      url: process.env.MONGODB_URL || 'mongodb://localhost:27017/analytics',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }
    }
  },

  // Analytics engine configuration
  analytics: {
    processing: {
      batchSize: parseInt(process.env.ANALYTICS_BATCH_SIZE) || 100,
      processingInterval: parseInt(process.env.ANALYTICS_INTERVAL) || 5000,
      maxConcurrentJobs: parseInt(process.env.ANALYTICS_MAX_JOBS) || 5,
      retryAttempts: parseInt(process.env.ANALYTICS_RETRY_ATTEMPTS) || 3,
      retryDelay: parseInt(process.env.ANALYTICS_RETRY_DELAY) || 1000
    },
    cache: {
      resultTTL: parseInt(process.env.ANALYTICS_CACHE_TTL) || 3600, // 1 hour
      predictionTTL: parseInt(process.env.PREDICTION_CACHE_TTL) || 1800, // 30 minutes
      metricsTTL: parseInt(process.env.METRICS_CACHE_TTL) || 300, // 5 minutes
      enabled: process.env.ANALYTICS_CACHE_ENABLED !== 'false'
    },
    alerts: {
      enabled: process.env.ANALYTICS_ALERTS_ENABLED !== 'false',
      thresholds: {
        errorRate: parseFloat(process.env.ALERT_ERROR_RATE) || 0.05,
        responseTime: parseInt(process.env.ALERT_RESPONSE_TIME) || 2000,
        memoryUsage: parseFloat(process.env.ALERT_MEMORY_USAGE) || 0.8,
        cpuUsage: parseFloat(process.env.ALERT_CPU_USAGE) || 0.8
      }
    }
  },

  // Machine Learning configuration
  ml: {
    models: {
      directory: process.env.ML_MODELS_DIR || './models',
      autoLoad: process.env.ML_AUTO_LOAD !== 'false',
      retraining: {
        enabled: process.env.ML_RETRAINING_ENABLED !== 'false',
        interval: parseInt(process.env.ML_RETRAINING_INTERVAL) || 86400000, // 24 hours
        minAccuracy: parseFloat(process.env.ML_MIN_ACCURACY) || 0.8
      }
    },
    tensorflow: {
      backend: process.env.TF_BACKEND || 'tensorflow',
      enableGPU: process.env.TF_ENABLE_GPU === 'true',
      memoryGrowth: process.env.TF_MEMORY_GROWTH !== 'false'
    },
    brain: {
      defaultOptions: {
        hiddenLayers: [3],
        activation: 'sigmoid',
        learningRate: 0.3,
        iterations: 20000,
        errorThresh: 0.005
      }
    }
  },

  // Plugin system configuration
  plugins: {
    directory: process.env.PLUGINS_DIR || './plugins',
    autoLoad: process.env.PLUGINS_AUTO_LOAD !== 'false',
    enabled: (process.env.PLUGINS_ENABLED || 'user-behavior,performance,predictive').split(','),
    disabled: (process.env.PLUGINS_DISABLED || '').split(',').filter(Boolean),
    config: {
      'user-behavior': {
        sessionTimeout: parseInt(process.env.UB_SESSION_TIMEOUT) || 1800,
        trackingEnabled: process.env.UB_TRACKING_ENABLED !== 'false',
        minSessionDuration: parseInt(process.env.UB_MIN_SESSION_DURATION) || 10
      },
      'performance': {
        samplingRate: parseFloat(process.env.PERF_SAMPLING_RATE) || 1.0,
        metricsRetention: parseInt(process.env.PERF_METRICS_RETENTION) || 604800000, // 7 days
        realTimeEnabled: process.env.PERF_REALTIME_ENABLED !== 'false'
      },
      'predictive': {
        forecastHorizon: parseInt(process.env.PRED_FORECAST_HORIZON) || 24,
        confidenceThreshold: parseFloat(process.env.PRED_CONFIDENCE_THRESHOLD) || 0.7,
        autoRetrain: process.env.PRED_AUTO_RETRAIN !== 'false'
      }
    }
  },

  // WebSocket configuration
  websocket: {
    enabled: process.env.WS_ENABLED !== 'false',
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT) || 60000,
    pingInterval: parseInt(process.env.WS_PING_INTERVAL) || 25000,
    maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 1000,
    rooms: {
      maxSize: parseInt(process.env.WS_ROOM_MAX_SIZE) || 100,
      cleanup: {
        enabled: process.env.WS_ROOM_CLEANUP_ENABLED !== 'false',
        interval: parseInt(process.env.WS_ROOM_CLEANUP_INTERVAL) || 300000 // 5 minutes
      }
    }
  },

  // Security configuration
  security: {
    cors: {
      origin: process.env.CORS_ORIGIN || true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    },
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      standardHeaders: true,
      legacyHeaders: false
    },
    auth: {
      enabled: process.env.AUTH_ENABLED === 'true',
      jwt: {
        secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: process.env.JWT_ISSUER || 'ai-analytics',
        audience: process.env.JWT_AUDIENCE || 'analytics-users'
      },
      apiKey: {
        enabled: process.env.API_KEY_ENABLED === 'true',
        header: process.env.API_KEY_HEADER || 'X-API-Key',
        keys: (process.env.API_KEYS || '').split(',').filter(Boolean)
      }
    }
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    directory: process.env.LOG_DIR || './logs',
    files: {
      combined: 'combined.log',
      error: 'error.log',
      analytics: 'analytics.log',
      access: 'access.log'
    },
    rotation: {
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
    },
    console: {
      enabled: process.env.LOG_CONSOLE_ENABLED !== 'false',
      colorize: process.env.LOG_CONSOLE_COLORIZE !== 'false'
    }
  },

  // Monitoring configuration
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== 'false',
    healthCheck: {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000, // 5 seconds
      endpoints: (process.env.HEALTH_CHECK_ENDPOINTS || '/health').split(',')
    },
    metrics: {
      enabled: process.env.METRICS_ENABLED !== 'false',
      collectDefault: process.env.METRICS_COLLECT_DEFAULT !== 'false',
      prefix: process.env.METRICS_PREFIX || 'analytics_',
      labels: {
        service: 'ai-analytics',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      }
    },
    alerts: {
      enabled: process.env.ALERTS_ENABLED !== 'false',
      channels: {
        webhook: process.env.ALERT_WEBHOOK_URL || undefined,
        email: process.env.ALERT_EMAIL_ENABLED === 'true',
        slack: process.env.ALERT_SLACK_ENABLED === 'true'
      }
    }
  },

  // Development configuration
  development: {
    debug: process.env.DEBUG === 'analytics:*',
    mockData: process.env.MOCK_DATA_ENABLED === 'true',
    hotReload: process.env.HOT_RELOAD_ENABLED === 'true',
    profiling: process.env.PROFILING_ENABLED === 'true'
  },

  // Production configuration
  production: {
    cluster: {
      enabled: process.env.CLUSTER_ENABLED === 'true',
      workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length,
      restartDelay: parseInt(process.env.CLUSTER_RESTART_DELAY) || 5000
    },
    compression: {
      enabled: process.env.COMPRESSION_ENABLED !== 'false',
      threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 1024,
      level: parseInt(process.env.COMPRESSION_LEVEL) || 6
    },
    ssl: {
      enabled: process.env.SSL_ENABLED === 'true',
      key: process.env.SSL_KEY_PATH || './ssl/private.key',
      cert: process.env.SSL_CERT_PATH || './ssl/certificate.crt',
      ca: process.env.SSL_CA_PATH || undefined
    }
  },

  // Integration configuration
  integrations: {
    mainBackend: {
      url: process.env.MAIN_BACKEND_URL || 'http://localhost:5000',
      apiKey: process.env.MAIN_BACKEND_API_KEY || undefined,
      timeout: parseInt(process.env.MAIN_BACKEND_TIMEOUT) || 10000
    },
    kafka: {
      enabled: process.env.KAFKA_ENABLED === 'true',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'ai-analytics',
      topics: {
        analytics: process.env.KAFKA_ANALYTICS_TOPIC || 'analytics',
        insights: process.env.KAFKA_INSIGHTS_TOPIC || 'insights',
        alerts: process.env.KAFKA_ALERTS_TOPIC || 'alerts'
      }
    },
    elasticsearch: {
      enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
      auth: {
        username: process.env.ELASTICSEARCH_USERNAME || undefined,
        password: process.env.ELASTICSEARCH_PASSWORD || undefined
      },
      indices: {
        analytics: process.env.ES_ANALYTICS_INDEX || 'analytics',
        logs: process.env.ES_LOGS_INDEX || 'logs'
      }
    }
  }
};

// Environment-specific overrides
if (config.server.environment === 'test') {
  config.database.redis.db = 15; // Use different Redis DB for tests
  config.logging.level = 'error'; // Reduce logging in tests
  config.analytics.processing.processingInterval = 100; // Faster processing in tests
}

if (config.server.environment === 'production') {
  config.security.auth.enabled = true; // Force auth in production
  config.logging.console.enabled = false; // Disable console logging in production
  config.development.mockData = false; // Disable mock data in production
}

// Validation
const validateConfig = () => {
  const errors = [];

  // Validate required environment variables in production
  if (config.server.environment === 'production') {
    const required = ['JWT_SECRET', 'REDIS_HOST', 'MONGODB_URL'];
    for (const env of required) {
      if (!process.env[env]) {
        errors.push(`Missing required environment variable: ${env}`);
      }
    }
  }

  // Validate numeric values
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('Invalid server port');
  }

  if (config.analytics.processing.batchSize < 1) {
    errors.push('Analytics batch size must be at least 1');
  }

  // Validate ML configuration
  if (!['tensorflow', 'brain'].includes(config.ml.tensorflow.backend)) {
    errors.push('Invalid ML backend');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

// Validate configuration on load
validateConfig();

module.exports = config;