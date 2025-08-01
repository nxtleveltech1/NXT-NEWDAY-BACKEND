const Joi = require('joi');
const moment = require('moment');
const _ = require('lodash');
const logger = require('./logger');

class DataProcessor {
  constructor() {
    this.validationSchemas = this.setupValidationSchemas();
    this.preprocessors = this.setupPreprocessors();
    this.processors = this.setupProcessors();
    this.normalizers = this.setupNormalizers();
  }

  /**
   * Validate input data based on type
   * @param {any} data - Data to validate
   * @param {string} type - Data type
   */
  validate(data, type = 'general') {
    try {
      const schema = this.validationSchemas[type] || this.validationSchemas.general;
      const { error, value } = schema.validate(data, { 
        allowUnknown: true,
        stripUnknown: true 
      });

      if (error) {
        throw new Error(`Validation failed for ${type}: ${error.details.map(d => d.message).join(', ')}`);
      }

      logger.debug('Data validation successful', { type, dataSize: this.getDataSize(value) });
      return value;

    } catch (error) {
      logger.error('Data validation error:', error);
      throw error;
    }
  }

  /**
   * Preprocess data based on type
   * @param {any} data - Data to preprocess
   * @param {string} type - Data type
   */
  async preprocess(data, type = 'general') {
    try {
      logger.debug('Starting data preprocessing', { type, dataSize: this.getDataSize(data) });

      const preprocessor = this.preprocessors[type] || this.preprocessors.general;
      const processedData = await preprocessor(data);

      logger.debug('Data preprocessing completed', { 
        type, 
        originalSize: this.getDataSize(data),
        processedSize: this.getDataSize(processedData)
      });

      return processedData;

    } catch (error) {
      logger.error('Data preprocessing error:', error);
      throw error;
    }
  }

  /**
   * Process data for specific analysis type
   * @param {any} data - Data to process
   * @param {string} type - Processing type
   */
  async process(data, type = 'general') {
    try {
      logger.debug('Starting data processing', { type, dataSize: this.getDataSize(data) });

      const processor = this.processors[type] || this.processors.general;
      const result = await processor(data);

      logger.debug('Data processing completed', { 
        type, 
        inputSize: this.getDataSize(data),
        outputSize: this.getDataSize(result)
      });

      return result;

    } catch (error) {
      logger.error('Data processing error:', error);
      throw error;
    }
  }

  /**
   * Normalize data for ML models
   * @param {any} data - Data to normalize
   * @param {string} method - Normalization method
   */
  normalize(data, method = 'minmax') {
    try {
      logger.debug('Starting data normalization', { method, dataSize: this.getDataSize(data) });

      const normalizer = this.normalizers[method] || this.normalizers.minmax;
      const normalizedData = normalizer(data);

      logger.debug('Data normalization completed', { 
        method, 
        originalSize: this.getDataSize(data),
        normalizedSize: this.getDataSize(normalizedData)
      });

      return normalizedData;

    } catch (error) {
      logger.error('Data normalization error:', error);
      throw error;
    }
  }

  /**
   * Setup validation schemas for different data types
   */
  setupValidationSchemas() {
    return {
      general: Joi.alternatives().try(
        Joi.array().items(Joi.object()),
        Joi.object(),
        Joi.array().items(Joi.number()),
        Joi.number()
      ),

      'user-behavior': Joi.object({
        sessions: Joi.array().items(
          Joi.object({
            sessionId: Joi.string().required(),
            userId: Joi.string().required(),
            startTime: Joi.date().required(),
            endTime: Joi.date().optional(),
            events: Joi.array().items(
              Joi.object({
                type: Joi.string().required(),
                timestamp: Joi.date().required(),
                data: Joi.object().optional()
              })
            ).optional()
          })
        ).optional(),
        events: Joi.array().items(
          Joi.object({
            type: Joi.string().required(),
            userId: Joi.string().optional(),
            sessionId: Joi.string().optional(),
            timestamp: Joi.date().required(),
            data: Joi.object().optional()
          })
        ).optional(),
        flows: Joi.array().items(
          Joi.object({
            flowId: Joi.string().required(),
            userId: Joi.string().required(),
            steps: Joi.array().items(
              Joi.object({
                name: Joi.string().required(),
                timestamp: Joi.date().required(),
                completed: Joi.boolean().default(false)
              })
            ).required()
          })
        ).optional()
      }),

      performance: Joi.object({
        metrics: Joi.array().items(
          Joi.object({
            timestamp: Joi.date().required(),
            responseTime: Joi.number().positive().optional(),
            throughput: Joi.number().positive().optional(),
            errorRate: Joi.number().min(0).max(1).optional(),
            cpuUsage: Joi.number().min(0).max(1).optional(),
            memoryUsage: Joi.number().min(0).max(1).optional(),
            endpoint: Joi.string().optional(),
            statusCode: Joi.number().integer().optional()
          })
        ).required()
      }),

      predictive: Joi.object({
        timeSeries: Joi.array().items(
          Joi.object({
            timestamp: Joi.date().required(),
            value: Joi.number().required(),
            category: Joi.string().optional()
          })
        ).optional(),
        features: Joi.array().items(Joi.number()).optional(),
        target: Joi.alternatives().try(
          Joi.number(),
          Joi.array().items(Joi.number())
        ).optional(),
        historical: Joi.array().items(
          Joi.object({
            input: Joi.array().items(Joi.number()).required(),
            output: Joi.alternatives().try(
              Joi.number(),
              Joi.array().items(Joi.number())
            ).required()
          })
        ).optional()
      }),

      anomaly: Joi.object({
        data: Joi.array().items(
          Joi.object({
            timestamp: Joi.date().required(),
            values: Joi.array().items(Joi.number()).required(),
            metadata: Joi.object().optional()
          })
        ).required(),
        baseline: Joi.object({
          mean: Joi.array().items(Joi.number()).optional(),
          std: Joi.array().items(Joi.number()).optional(),
          threshold: Joi.number().positive().default(2.0)
        }).optional()
      }),

      clustering: Joi.object({
        data: Joi.array().items(
          Joi.object({
            id: Joi.string().required(),
            features: Joi.array().items(Joi.number()).required(),
            metadata: Joi.object().optional()
          })
        ).required(),
        config: Joi.object({
          k: Joi.number().integer().positive().optional(),
          method: Joi.string().valid('kmeans', 'hierarchical', 'dbscan').default('kmeans'),
          distance: Joi.string().valid('euclidean', 'cosine', 'manhattan').default('euclidean')
        }).optional()
      }),

      'time-series': Joi.object({
        data: Joi.array().items(
          Joi.object({
            timestamp: Joi.date().required(),
            value: Joi.number().required(),
            category: Joi.string().optional()
          })
        ).required(),
        config: Joi.object({
          seasonality: Joi.string().valid('daily', 'weekly', 'monthly', 'yearly').optional(),
          trend: Joi.boolean().default(true),
          forecastPeriods: Joi.number().integer().positive().default(24)
        }).optional()
      })
    };
  }

  /**
   * Setup preprocessors for different data types
   */
  setupPreprocessors() {
    return {
      general: async (data) => {
        return this.generalPreprocessing(data);
      },

      'user-behavior': async (data) => {
        return this.userBehaviorPreprocessing(data);
      },

      performance: async (data) => {
        return this.performancePreprocessing(data);
      },

      predictive: async (data) => {
        return this.predictivePreprocessing(data);
      },

      anomaly: async (data) => {
        return this.anomalyPreprocessing(data);
      },

      clustering: async (data) => {
        return this.clusteringPreprocessing(data);
      },

      'time-series': async (data) => {
        return this.timeSeriesPreprocessing(data);
      }
    };
  }

  /**
   * Setup processors for different analysis types
   */
  setupProcessors() {
    return {
      general: async (data) => {
        return this.generalProcessing(data);
      },

      'user-behavior': async (data) => {
        return this.userBehaviorProcessing(data);
      },

      performance: async (data) => {
        return this.performanceProcessing(data);
      },

      predictive: async (data) => {
        return this.predictiveProcessing(data);
      },

      anomaly: async (data) => {
        return this.anomalyProcessing(data);
      },

      clustering: async (data) => {
        return this.clusteringProcessing(data);
      },

      'time-series': async (data) => {
        return this.timeSeriesProcessing(data);
      }
    };
  }

  /**
   * Setup normalizers
   */
  setupNormalizers() {
    return {
      minmax: (data) => this.minMaxNormalization(data),
      zscore: (data) => this.zScoreNormalization(data),
      robust: (data) => this.robustNormalization(data),
      unit: (data) => this.unitVectorNormalization(data)
    };
  }

  // Preprocessing methods

  /**
   * General data preprocessing
   */
  generalPreprocessing(data) {
    if (!data) return data;

    // Handle different data types
    if (Array.isArray(data)) {
      return data.map(item => this.cleanDataItem(item));
    } else if (typeof data === 'object') {
      return this.cleanDataItem(data);
    }

    return data;
  }

  /**
   * User behavior data preprocessing
   */
  userBehaviorPreprocessing(data) {
    const processed = { ...data };

    // Process sessions
    if (processed.sessions) {
      processed.sessions = processed.sessions.map(session => ({
        ...session,
        startTime: moment(session.startTime).toDate(),
        endTime: session.endTime ? moment(session.endTime).toDate() : null,
        events: session.events ? session.events.map(event => ({
          ...event,
          timestamp: moment(event.timestamp).toDate()
        })) : []
      }));
    }

    // Process events
    if (processed.events) {
      processed.events = processed.events.map(event => ({
        ...event,
        timestamp: moment(event.timestamp).toDate()
      }));
    }

    // Process flows
    if (processed.flows) {
      processed.flows = processed.flows.map(flow => ({
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          timestamp: moment(step.timestamp).toDate()
        }))
      }));
    }

    return processed;
  }

  /**
   * Performance data preprocessing
   */
  performancePreprocessing(data) {
    const processed = { ...data };

    if (processed.metrics) {
      processed.metrics = processed.metrics
        .map(metric => ({
          ...metric,
          timestamp: moment(metric.timestamp).toDate()
        }))
        .filter(metric => this.isValidMetric(metric))
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    return processed;
  }

  /**
   * Predictive data preprocessing
   */
  predictivePreprocessing(data) {
    const processed = { ...data };

    // Process time series data
    if (processed.timeSeries) {
      processed.timeSeries = processed.timeSeries
        .map(point => ({
          ...point,
          timestamp: moment(point.timestamp).toDate()
        }))
        .filter(point => !isNaN(point.value))
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    // Process historical data
    if (processed.historical) {
      processed.historical = processed.historical
        .filter(item => item.input && item.output)
        .map(item => ({
          input: this.cleanNumericArray(item.input),
          output: Array.isArray(item.output) ? 
            this.cleanNumericArray(item.output) : 
            this.cleanNumericValue(item.output)
        }));
    }

    return processed;
  }

  /**
   * Anomaly detection data preprocessing
   */
  anomalyPreprocessing(data) {
    const processed = { ...data };

    if (processed.data) {
      processed.data = processed.data
        .map(point => ({
          ...point,
          timestamp: moment(point.timestamp).toDate(),
          values: this.cleanNumericArray(point.values)
        }))
        .filter(point => point.values.length > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    return processed;
  }

  /**
   * Clustering data preprocessing
   */
  clusteringPreprocessing(data) {
    const processed = { ...data };

    if (processed.data) {
      processed.data = processed.data
        .map(point => ({
          ...point,
          features: this.cleanNumericArray(point.features)
        }))
        .filter(point => point.features.length > 0);
    }

    return processed;
  }

  /**
   * Time series data preprocessing
   */
  timeSeriesPreprocessing(data) {
    const processed = { ...data };

    if (processed.data) {
      processed.data = processed.data
        .map(point => ({
          ...point,
          timestamp: moment(point.timestamp).toDate()
        }))
        .filter(point => !isNaN(point.value))
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    return processed;
  }

  // Processing methods (placeholder implementations)

  generalProcessing(data) {
    return data;
  }

  userBehaviorProcessing(data) {
    return data;
  }

  performanceProcessing(data) {
    return data;
  }

  predictiveProcessing(data) {
    return data;
  }

  anomalyProcessing(data) {
    return data;
  }

  clusteringProcessing(data) {
    return data;
  }

  timeSeriesProcessing(data) {
    return data;
  }

  // Normalization methods

  /**
   * Min-max normalization
   */
  minMaxNormalization(data) {
    if (!Array.isArray(data)) return data;

    const numbers = data.filter(x => typeof x === 'number' && !isNaN(x));
    if (numbers.length === 0) return data;

    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const range = max - min;

    if (range === 0) return data.map(x => typeof x === 'number' ? 0 : x);

    return data.map(x => typeof x === 'number' && !isNaN(x) ? (x - min) / range : x);
  }

  /**
   * Z-score normalization
   */
  zScoreNormalization(data) {
    if (!Array.isArray(data)) return data;

    const numbers = data.filter(x => typeof x === 'number' && !isNaN(x));
    if (numbers.length === 0) return data;

    const mean = numbers.reduce((sum, x) => sum + x, 0) / numbers.length;
    const variance = numbers.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / numbers.length;
    const std = Math.sqrt(variance);

    if (std === 0) return data.map(x => typeof x === 'number' ? 0 : x);

    return data.map(x => typeof x === 'number' && !isNaN(x) ? (x - mean) / std : x);
  }

  /**
   * Robust normalization (using median and IQR)
   */
  robustNormalization(data) {
    if (!Array.isArray(data)) return data;

    const numbers = data.filter(x => typeof x === 'number' && !isNaN(x)).sort((a, b) => a - b);
    if (numbers.length === 0) return data;

    const q1Index = Math.floor(numbers.length * 0.25);
    const q3Index = Math.floor(numbers.length * 0.75);
    const medianIndex = Math.floor(numbers.length * 0.5);

    const q1 = numbers[q1Index];
    const q3 = numbers[q3Index];
    const median = numbers[medianIndex];
    const iqr = q3 - q1;

    if (iqr === 0) return data.map(x => typeof x === 'number' ? 0 : x);

    return data.map(x => typeof x === 'number' && !isNaN(x) ? (x - median) / iqr : x);
  }

  /**
   * Unit vector normalization
   */
  unitVectorNormalization(data) {
    if (!Array.isArray(data)) return data;

    const numbers = data.filter(x => typeof x === 'number' && !isNaN(x));
    if (numbers.length === 0) return data;

    const magnitude = Math.sqrt(numbers.reduce((sum, x) => sum + x * x, 0));
    if (magnitude === 0) return data.map(x => typeof x === 'number' ? 0 : x);

    return data.map(x => typeof x === 'number' && !isNaN(x) ? x / magnitude : x);
  }

  // Utility methods

  /**
   * Clean individual data item
   */
  cleanDataItem(item) {
    if (item === null || item === undefined) return null;
    if (typeof item !== 'object') return item;

    const cleaned = {};
    for (const [key, value] of Object.entries(item)) {
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value === 'string' && !isNaN(Date.parse(value)) && key.includes('time')) {
          cleaned[key] = new Date(value);
        } else if (typeof value === 'string' && !isNaN(Number(value))) {
          cleaned[key] = Number(value);
        } else {
          cleaned[key] = value;
        }
      }
    }
    return cleaned;
  }

  /**
   * Clean numeric array
   */
  cleanNumericArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => typeof x === 'number' && !isNaN(x) && isFinite(x));
  }

  /**
   * Clean numeric value
   */
  cleanNumericValue(value) {
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && !isNaN(Number(value))) {
      return Number(value);
    }
    return 0;
  }

  /**
   * Check if metric is valid
   */
  isValidMetric(metric) {
    return metric.timestamp && 
           (metric.responseTime !== undefined || 
            metric.throughput !== undefined || 
            metric.errorRate !== undefined || 
            metric.cpuUsage !== undefined || 
            metric.memoryUsage !== undefined);
  }

  /**
   * Get data size estimate
   */
  getDataSize(data) {
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object') return Object.keys(data).length;
    return 1;
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      availablePreprocessors: Object.keys(this.preprocessors),
      availableProcessors: Object.keys(this.processors),
      availableNormalizers: Object.keys(this.normalizers),
      availableValidators: Object.keys(this.validationSchemas)
    };
  }
}

module.exports = DataProcessor;