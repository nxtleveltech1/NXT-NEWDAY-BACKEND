const winston = require('winston');
const path = require('path');

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(logColors);

// Create log directory
const logDir = path.join(__dirname, '../../logs');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Define console format
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'ai-analytics',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    }),

    // File transport for error logs only
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    }),

    // File transport for analytics-specific logs
    new winston.transports.File({
      filename: path.join(logDir, 'analytics.log'),
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      handleExceptions: true,
      handleRejections: true
    })
  ],

  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      format: logFormat
    })
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      format: logFormat
    })
  ]
});

// Add HTTP request logging in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'access.log'),
    level: 'http',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    maxsize: 10485760, // 10MB
    maxFiles: 10
  }));
}

// Create child logger method
logger.child = (defaultMeta) => {
  return winston.createLogger({
    levels: logLevels,
    level: logger.level,
    format: logFormat,
    defaultMeta: {
      ...logger.defaultMeta,
      ...defaultMeta
    },
    transports: logger.transports
  });
};

// Add performance logging helpers
logger.performance = {
  start: (label) => {
    const startTime = process.hrtime.bigint();
    return {
      end: () => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        logger.debug(`Performance: ${label}`, { duration: `${duration.toFixed(2)}ms` });
        return duration;
      }
    };
  },

  measure: async (label, fn) => {
    const timer = logger.performance.start(label);
    try {
      const result = await fn();
      timer.end();
      return result;
    } catch (error) {
      timer.end();
      logger.error(`Performance measurement failed for ${label}:`, error);
      throw error;
    }
  }
};

// Add analytics-specific logging methods
logger.analytics = {
  processed: (data) => {
    logger.info('Analytics data processed', {
      type: data.type,
      analysisId: data.analysisId,
      processingTime: data.processingTime,
      dataPoints: data.dataPoints,
      insights: data.insights?.length || 0
    });
  },

  prediction: (data) => {
    logger.info('Prediction generated', {
      type: data.type,
      confidence: data.confidence,
      processingTime: data.processingTime,
      model: data.model
    });
  },

  insight: (insight) => {
    logger.info('Insight generated', {
      type: insight.type,
      category: insight.category,
      severity: insight.severity,
      message: insight.message
    });
  },

  alert: (alert) => {
    logger.warn('Alert triggered', {
      type: alert.type,
      category: alert.category,
      message: alert.message,
      severity: alert.severity
    });
  },

  modelTrained: (modelName, metrics) => {
    logger.info('Model training completed', {
      model: modelName,
      ...metrics
    });
  },

  pluginLoaded: (pluginName, manifest) => {
    logger.info('Plugin loaded', {
      plugin: pluginName,
      version: manifest.version,
      type: manifest.type
    });
  },

  websocketConnection: (clientId, event, data = {}) => {
    logger.info(`WebSocket ${event}`, {
      clientId,
      ...data
    });
  }
};

// Add memory usage logging
logger.memory = () => {
  const usage = process.memoryUsage();
  logger.debug('Memory usage', {
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(usage.external / 1024 / 1024)}MB`
  });
};

// Add request logging helper
logger.request = (req, res, responseTime) => {
  logger.http('HTTP Request', {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length') || 0
  });
};

// Add error context helper
logger.errorWithContext = (message, error, context = {}) => {
  logger.error(message, {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    context
  });
};

// Add database query logging
logger.query = (query, duration, results) => {
  logger.debug('Database query', {
    query: query.slice(0, 200) + (query.length > 200 ? '...' : ''),
    duration: `${duration}ms`,
    results: Array.isArray(results) ? results.length : 1
  });
};

// Add API response logging
logger.apiResponse = (endpoint, statusCode, responseTime, data = {}) => {
  logger.info('API Response', {
    endpoint,
    statusCode,
    responseTime: `${responseTime}ms`,
    ...data
  });
};

// Add plugin-specific logging
logger.plugin = (pluginName) => {
  return logger.child({ plugin: pluginName });
};

// Add model-specific logging
logger.model = (modelName) => {
  return logger.child({ model: modelName });
};

// Add graceful shutdown logging
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
});

// Ensure log directory exists
const fs = require('fs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

module.exports = logger;