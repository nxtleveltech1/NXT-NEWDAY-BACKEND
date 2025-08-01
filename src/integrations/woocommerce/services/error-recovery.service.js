/**
 * WooCommerce Error Recovery Service
 * Handles error detection, analysis, and automated recovery
 */

const db = require('../../../config/database');
const EventEmitter = require('events');

class WooCommerceErrorRecovery extends EventEmitter {
  constructor() {
    super();
    this.isReady = false;
    this.config = {};
    
    // Recovery strategies
    this.recoveryStrategies = {
      'api_timeout': this.handleApiTimeout.bind(this),
      'rate_limit': this.handleRateLimit.bind(this),
      'authentication_failure': this.handleAuthFailure.bind(this),
      'data_validation_error': this.handleDataValidation.bind(this),
      'network_error': this.handleNetworkError.bind(this),
      'database_error': this.handleDatabaseError.bind(this),
      'conflict_resolution_error': this.handleConflictError.bind(this),
      'webhook_processing_error': this.handleWebhookError.bind(this)
    };

    // Error patterns for classification
    this.errorPatterns = {
      api_timeout: [/timeout/i, /ETIMEDOUT/i, /ECONNRESET/i],
      rate_limit: [/rate limit/i, /429/i, /too many requests/i],
      authentication_failure: [/unauthorized/i, /401/i, /authentication/i, /invalid credentials/i],
      data_validation_error: [/validation/i, /invalid data/i, /missing required/i],
      network_error: [/ENOTFOUND/i, /ECONNREFUSED/i, /network/i],
      database_error: [/database/i, /connection/i, /query failed/i, /constraint/i],
      conflict_resolution_error: [/conflict/i, /merge/i, /resolution failed/i],
      webhook_processing_error: [/webhook/i, /signature/i, /payload/i]
    };

    // Recovery statistics
    this.stats = {
      totalErrors: 0,
      recoveredErrors: 0,
      unrecoverableErrors: 0,
      avgRecoveryTime: 0,
      recoverySuccessRate: 0
    };

    // Circuit breaker states
    this.circuitBreakers = new Map();
  }

  /**
   * Initialize error recovery service
   */
  async initialize(config = {}) {
    try {
      this.config = {
        maxRetryAttempts: config.maxRetryAttempts || 3,
        retryDelay: config.retryDelay || 1000,
        backoffMultiplier: config.backoffMultiplier || 2,
        circuitBreakerThreshold: config.circuitBreakerThreshold || 5,
        circuitBreakerTimeout: config.circuitBreakerTimeout || 300000, // 5 minutes
        enableAutoRecovery: config.enableAutoRecovery !== false,
        ...config
      };

      // Initialize error tracking tables
      await this.initializeErrorTables();
      
      this.isReady = true;
      console.log('✅ WooCommerce Error Recovery Service initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error recovery service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize error tracking tables
   */
  async initializeErrorTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_error_log (
          id SERIAL PRIMARY KEY,
          error_type VARCHAR(100) NOT NULL,
          error_category VARCHAR(50) NOT NULL,
          operation_type VARCHAR(50) NOT NULL,
          operation_id VARCHAR(100),
          error_message TEXT NOT NULL,
          error_stack TEXT,
          error_data JSONB,
          recovery_strategy VARCHAR(50),
          recovery_status VARCHAR(20) DEFAULT 'pending',
          recovery_attempts INTEGER DEFAULT 0,
          max_recovery_attempts INTEGER DEFAULT 3,
          recovered_at TIMESTAMP WITH TIME ZONE,
          next_retry TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(error_type),
          INDEX(error_category),
          INDEX(operation_type),
          INDEX(recovery_status),
          INDEX(created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_recovery_actions (
          id SERIAL PRIMARY KEY,
          error_id INTEGER REFERENCES wc_error_log(id) ON DELETE CASCADE,
          action_type VARCHAR(50) NOT NULL,
          action_description TEXT,
          action_data JSONB,
          status VARCHAR(20) DEFAULT 'pending',
          result TEXT,
          executed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(error_id),
          INDEX(action_type),
          INDEX(status)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_circuit_breakers (
          id SERIAL PRIMARY KEY,
          service_name VARCHAR(100) NOT NULL,
          operation_name VARCHAR(100) NOT NULL,
          state VARCHAR(20) DEFAULT 'closed',
          failure_count INTEGER DEFAULT 0,
          failure_threshold INTEGER DEFAULT 5,
          last_failure TIMESTAMP WITH TIME ZONE,
          next_attempt TIMESTAMP WITH TIME ZONE,
          success_count INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(service_name, operation_name)
        )
      `);

      console.log('✅ Error tracking tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize error tables:', error);
      throw error;
    }
  }

  /**
   * Process errors from sync operations
   */
  async processErrors(syncId, errors) {
    try {
      console.log(`🔍 Processing ${errors.length} errors from sync: ${syncId}`);
      
      const recoveryResults = [];
      
      for (const error of errors) {
        try {
          const result = await this.processError(error, 'sync', syncId);
          recoveryResults.push(result);
        } catch (processingError) {
          console.error(`❌ Error processing failed:`, processingError);
          recoveryResults.push({
            error: error,
            recovered: false,
            processingError: processingError.message
          });
        }
      }

      this.emit('errorsProcessed', {
        syncId,
        totalErrors: errors.length,
        recovered: recoveryResults.filter(r => r.recovered).length,
        failed: recoveryResults.filter(r => !r.recovered).length
      });

      return recoveryResults;
    } catch (error) {
      console.error('❌ Error processing batch failed:', error);
      throw error;
    }
  }

  /**
   * Process individual error
   */
  async processError(error, operationType, operationId) {
    try {
      // Classify error
      const errorCategory = this.classifyError(error.error || error.message);
      
      // Log error
      const errorId = await this.logError({
        errorType: error.type || 'unknown',
        errorCategory,
        operationType,
        operationId,
        errorMessage: error.error || error.message,
        errorStack: error.stack,
        errorData: error
      });

      // Check circuit breaker
      const circuitBreakerKey = `${operationType}_${errorCategory}`;
      if (await this.isCircuitBreakerOpen(circuitBreakerKey)) {
        console.log(`⚡ Circuit breaker open for ${circuitBreakerKey}, skipping recovery`);
        return { errorId, recovered: false, reason: 'circuit_breaker_open' };
      }

      // Attempt recovery if enabled
      if (this.config.enableAutoRecovery) {
        const recoveryResult = await this.attemptRecovery(errorId, errorCategory, error);
        
        if (recoveryResult.recovered) {
          await this.recordSuccessfulRecovery(errorId);
          await this.resetCircuitBreaker(circuitBreakerKey);
          this.stats.recoveredErrors++;
        } else {
          await this.recordFailedRecovery(errorId, recoveryResult.reason);
          await this.incrementCircuitBreaker(circuitBreakerKey);
          this.stats.unrecoverableErrors++;
        }

        this.stats.totalErrors++;
        this.updateRecoveryRate();

        return { errorId, ...recoveryResult };
      }

      return { errorId, recovered: false, reason: 'auto_recovery_disabled' };
      
    } catch (error) {
      console.error('❌ Individual error processing failed:', error);
      throw error;
    }
  }

  /**
   * Classify error based on patterns
   */
  classifyError(errorMessage) {
    if (!errorMessage) return 'unknown';
    
    for (const [category, patterns] of Object.entries(this.errorPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(errorMessage)) {
          return category;
        }
      }
    }
    
    return 'unknown';
  }

  /**
   * Attempt error recovery
   */
  async attemptRecovery(errorId, errorCategory, errorData) {
    try {
      console.log(`🔧 Attempting recovery for error ${errorId} (${errorCategory})`);
      
      const strategy = this.recoveryStrategies[errorCategory];
      if (!strategy) {
        return { recovered: false, reason: 'no_strategy_available' };
      }

      const startTime = Date.now();
      const result = await strategy(errorData, errorId);
      const recoveryTime = Date.now() - startTime;

      // Update average recovery time
      this.updateAverageRecoveryTime(recoveryTime);

      return { recovered: result.success, ...result, recoveryTime };
      
    } catch (error) {
      console.error(`❌ Recovery attempt failed for error ${errorId}:`, error);
      return { recovered: false, reason: 'recovery_strategy_failed', error: error.message };
    }
  }

  // ==================== RECOVERY STRATEGIES ====================

  /**
   * Handle API timeout errors
   */
  async handleApiTimeout(errorData, errorId) {
    try {
      console.log('🔄 Handling API timeout error...');
      
      // Create retry action
      await this.createRecoveryAction(errorId, 'api_retry', 
        'Retry API call with increased timeout', {
          originalTimeout: errorData.timeout || 5000,
          newTimeout: (errorData.timeout || 5000) * 2,
          retryAttempt: (errorData.retryAttempt || 0) + 1
        });

      // Wait before retry
      await this.delay(this.config.retryDelay * 2);

      // Return success (actual retry will be handled by the calling service)
      return { 
        success: true, 
        action: 'retry_with_increased_timeout',
        recommendation: 'Increase API timeout and retry operation'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle rate limit errors
   */
  async handleRateLimit(errorData, errorId) {
    try {
      console.log('⏰ Handling rate limit error...');
      
      // Extract retry-after header if available
      const retryAfter = this.extractRetryAfter(errorData);
      const waitTime = retryAfter || (this.config.retryDelay * 10); // 10x normal delay
      
      await this.createRecoveryAction(errorId, 'rate_limit_wait',
        `Wait ${waitTime}ms before retry`, {
          waitTime,
          retryAfter: retryAfter
        });

      // Wait for rate limit to reset
      await this.delay(waitTime);

      return {
        success: true,
        action: 'wait_and_retry',
        waitTime,
        recommendation: 'Implement exponential backoff for API calls'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle authentication failures
   */
  async handleAuthFailure(errorData, errorId) {
    try {
      console.log('🔐 Handling authentication failure...');
      
      await this.createRecoveryAction(errorId, 'auth_refresh',
        'Refresh authentication credentials', {
          errorType: 'authentication_failure'
        });

      // For now, just log the issue - actual credential refresh 
      // would need to be implemented by the calling service
      return {
        success: false, // Can't auto-recover from auth issues
        action: 'manual_intervention_required',
        recommendation: 'Check and refresh WooCommerce API credentials'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle data validation errors
   */
  async handleDataValidation(errorData, errorId) {
    try {
      console.log('📝 Handling data validation error...');
      
      // Try to fix common validation issues
      const fixedData = this.attemptDataFix(errorData);
      
      await this.createRecoveryAction(errorId, 'data_validation_fix',
        'Attempt to fix validation issues', {
          originalData: errorData.data || {},
          fixedData: fixedData,
          validationErrors: errorData.validationErrors || []
        });

      if (fixedData.fixed) {
        return {
          success: true,
          action: 'data_fixed',
          fixedData: fixedData.data,
          recommendation: 'Update data validation rules to prevent similar issues'
        };
      }

      return {
        success: false,
        action: 'manual_data_review_required',
        recommendation: 'Review and fix data validation issues manually'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle network errors
   */
  async handleNetworkError(errorData, errorId) {
    try {
      console.log('🌐 Handling network error...');
      
      await this.createRecoveryAction(errorId, 'network_retry',
        'Retry after network error with backoff', {
          retryAttempt: (errorData.retryAttempt || 0) + 1,
          backoffDelay: this.config.retryDelay * Math.pow(this.config.backoffMultiplier, errorData.retryAttempt || 0)
        });

      // Exponential backoff
      const backoffDelay = this.config.retryDelay * Math.pow(this.config.backoffMultiplier, errorData.retryAttempt || 0);
      await this.delay(backoffDelay);

      return {
        success: true,
        action: 'retry_with_backoff',
        backoffDelay,
        recommendation: 'Check network connectivity and DNS resolution'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle database errors
   */
  async handleDatabaseError(errorData, errorId) {
    try {
      console.log('🗄️ Handling database error...');
      
      await this.createRecoveryAction(errorId, 'database_recovery',
        'Attempt database error recovery', {
          errorType: errorData.code || 'unknown',
          table: errorData.table || 'unknown'
        });

      // Check if it's a connection issue
      if (this.isDatabaseConnectionError(errorData)) {
        await this.delay(this.config.retryDelay);
        return {
          success: true,
          action: 'retry_connection',
          recommendation: 'Check database connection pool settings'
        };
      }

      // Check if it's a constraint violation
      if (this.isDatabaseConstraintError(errorData)) {
        return {
          success: false,
          action: 'constraint_violation',
          recommendation: 'Review data integrity and constraint definitions'
        };
      }

      return {
        success: false,
        action: 'manual_database_review',
        recommendation: 'Review database error logs and investigate'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle conflict resolution errors
   */
  async handleConflictError(errorData, errorId) {
    try {
      console.log('⚖️ Handling conflict resolution error...');
      
      await this.createRecoveryAction(errorId, 'conflict_retry',
        'Retry conflict resolution with different strategy', {
          originalStrategy: errorData.strategy || 'unknown',
          suggestedStrategy: 'manual'
        });

      return {
        success: false, // Conflicts usually need manual resolution
        action: 'manual_conflict_resolution',
        recommendation: 'Review conflict and resolve manually using conflict resolution dashboard'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle webhook processing errors
   */
  async handleWebhookError(errorData, errorId) {
    try {
      console.log('🔔 Handling webhook processing error...');
      
      await this.createRecoveryAction(errorId, 'webhook_retry',
        'Retry webhook processing', {
          webhookId: errorData.webhookId || 'unknown',
          eventType: errorData.eventType || 'unknown'
        });

      // Simple retry for webhook errors
      await this.delay(this.config.retryDelay);

      return {
        success: true,
        action: 'retry_webhook_processing',
        recommendation: 'Verify webhook signature and payload format'
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== CIRCUIT BREAKER METHODS ====================

  /**
   * Check if circuit breaker is open
   */
  async isCircuitBreakerOpen(key) {
    try {
      const result = await db.query(`
        SELECT state, failure_count, failure_threshold, next_attempt
        FROM wc_circuit_breakers
        WHERE service_name = 'woocommerce' AND operation_name = $1
      `, [key]);

      if (result.rows.length === 0) {
        return false; // No circuit breaker = closed
      }

      const breaker = result.rows[0];
      
      if (breaker.state === 'open') {
        if (breaker.next_attempt && new Date() > new Date(breaker.next_attempt)) {
          // Try to transition to half-open
          await this.setCircuitBreakerState(key, 'half-open');
          return false;
        }
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Circuit breaker check failed:', error);
      return false;
    }
  }

  /**
   * Increment circuit breaker failure count
   */
  async incrementCircuitBreaker(key) {
    try {
      await db.query(`
        INSERT INTO wc_circuit_breakers (service_name, operation_name, failure_count, last_failure)
        VALUES ('woocommerce', $1, 1, NOW())
        ON CONFLICT (service_name, operation_name)
        DO UPDATE SET 
          failure_count = wc_circuit_breakers.failure_count + 1,
          last_failure = NOW(),
          updated_at = NOW()
      `, [key]);

      // Check if threshold reached
      const result = await db.query(`
        SELECT failure_count, failure_threshold
        FROM wc_circuit_breakers
        WHERE service_name = 'woocommerce' AND operation_name = $1
      `, [key]);

      if (result.rows.length > 0) {
        const breaker = result.rows[0];
        if (breaker.failure_count >= breaker.failure_threshold) {
          await this.setCircuitBreakerState(key, 'open');
        }
      }
    } catch (error) {
      console.error('❌ Circuit breaker increment failed:', error);
    }
  }

  /**
   * Reset circuit breaker
   */
  async resetCircuitBreaker(key) {
    try {
      await db.query(`
        UPDATE wc_circuit_breakers SET 
          failure_count = 0,
          state = 'closed',
          success_count = success_count + 1,
          updated_at = NOW()
        WHERE service_name = 'woocommerce' AND operation_name = $1
      `, [key]);
    } catch (error) {
      console.error('❌ Circuit breaker reset failed:', error);
    }
  }

  /**
   * Set circuit breaker state
   */
  async setCircuitBreakerState(key, state) {
    try {
      const nextAttempt = state === 'open' 
        ? new Date(Date.now() + this.config.circuitBreakerTimeout)
        : null;

      await db.query(`
        UPDATE wc_circuit_breakers SET 
          state = $2,
          next_attempt = $3,
          updated_at = NOW()
        WHERE service_name = 'woocommerce' AND operation_name = $1
      `, [key, state, nextAttempt]);

      console.log(`⚡ Circuit breaker ${key} set to ${state}`);
    } catch (error) {
      console.error('❌ Circuit breaker state update failed:', error);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Log error
   */
  async logError(errorData) {
    try {
      const result = await db.query(`
        INSERT INTO wc_error_log (
          error_type, error_category, operation_type, operation_id,
          error_message, error_stack, error_data, recovery_strategy
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        errorData.errorType,
        errorData.errorCategory,
        errorData.operationType,
        errorData.operationId,
        errorData.errorMessage,
        errorData.errorStack,
        JSON.stringify(errorData.errorData || {}),
        errorData.errorCategory // Use category as initial strategy
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error('❌ Failed to log error:', error);
      throw error;
    }
  }

  /**
   * Create recovery action
   */
  async createRecoveryAction(errorId, actionType, description, actionData) {
    try {
      await db.query(`
        INSERT INTO wc_recovery_actions (
          error_id, action_type, action_description, action_data
        ) VALUES ($1, $2, $3, $4)
      `, [errorId, actionType, description, JSON.stringify(actionData || {})]);
    } catch (error) {
      console.error('❌ Failed to create recovery action:', error);
    }
  }

  /**
   * Record successful recovery
   */
  async recordSuccessfulRecovery(errorId) {
    try {
      await db.query(`
        UPDATE wc_error_log SET 
          recovery_status = 'recovered',
          recovered_at = NOW()
        WHERE id = $1
      `, [errorId]);
    } catch (error) {
      console.error('❌ Failed to record successful recovery:', error);
    }
  }

  /**
   * Record failed recovery
   */
  async recordFailedRecovery(errorId, reason) {
    try {
      await db.query(`
        UPDATE wc_error_log SET 
          recovery_status = 'failed',
          recovery_attempts = recovery_attempts + 1
        WHERE id = $1
      `, [errorId]);
    } catch (error) {
      console.error('❌ Failed to record failed recovery:', error);
    }
  }

  /**
   * Extract retry-after header
   */
  extractRetryAfter(errorData) {
    try {
      const headers = errorData.headers || errorData.response?.headers || {};
      const retryAfter = headers['retry-after'] || headers['Retry-After'];
      
      if (retryAfter) {
        // If it's a number, it's seconds
        if (/^\d+$/.test(retryAfter)) {
          return parseInt(retryAfter) * 1000; // Convert to milliseconds
        }
        
        // If it's a date, calculate difference
        const retryDate = new Date(retryAfter);
        if (!isNaN(retryDate.getTime())) {
          return Math.max(0, retryDate.getTime() - Date.now());
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Attempt to fix common data validation issues
   */
  attemptDataFix(errorData) {
    try {
      let data = { ...errorData.data };
      let fixed = false;

      // Fix missing required fields with defaults
      if (errorData.validationErrors) {
        for (const error of errorData.validationErrors) {
          if (error.includes('required') && error.includes('email')) {
            data.email = data.email || 'noreply@example.com';
            fixed = true;
          }
          if (error.includes('required') && error.includes('name')) {
            data.name = data.name || 'Unknown';
            fixed = true;
          }
        }
      }

      // Fix data type issues
      if (data.price && typeof data.price === 'string') {
        const numPrice = parseFloat(data.price);
        if (!isNaN(numPrice)) {
          data.price = numPrice;
          fixed = true;
        }
      }

      return { fixed, data };
    } catch (error) {
      return { fixed: false, data: errorData.data };
    }
  }

  /**
   * Check if error is database connection issue
   */
  isDatabaseConnectionError(errorData) {
    const connectionErrors = [
      /connection/i,
      /ECONNREFUSED/i,
      /timeout/i,
      /pool/i
    ];

    const message = errorData.message || errorData.error || '';
    return connectionErrors.some(pattern => pattern.test(message));
  }

  /**
   * Check if error is database constraint violation
   */
  isDatabaseConstraintError(errorData) {
    const constraintErrors = [
      /constraint/i,
      /duplicate/i,
      /unique/i,
      /foreign key/i,
      /violates/i
    ];

    const message = errorData.message || errorData.error || '';
    return constraintErrors.some(pattern => pattern.test(message));
  }

  /**
   * Delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update average recovery time
   */
  updateAverageRecoveryTime(newTime) {
    const totalRecovered = this.stats.recoveredErrors;
    if (totalRecovered === 0) {
      this.stats.avgRecoveryTime = newTime;
    } else {
      this.stats.avgRecoveryTime = ((this.stats.avgRecoveryTime * totalRecovered) + newTime) / (totalRecovered + 1);
    }
  }

  /**
   * Update recovery success rate
   */
  updateRecoveryRate() {
    if (this.stats.totalErrors > 0) {
      this.stats.recoverySuccessRate = (this.stats.recoveredErrors / this.stats.totalErrors) * 100;
    }
  }

  /**
   * Get error recovery statistics
   */
  async getRecoveryStats(timeframe = '24h') {
    try {
      const hours = parseInt(timeframe.replace('h', ''));
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const result = await db.query(`
        SELECT 
          error_category,
          recovery_status,
          COUNT(*) as error_count,
          AVG(EXTRACT(EPOCH FROM (recovered_at - created_at))) as avg_recovery_time
        FROM wc_error_log 
        WHERE created_at >= $1
        GROUP BY error_category, recovery_status
        ORDER BY error_count DESC
      `, [since]);

      return {
        timeframe,
        since: since.toISOString(),
        runtime_stats: { ...this.stats },
        database_stats: result.rows
      };
    } catch (error) {
      console.error('❌ Failed to get recovery stats:', error);
      throw error;
    }
  }

  /**
   * Get service readiness status
   */
  isReady() {
    return this.isReady;
  }
}

module.exports = new WooCommerceErrorRecovery();