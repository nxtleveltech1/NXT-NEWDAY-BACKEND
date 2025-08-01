const tf = require('@tensorflow/tfjs-node');
const brain = require('brain.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ModelManager {
  constructor() {
    this.models = new Map();
    this.modelConfigs = new Map();
    this.modelMetrics = new Map();
    this.modelDirectory = path.join(__dirname, '../../models');
    this.isInitialized = false;
    
    this.setupDefaultConfigs();
  }

  /**
   * Initialize model manager and load models
   */
  async initialize() {
    try {
      logger.info('Initializing Model Manager...');
      
      // Ensure model directory exists
      await this.ensureModelDirectory();
      
      // Load available models
      await this.loadAvailableModels();
      
      // Initialize default models if none exist
      if (this.models.size === 0) {
        await this.initializeDefaultModels();
      }
      
      this.isInitialized = true;
      logger.info(`Model Manager initialized with ${this.models.size} models`);
      
    } catch (error) {
      logger.error('Failed to initialize Model Manager:', error);
      throw error;
    }
  }

  /**
   * Load all available models from directory
   */
  async loadAvailableModels() {
    try {
      const modelDirs = await this.getModelDirectories();
      
      for (const modelDir of modelDirs) {
        try {
          await this.loadModel(modelDir);
        } catch (error) {
          logger.warn(`Failed to load model ${modelDir}:`, error.message);
        }
      }
      
    } catch (error) {
      logger.error('Error loading available models:', error);
    }
  }

  /**
   * Load a specific model
   * @param {string} modelName - Name of the model to load
   */
  async loadModel(modelName) {
    try {
      const modelPath = path.join(this.modelDirectory, modelName);
      
      // Check if model directory exists
      try {
        await fs.access(modelPath);
      } catch {
        throw new Error(`Model directory not found: ${modelPath}`);
      }

      // Load model configuration
      const configPath = path.join(modelPath, 'config.json');
      let config;
      
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(configData);
      } catch {
        // Use default config if none found
        config = this.getDefaultConfig(modelName);
        await this.saveModelConfig(modelName, config);
      }

      // Load model based on type
      let model;
      switch (config.type) {
        case 'tensorflow':
          model = await this.loadTensorFlowModel(modelPath, config);
          break;
        case 'brain':
          model = await this.loadBrainJSModel(modelPath, config);
          break;
        case 'custom':
          model = await this.loadCustomModel(modelPath, config);
          break;
        default:
          throw new Error(`Unknown model type: ${config.type}`);
      }

      // Wrap model with common interface
      const wrappedModel = this.wrapModel(model, config);
      
      // Store model and config
      this.models.set(modelName, wrappedModel);
      this.modelConfigs.set(modelName, config);
      
      // Initialize metrics
      this.modelMetrics.set(modelName, {
        loadedAt: new Date(),
        predictions: 0,
        accuracy: 0,
        lastUsed: null,
        errors: 0
      });

      logger.info(`Model loaded successfully: ${modelName}`, {
        type: config.type,
        version: config.version
      });

      return wrappedModel;

    } catch (error) {
      logger.error(`Failed to load model ${modelName}:`, error);
      throw error;
    }
  }

  /**
   * Load TensorFlow model
   * @param {string} modelPath - Path to model directory
   * @param {Object} config - Model configuration
   */
  async loadTensorFlowModel(modelPath, config) {
    try {
      const modelFilePath = path.join(modelPath, 'model.json');
      
      // Check if model file exists
      try {
        await fs.access(modelFilePath);
        // Load existing model
        return await tf.loadLayersModel(`file://${modelFilePath}`);
      } catch {
        // Create new model if none exists
        return this.createTensorFlowModel(config);
      }
      
    } catch (error) {
      logger.error('Error loading TensorFlow model:', error);
      throw error;
    }
  }

  /**
   * Load Brain.js model
   * @param {string} modelPath - Path to model directory
   * @param {Object} config - Model configuration
   */
  async loadBrainJSModel(modelPath, config) {
    try {
      const modelFilePath = path.join(modelPath, 'model.json');
      
      try {
        const modelData = await fs.readFile(modelFilePath, 'utf8');
        const savedModel = JSON.parse(modelData);
        
        // Create network based on config
        const network = this.createBrainJSNetwork(config);
        
        // Load weights if available
        if (savedModel.weights) {
          network.fromJSON(savedModel);
        }
        
        return network;
        
      } catch {
        // Create new model if none exists
        return this.createBrainJSNetwork(config);
      }
      
    } catch (error) {
      logger.error('Error loading Brain.js model:', error);
      throw error;
    }
  }

  /**
   * Load custom model
   * @param {string} modelPath - Path to model directory
   * @param {Object} config - Model configuration
   */
  async loadCustomModel(modelPath, config) {
    try {
      const modelFilePath = path.join(modelPath, 'model.js');
      
      // Dynamically import custom model
      const ModelClass = require(modelFilePath);
      return new ModelClass(config);
      
    } catch (error) {
      logger.error('Error loading custom model:', error);
      throw error;
    }
  }

  /**
   * Create TensorFlow model
   * @param {Object} config - Model configuration
   */
  createTensorFlowModel(config) {
    const model = tf.sequential();
    
    // Add layers based on config
    config.layers.forEach((layerConfig, index) => {
      const layer = this.createTensorFlowLayer(layerConfig, index === 0);
      model.add(layer);
    });

    // Compile model
    model.compile({
      optimizer: config.optimizer || 'adam',
      loss: config.loss || 'meanSquaredError',
      metrics: config.metrics || ['accuracy']
    });

    return model;
  }

  /**
   * Create TensorFlow layer
   * @param {Object} layerConfig - Layer configuration
   * @param {boolean} isFirst - Whether this is the first layer
   */
  createTensorFlowLayer(layerConfig, isFirst) {
    const { type, units, activation, inputShape } = layerConfig;
    
    const layerOptions = {
      units,
      activation: activation || 'relu'
    };
    
    if (isFirst && inputShape) {
      layerOptions.inputShape = inputShape;
    }
    
    switch (type) {
      case 'dense':
        return tf.layers.dense(layerOptions);
      case 'lstm':
        return tf.layers.lstm(layerOptions);
      case 'gru':
        return tf.layers.gru(layerOptions);
      case 'conv1d':
        return tf.layers.conv1d(layerOptions);
      case 'dropout':
        return tf.layers.dropout({ rate: layerConfig.rate || 0.2 });
      default:
        return tf.layers.dense(layerOptions);
    }
  }

  /**
   * Create Brain.js network
   * @param {Object} config - Model configuration
   */
  createBrainJSNetwork(config) {
    const { networkType = 'NeuralNetwork', options = {} } = config;
    
    switch (networkType) {
      case 'NeuralNetwork':
        return new brain.NeuralNetwork(options);
      case 'recurrent':
        return new brain.recurrent.LSTM(options);
      case 'FeedForward':
        return new brain.FeedForward(options);
      default:
        return new brain.NeuralNetwork(options);
    }
  }

  /**
   * Wrap model with common interface
   * @param {Object} model - Raw model instance
   * @param {Object} config - Model configuration
   */
  wrapModel(model, config) {
    return {
      model,
      config,
      predict: async (input) => {
        return this.predict(model, input, config);
      },
      train: async (data) => {
        return this.train(model, data, config);
      },
      evaluate: async (testData) => {
        return this.evaluate(model, testData, config);
      },
      save: async (modelName) => {
        return this.saveModel(modelName, model, config);
      },
      getMetrics: () => {
        return this.modelMetrics.get(config.name) || {};
      }
    };
  }

  /**
   * Make prediction with model
   * @param {Object} model - Model instance
   * @param {Array} input - Input data
   * @param {Object} config - Model configuration
   */
  async predict(model, input, config) {
    try {
      const startTime = Date.now();
      let prediction;

      switch (config.type) {
        case 'tensorflow':
          prediction = await this.predictTensorFlow(model, input, config);
          break;
        case 'brain':
          prediction = this.predictBrainJS(model, input, config);
          break;
        case 'custom':
          prediction = await model.predict(input);
          break;
        default:
          throw new Error(`Unknown model type: ${config.type}`);
      }

      // Update metrics
      const metrics = this.modelMetrics.get(config.name);
      if (metrics) {
        metrics.predictions++;
        metrics.lastUsed = new Date();
      }

      const processingTime = Date.now() - startTime;
      
      logger.debug(`Prediction made with model: ${config.name}`, {
        processingTime,
        inputShape: Array.isArray(input) ? input.length : 'scalar'
      });

      return {
        prediction,
        confidence: this.calculateConfidence(prediction, config),
        processingTime,
        timestamp: new Date()
      };

    } catch (error) {
      // Update error metrics
      const metrics = this.modelMetrics.get(config.name);
      if (metrics) {
        metrics.errors++;
      }

      logger.error(`Prediction error with model ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * TensorFlow prediction
   * @param {Object} model - TensorFlow model
   * @param {Array} input - Input data
   * @param {Object} config - Model configuration
   */
  async predictTensorFlow(model, input, config) {
    // Prepare input tensor
    const inputTensor = tf.tensor(input, config.inputShape);
    
    // Make prediction
    const predictionTensor = model.predict(inputTensor);
    
    // Convert to JavaScript array
    const prediction = await predictionTensor.data();
    
    // Cleanup tensors
    inputTensor.dispose();
    predictionTensor.dispose();
    
    return Array.from(prediction);
  }

  /**
   * Brain.js prediction
   * @param {Object} model - Brain.js model
   * @param {Array} input - Input data
   * @param {Object} config - Model configuration
   */
  predictBrainJS(model, input, config) {
    return model.run(input);
  }

  /**
   * Train model
   * @param {Object} model - Model instance
   * @param {Array} data - Training data
   * @param {Object} config - Model configuration
   */
  async train(model, data, config) {
    try {
      logger.info(`Training model: ${config.name}`);
      const startTime = Date.now();

      let trainingResult;
      
      switch (config.type) {
        case 'tensorflow':
          trainingResult = await this.trainTensorFlow(model, data, config);
          break;
        case 'brain':
          trainingResult = this.trainBrainJS(model, data, config);
          break;
        case 'custom':
          trainingResult = await model.train(data);
          break;
        default:
          throw new Error(`Unknown model type: ${config.type}`);
      }

      const trainingTime = Date.now() - startTime;
      
      logger.info(`Model training completed: ${config.name}`, {
        trainingTime,
        dataPoints: data.length
      });

      // Save model after training
      await this.saveModel(config.name, model, config);

      return {
        ...trainingResult,
        trainingTime,
        timestamp: new Date()
      };

    } catch (error) {
      logger.error(`Training error with model ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * Train TensorFlow model
   * @param {Object} model - TensorFlow model
   * @param {Array} data - Training data
   * @param {Object} config - Model configuration
   */
  async trainTensorFlow(model, data, config) {
    // Prepare training data
    const { xs, ys } = this.prepareTensorFlowData(data, config);
    
    // Training configuration
    const trainConfig = {
      epochs: config.epochs || 100,
      validationSplit: config.validationSplit || 0.2,
      batchSize: config.batchSize || 32,
      verbose: 0
    };

    // Train model
    const history = await model.fit(xs, ys, trainConfig);
    
    // Cleanup tensors
    xs.dispose();
    ys.dispose();
    
    return {
      loss: history.history.loss,
      accuracy: history.history.acc || history.history.accuracy,
      epochs: trainConfig.epochs
    };
  }

  /**
   * Train Brain.js model
   * @param {Object} model - Brain.js model
   * @param {Array} data - Training data
   * @param {Object} config - Model configuration
   */
  trainBrainJS(model, data, config) {
    const trainConfig = {
      iterations: config.iterations || 2000,
      errorThresh: config.errorThresh || 0.005,
      log: false,
      logPeriod: 100,
      learningRate: config.learningRate || 0.3
    };

    const stats = model.train(data, trainConfig);
    
    return {
      iterations: stats.iterations,
      error: stats.error,
      learningRate: trainConfig.learningRate
    };
  }

  /**
   * Evaluate model performance
   * @param {Object} model - Model instance
   * @param {Array} testData - Test data
   * @param {Object} config - Model configuration
   */
  async evaluate(model, testData, config) {
    try {
      logger.info(`Evaluating model: ${config.name}`);

      let evaluation;
      
      switch (config.type) {
        case 'tensorflow':
          evaluation = await this.evaluateTensorFlow(model, testData, config);
          break;
        case 'brain':
          evaluation = this.evaluateBrainJS(model, testData, config);
          break;
        case 'custom':
          evaluation = await model.evaluate(testData);
          break;
        default:
          throw new Error(`Unknown model type: ${config.type}`);
      }

      // Update accuracy metric
      const metrics = this.modelMetrics.get(config.name);
      if (metrics) {
        metrics.accuracy = evaluation.accuracy || 0;
      }

      return evaluation;

    } catch (error) {
      logger.error(`Evaluation error with model ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * Save model to disk
   * @param {string} modelName - Model name
   * @param {Object} model - Model instance
   * @param {Object} config - Model configuration
   */
  async saveModel(modelName, model, config) {
    try {
      const modelPath = path.join(this.modelDirectory, modelName);
      
      // Ensure model directory exists
      await fs.mkdir(modelPath, { recursive: true });
      
      // Save model based on type
      switch (config.type) {
        case 'tensorflow':
          await this.saveTensorFlowModel(model, modelPath);
          break;
        case 'brain':
          await this.saveBrainJSModel(model, modelPath);
          break;
        case 'custom':
          await model.save(modelPath);
          break;
      }

      // Save configuration
      await this.saveModelConfig(modelName, config);
      
      logger.info(`Model saved: ${modelName}`);

    } catch (error) {
      logger.error(`Error saving model ${modelName}:`, error);
      throw error;
    }
  }

  /**
   * Save TensorFlow model
   * @param {Object} model - TensorFlow model
   * @param {string} modelPath - Path to save model
   */
  async saveTensorFlowModel(model, modelPath) {
    await model.save(`file://${modelPath}`);
  }

  /**
   * Save Brain.js model
   * @param {Object} model - Brain.js model
   * @param {string} modelPath - Path to save model
   */
  async saveBrainJSModel(model, modelPath) {
    const modelData = model.toJSON();
    const modelFilePath = path.join(modelPath, 'model.json');
    await fs.writeFile(modelFilePath, JSON.stringify(modelData, null, 2));
  }

  /**
   * Save model configuration
   * @param {string} modelName - Model name
   * @param {Object} config - Model configuration
   */
  async saveModelConfig(modelName, config) {
    const modelPath = path.join(this.modelDirectory, modelName);
    const configPath = path.join(modelPath, 'config.json');
    
    await fs.mkdir(modelPath, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Get model by name
   * @param {string} modelName - Model name
   */
  getModel(modelName) {
    return this.models.get(modelName);
  }

  /**
   * Get all loaded models
   */
  getLoadedModels() {
    return Array.from(this.models.keys());
  }

  /**
   * Get model metrics
   * @param {string} modelName - Model name
   */
  getModelMetrics(modelName) {
    return this.modelMetrics.get(modelName);
  }

  /**
   * Get all model metrics
   */
  getAllMetrics() {
    const allMetrics = {};
    
    for (const [modelName, metrics] of this.modelMetrics.entries()) {
      allMetrics[modelName] = {
        ...metrics,
        config: this.modelConfigs.get(modelName)
      };
    }
    
    return allMetrics;
  }

  /**
   * Reload model
   * @param {string} modelName - Model name
   */
  async reloadModel(modelName) {
    try {
      // Unload existing model
      if (this.models.has(modelName)) {
        this.models.delete(modelName);
        this.modelConfigs.delete(modelName);
        this.modelMetrics.delete(modelName);
      }
      
      // Load model again
      await this.loadModel(modelName);
      
      logger.info(`Model reloaded: ${modelName}`);
      
    } catch (error) {
      logger.error(`Error reloading model ${modelName}:`, error);
      throw error;
    }
  }

  /**
   * Check if models need retraining
   */
  async checkForRetraining() {
    for (const [modelName, config] of this.modelConfigs.entries()) {
      const metrics = this.modelMetrics.get(modelName);
      
      if (metrics && this.shouldRetrain(metrics, config)) {
        logger.info(`Model needs retraining: ${modelName}`);
        // Emit event for retraining
        // This would be handled by a training service
      }
    }
  }

  /**
   * Initialize default models
   */
  async initializeDefaultModels() {
    logger.info('Initializing default models...');
    
    const defaultModels = [
      'user-behavior',
      'performance-analysis',
      'anomaly-detection',
      'time-series-forecast',
      'demand-prediction'
    ];

    for (const modelName of defaultModels) {
      try {
        await this.createDefaultModel(modelName);
      } catch (error) {
        logger.warn(`Failed to create default model ${modelName}:`, error.message);
      }
    }
  }

  /**
   * Create default model
   * @param {string} modelName - Model name
   */
  async createDefaultModel(modelName) {
    const config = this.getDefaultConfig(modelName);
    
    // Create model directory
    const modelPath = path.join(this.modelDirectory, modelName);
    await fs.mkdir(modelPath, { recursive: true });
    
    // Save configuration
    await this.saveModelConfig(modelName, config);
    
    // Load the model
    await this.loadModel(modelName);
    
    logger.info(`Default model created: ${modelName}`);
  }

  /**
   * Setup default model configurations
   */
  setupDefaultConfigs() {
    this.defaultConfigs = {
      'user-behavior': {
        name: 'user-behavior',
        type: 'brain',
        networkType: 'NeuralNetwork',
        options: {
          hiddenLayers: [10, 10],
          activation: 'sigmoid'
        },
        version: '1.0.0'
      },
      'performance-analysis': {
        name: 'performance-analysis',
        type: 'tensorflow',
        layers: [
          { type: 'dense', units: 64, activation: 'relu', inputShape: [10] },
          { type: 'dropout', rate: 0.2 },
          { type: 'dense', units: 32, activation: 'relu' },
          { type: 'dense', units: 1, activation: 'linear' }
        ],
        optimizer: 'adam',
        loss: 'meanSquaredError',
        version: '1.0.0'
      },
      'anomaly-detection': {
        name: 'anomaly-detection',
        type: 'tensorflow',
        layers: [
          { type: 'dense', units: 32, activation: 'relu', inputShape: [20] },
          { type: 'dense', units: 16, activation: 'relu' },
          { type: 'dense', units: 8, activation: 'relu' },
          { type: 'dense', units: 16, activation: 'relu' },
          { type: 'dense', units: 20, activation: 'sigmoid' }
        ],
        optimizer: 'adam',
        loss: 'meanSquaredError',
        version: '1.0.0'
      },
      'time-series-forecast': {
        name: 'time-series-forecast',
        type: 'tensorflow',
        layers: [
          { type: 'lstm', units: 50, inputShape: [10, 1] },
          { type: 'dropout', rate: 0.2 },
          { type: 'dense', units: 1 }
        ],
        optimizer: 'adam',
        loss: 'meanSquaredError',
        version: '1.0.0'
      },
      'demand-prediction': {
        name: 'demand-prediction',
        type: 'brain',
        networkType: 'recurrent',
        options: {
          hiddenLayers: [20, 20],
          learningRate: 0.01
        },
        version: '1.0.0'
      }
    };
  }

  /**
   * Get default configuration for model
   * @param {string} modelName - Model name
   */
  getDefaultConfig(modelName) {
    return this.defaultConfigs[modelName] || {
      name: modelName,
      type: 'brain',
      networkType: 'NeuralNetwork',
      options: { hiddenLayers: [10] },
      version: '1.0.0'
    };
  }

  /**
   * Helper methods
   */

  async ensureModelDirectory() {
    await fs.mkdir(this.modelDirectory, { recursive: true });
  }

  async getModelDirectories() {
    try {
      const entries = await fs.readdir(this.modelDirectory, { withFileTypes: true });
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
      return [];
    }
  }

  calculateConfidence(prediction, config) {
    // Simple confidence calculation - would be more sophisticated in practice
    if (Array.isArray(prediction)) {
      const max = Math.max(...prediction);
      const sum = prediction.reduce((a, b) => a + b, 0);
      return max / sum;
    }
    return Math.min(Math.abs(prediction), 1.0);
  }

  prepareTensorFlowData(data, config) {
    // Prepare data for TensorFlow training
    const inputs = data.map(item => item.input);
    const outputs = data.map(item => item.output);
    
    return {
      xs: tf.tensor2d(inputs),
      ys: tf.tensor2d(outputs)
    };
  }

  shouldRetrain(metrics, config) {
    // Simple retraining logic
    const daysSinceLoad = (Date.now() - metrics.loadedAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLoad > 7 || metrics.accuracy < 0.8;
  }

  async evaluateTensorFlow(model, testData, config) {
    const { xs, ys } = this.prepareTensorFlowData(testData, config);
    const evaluation = model.evaluate(xs, ys);
    
    xs.dispose();
    ys.dispose();
    
    return {
      loss: await evaluation[0].data(),
      accuracy: await evaluation[1].data()
    };
  }

  evaluateBrainJS(model, testData, config) {
    let correct = 0;
    
    for (const item of testData) {
      const prediction = model.run(item.input);
      const expected = item.output;
      
      // Simple accuracy calculation
      if (this.isCorrectPrediction(prediction, expected)) {
        correct++;
      }
    }
    
    return {
      accuracy: correct / testData.length,
      testSize: testData.length
    };
  }

  isCorrectPrediction(prediction, expected) {
    // Simple prediction correctness check
    if (typeof prediction === 'number' && typeof expected === 'number') {
      return Math.abs(prediction - expected) < 0.1;
    }
    return false;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    logger.info('Cleaning up Model Manager...');
    
    // Dispose TensorFlow models
    for (const [modelName, wrappedModel] of this.models.entries()) {
      if (wrappedModel.config.type === 'tensorflow') {
        wrappedModel.model.dispose();
      }
    }
    
    this.models.clear();
    this.modelConfigs.clear();
    this.modelMetrics.clear();
    
    logger.info('Model Manager cleanup complete');
  }
}

module.exports = ModelManager;