/**
 * WooCommerce Conflict Resolution Service
 * Handles data conflicts during bi-directional synchronization
 */

const db = require('../../../config/database');
const EventEmitter = require('events');

class WooCommerceConflictResolver extends EventEmitter {
  constructor() {
    super();
    this.isReady = false;
    this.config = {};
    
    // Conflict resolution strategies
    this.strategies = {
      'timestamp': this.resolveByTimestamp.bind(this),
      'manual': this.resolveManually.bind(this),
      'priority': this.resolveByPriority.bind(this),
      'merge': this.resolveByMerging.bind(this),
      'wc_wins': this.wooCommerceWins.bind(this),
      'nxt_wins': this.nxtWins.bind(this)
    };

    // Field priority mappings for different entity types
    this.fieldPriorities = {
      customer: {
        email: 'wc_wins', // WooCommerce email is source of truth
        phone: 'nxt_wins', // NXT phone data usually more reliable
        address: 'merge', // Merge address data
        name: 'timestamp' // Use most recent name
      },
      product: {
        name: 'wc_wins', // WooCommerce product name is source
        price: 'nxt_wins', // NXT pricing is source of truth
        inventory: 'nxt_wins', // NXT inventory management
        description: 'wc_wins', // WooCommerce descriptions
        sku: 'wc_wins' // WooCommerce SKU is source
      },
      order: {
        status: 'timestamp', // Use most recent status
        total: 'wc_wins', // WooCommerce totals are source
        items: 'wc_wins', // WooCommerce items are source
        shipping: 'merge' // Merge shipping data
      }
    };

    // Conflict statistics
    this.stats = {
      totalConflicts: 0,
      resolvedConflicts: 0,
      manualConflicts: 0,
      autoResolvedConflicts: 0
    };
  }

  /**
   * Initialize conflict resolver
   */
  async initialize(config = {}) {
    try {
      this.config = {
        defaultStrategy: config.defaultStrategy || 'timestamp',
        autoResolve: config.autoResolve !== false,
        backupConflicts: config.backupConflicts !== false,
        ...config
      };

      // Initialize conflict tables
      await this.initializeConflictTables();
      
      this.isReady = true;
      console.log('✅ WooCommerce Conflict Resolver initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Conflict resolver initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize conflict tracking tables
   */
  async initializeConflictTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_conflict_log (
          id SERIAL PRIMARY KEY,
          sync_id VARCHAR(100),
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(100) NOT NULL,
          conflict_type VARCHAR(50) NOT NULL,
          field_name VARCHAR(100),
          wc_value JSONB,
          nxt_value JSONB,
          resolved_value JSONB,
          resolution_strategy VARCHAR(50),
          resolution_status VARCHAR(20) DEFAULT 'pending',
          auto_resolved BOOLEAN DEFAULT false,
          resolved_by VARCHAR(100),
          resolved_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          metadata JSONB,
          INDEX(sync_id),
          INDEX(entity_type, entity_id),
          INDEX(conflict_type),
          INDEX(resolution_status),
          INDEX(created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_conflict_rules (
          id SERIAL PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          field_name VARCHAR(100),
          conflict_type VARCHAR(50),
          resolution_strategy VARCHAR(50) NOT NULL,
          priority INTEGER DEFAULT 100,
          conditions JSONB,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(entity_type),
          INDEX(field_name),
          INDEX(priority)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_conflict_backups (
          id SERIAL PRIMARY KEY,
          conflict_id INTEGER REFERENCES wc_conflict_log(id),
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(100) NOT NULL,
          original_data JSONB NOT NULL,
          backup_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(conflict_id),
          INDEX(entity_type, entity_id)
        )
      `);

      console.log('✅ Conflict tracking tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize conflict tables:', error);
      throw error;
    }
  }

  /**
   * Detect and resolve conflicts for an entity
   */
  async detectAndResolve(entityType, nxtData, wcData, syncId, options = {}) {
    try {
      const conflicts = await this.detectConflicts(entityType, nxtData, wcData);
      
      if (conflicts.length === 0) {
        return { hasConflicts: false, resolvedData: wcData };
      }

      console.log(`🔍 Detected ${conflicts.length} conflicts for ${entityType} ${nxtData.id || wcData.id}`);

      const resolutionResults = [];
      const resolvedData = { ...wcData };

      for (const conflict of conflicts) {
        try {
          const resolution = await this.resolveConflict(conflict, syncId, options);
          resolutionResults.push(resolution);

          // Apply resolution to data
          if (resolution.resolved && resolution.resolvedValue !== undefined) {
            this.applyResolution(resolvedData, conflict.fieldName, resolution.resolvedValue);
          }

        } catch (error) {
          console.error(`❌ Failed to resolve conflict for field ${conflict.fieldName}:`, error);
          resolutionResults.push({
            conflictId: conflict.id,
            resolved: false,
            error: error.message
          });
        }
      }

      this.emit('conflictsProcessed', {
        entityType,
        entityId: nxtData.id || wcData.id,
        totalConflicts: conflicts.length,
        resolved: resolutionResults.filter(r => r.resolved).length,
        failed: resolutionResults.filter(r => !r.resolved).length
      });

      return {
        hasConflicts: true,
        totalConflicts: conflicts.length,
        resolvedConflicts: resolutionResults.filter(r => r.resolved).length,
        resolvedData,
        resolutionResults
      };

    } catch (error) {
      console.error(`❌ Conflict detection/resolution failed for ${entityType}:`, error);
      throw error;
    }
  }

  /**
   * Detect conflicts between NXT and WooCommerce data
   */
  async detectConflicts(entityType, nxtData, wcData) {
    const conflicts = [];
    
    try {
      // Get field mappings for this entity type
      const fieldMappings = this.getFieldMappings(entityType);
      
      for (const [nxtField, wcField] of Object.entries(fieldMappings)) {
        const nxtValue = this.getNestedValue(nxtData, nxtField);
        const wcValue = this.getNestedValue(wcData, wcField);
        
        const conflict = await this.detectFieldConflict(
          entityType, 
          nxtField, 
          nxtValue, 
          wcValue, 
          nxtData, 
          wcData
        );
        
        if (conflict) {
          conflicts.push(conflict);
        }
      }

      return conflicts;
    } catch (error) {
      console.error(`❌ Conflict detection failed for ${entityType}:`, error);
      throw error;
    }
  }

  /**
   * Detect conflict for a specific field
   */
  async detectFieldConflict(entityType, fieldName, nxtValue, wcValue, nxtData, wcData) {
    try {
      // Skip if values are equal
      if (this.valuesEqual(nxtValue, wcValue)) {
        return null;
      }

      // Skip if one value is null/undefined
      if ((nxtValue == null && wcValue != null) || (nxtValue != null && wcValue == null)) {
        return null; // Not a conflict, just different data availability
      }

      // Determine conflict type
      const conflictType = this.determineConflictType(fieldName, nxtValue, wcValue);
      
      // Check if this is a significant conflict
      if (!this.isSignificantConflict(fieldName, nxtValue, wcValue)) {
        return null;
      }

      // Create conflict record
      const conflictId = await this.logConflict({
        entityType,
        entityId: nxtData.id || wcData.id,
        fieldName,
        conflictType,
        nxtValue,
        wcValue,
        metadata: {
          nxt_modified: nxtData.updated_at || nxtData.date_modified,
          wc_modified: wcData.date_modified || wcData.date_updated,
          detection_time: new Date().toISOString()
        }
      });

      return {
        id: conflictId,
        entityType,
        entityId: nxtData.id || wcData.id,
        fieldName,
        conflictType,
        nxtValue,
        wcValue
      };

    } catch (error) {
      console.error(`❌ Field conflict detection failed for ${fieldName}:`, error);
      throw error;
    }
  }

  /**
   * Resolve a specific conflict
   */
  async resolveConflict(conflict, syncId, options = {}) {
    try {
      // Get resolution strategy
      const strategy = await this.getResolutionStrategy(conflict, options);
      
      console.log(`🔧 Resolving ${conflict.conflictType} conflict for ${conflict.fieldName} using ${strategy} strategy`);

      // Apply resolution strategy
      const resolution = await this.strategies[strategy](conflict, options);
      
      // Log resolution
      await this.logResolution(conflict.id, {
        strategy,
        resolvedValue: resolution.value,
        autoResolved: resolution.autoResolved,
        resolvedBy: options.resolvedBy || 'system',
        syncId
      });

      // Update statistics
      this.updateConflictStats(resolution.autoResolved);

      this.emit('conflictResolved', {
        conflictId: conflict.id,
        strategy,
        autoResolved: resolution.autoResolved
      });

      return {
        conflictId: conflict.id,
        resolved: true,
        strategy,
        resolvedValue: resolution.value,
        autoResolved: resolution.autoResolved
      };

    } catch (error) {
      console.error(`❌ Conflict resolution failed:`, error);
      
      // Log failed resolution
      await this.logResolution(conflict.id, {
        strategy: 'failed',
        error: error.message,
        resolvedBy: options.resolvedBy || 'system',
        syncId
      });

      return {
        conflictId: conflict.id,
        resolved: false,
        error: error.message
      };
    }
  }

  /**
   * Get resolution strategy for a conflict
   */
  async getResolutionStrategy(conflict, options = {}) {
    // Check for explicit strategy in options
    if (options.strategy) {
      return options.strategy;
    }

    // Check custom rules
    const customRule = await this.getCustomRule(conflict);
    if (customRule) {
      return customRule.resolution_strategy;
    }

    // Check field priorities
    const fieldPriority = this.fieldPriorities[conflict.entityType]?.[conflict.fieldName];
    if (fieldPriority) {
      return fieldPriority;
    }

    // Use default strategy
    return this.config.defaultStrategy;
  }

  /**
   * Get custom resolution rule
   */
  async getCustomRule(conflict) {
    try {
      const result = await db.query(`
        SELECT * FROM wc_conflict_rules 
        WHERE entity_type = $1 
          AND (field_name = $2 OR field_name IS NULL)
          AND (conflict_type = $3 OR conflict_type IS NULL)
          AND is_active = true
        ORDER BY priority ASC, field_name NULLS LAST
        LIMIT 1
      `, [conflict.entityType, conflict.fieldName, conflict.conflictType]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Failed to get custom rule:', error);
      return null;
    }
  }

  // ==================== RESOLUTION STRATEGIES ====================

  /**
   * Resolve by timestamp (most recent wins)
   */
  async resolveByTimestamp(conflict, options = {}) {
    const nxtTime = this.extractTimestamp(conflict.nxtValue, 'nxt');
    const wcTime = this.extractTimestamp(conflict.wcValue, 'wc');

    if (!nxtTime && !wcTime) {
      // Fall back to WooCommerce if no timestamps
      return { value: conflict.wcValue, autoResolved: true };
    }

    const useWC = !nxtTime || (wcTime && new Date(wcTime) > new Date(nxtTime));
    return {
      value: useWC ? conflict.wcValue : conflict.nxtValue,
      autoResolved: true
    };
  }

  /**
   * Resolve manually (mark for manual intervention)
   */
  async resolveManually(conflict, options = {}) {
    // For now, default to WooCommerce value but mark as needing manual review
    return {
      value: conflict.wcValue,
      autoResolved: false,
      requiresManualReview: true
    };
  }

  /**
   * Resolve by priority (configured priority rules)
   */
  async resolveByPriority(conflict, options = {}) {
    const priorities = options.priorities || this.fieldPriorities[conflict.entityType] || {};
    const fieldPriority = priorities[conflict.fieldName];

    if (fieldPriority === 'wc_wins') {
      return { value: conflict.wcValue, autoResolved: true };
    } else if (fieldPriority === 'nxt_wins') {
      return { value: conflict.nxtValue, autoResolved: true };
    }

    // Default to timestamp if no specific priority
    return await this.resolveByTimestamp(conflict, options);
  }

  /**
   * Resolve by merging values
   */
  async resolveByMerging(conflict, options = {}) {
    try {
      const merged = this.mergeValues(conflict.nxtValue, conflict.wcValue, conflict.fieldName);
      return { value: merged, autoResolved: true };
    } catch (error) {
      console.error('❌ Merge resolution failed:', error);
      // Fall back to timestamp resolution
      return await this.resolveByTimestamp(conflict, options);
    }
  }

  /**
   * WooCommerce always wins
   */
  async wooCommerceWins(conflict, options = {}) {
    return { value: conflict.wcValue, autoResolved: true };
  }

  /**
   * NXT always wins
   */
  async nxtWins(conflict, options = {}) {
    return { value: conflict.nxtValue, autoResolved: true };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Get field mappings for entity type
   */
  getFieldMappings(entityType) {
    const mappings = {
      customer: {
        'company_name': 'billing.company',
        'email': 'email',
        'phone': 'billing.phone',
        'address.billing': 'billing',
        'address.shipping': 'shipping'
      },
      product: {
        'name': 'name',
        'unit_price': 'price',
        'cost_price': 'regular_price',
        'description': 'description',
        'sku': 'sku'
      },
      order: {
        'status': 'status',
        'total_amount': 'total',
        'subtotal': 'subtotal',
        'tax_amount': 'total_tax',
        'shipping_cost': 'shipping_total'
      }
    };

    return mappings[entityType] || {};
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Check if values are equal
   */
  valuesEqual(value1, value2) {
    if (value1 === value2) return true;
    
    // Handle objects
    if (typeof value1 === 'object' && typeof value2 === 'object') {
      return JSON.stringify(value1) === JSON.stringify(value2);
    }
    
    // Handle numbers vs strings
    if ((typeof value1 === 'number' && typeof value2 === 'string') ||
        (typeof value1 === 'string' && typeof value2 === 'number')) {
      return parseFloat(value1) === parseFloat(value2);
    }
    
    return false;
  }

  /**
   * Determine conflict type
   */
  determineConflictType(fieldName, nxtValue, wcValue) {
    if (typeof nxtValue !== typeof wcValue) {
      return 'type_mismatch';
    }
    
    if (typeof nxtValue === 'object') {
      return 'object_difference';
    }
    
    if (fieldName.includes('price') || fieldName.includes('total')) {
      return 'price_difference';
    }
    
    if (fieldName.includes('date') || fieldName.includes('time')) {
      return 'timestamp_difference';
    }
    
    return 'value_difference';
  }

  /**
   * Check if conflict is significant
   */
  isSignificantConflict(fieldName, nxtValue, wcValue) {
    // Price differences less than 0.01 are not significant
    if (fieldName.includes('price') || fieldName.includes('total')) {
      const diff = Math.abs(parseFloat(nxtValue) - parseFloat(wcValue));
      return diff >= 0.01;
    }
    
    // String differences less than minor variations are not significant
    if (typeof nxtValue === 'string' && typeof wcValue === 'string') {
      const similarity = this.calculateStringSimilarity(nxtValue, wcValue);
      return similarity < 0.95; // Less than 95% similar is significant
    }
    
    return true;
  }

  /**
   * Calculate string similarity
   */
  calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Extract timestamp from value
   */
  extractTimestamp(value, source) {
    if (!value) return null;
    
    if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value)) {
      return value;
    }
    
    if (typeof value === 'object') {
      return value.date_modified || value.updated_at || value.created_at || null;
    }
    
    return null;
  }

  /**
   * Merge two values
   */
  mergeValues(nxtValue, wcValue, fieldName) {
    // For addresses and objects, merge properties
    if (typeof nxtValue === 'object' && typeof wcValue === 'object') {
      return { ...nxtValue, ...wcValue };
    }
    
    // For arrays, combine unique values
    if (Array.isArray(nxtValue) && Array.isArray(wcValue)) {
      return [...new Set([...nxtValue, ...wcValue])];
    }
    
    // For strings, prefer non-empty values
    if (typeof nxtValue === 'string' && typeof wcValue === 'string') {
      return wcValue.length > nxtValue.length ? wcValue : nxtValue;
    }
    
    // Default to WooCommerce value
    return wcValue;
  }

  /**
   * Apply resolution to data
   */
  applyResolution(data, fieldPath, resolvedValue) {
    const keys = fieldPath.split('.');
    let current = data;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = resolvedValue;
  }

  /**
   * Log conflict
   */
  async logConflict(conflictData) {
    try {
      const result = await db.query(`
        INSERT INTO wc_conflict_log (
          entity_type, entity_id, field_name, conflict_type,
          nxt_value, wc_value, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        conflictData.entityType,
        conflictData.entityId.toString(),
        conflictData.fieldName,
        conflictData.conflictType,
        JSON.stringify(conflictData.nxtValue),
        JSON.stringify(conflictData.wcValue),
        JSON.stringify(conflictData.metadata || {})
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error('❌ Failed to log conflict:', error);
      throw error;
    }
  }

  /**
   * Log resolution
   */
  async logResolution(conflictId, resolutionData) {
    try {
      await db.query(`
        UPDATE wc_conflict_log SET 
          resolved_value = $1,
          resolution_strategy = $2,
          resolution_status = $3,
          auto_resolved = $4,
          resolved_by = $5,
          resolved_at = NOW()
        WHERE id = $6
      `, [
        JSON.stringify(resolutionData.resolvedValue),
        resolutionData.strategy,
        resolutionData.error ? 'failed' : 'resolved',
        resolutionData.autoResolved || false,
        resolutionData.resolvedBy,
        conflictId
      ]);
    } catch (error) {
      console.error('❌ Failed to log resolution:', error);
    }
  }

  /**
   * Update conflict statistics
   */
  updateConflictStats(autoResolved) {
    this.stats.totalConflicts++;
    this.stats.resolvedConflicts++;
    
    if (autoResolved) {
      this.stats.autoResolvedConflicts++;
    } else {
      this.stats.manualConflicts++;
    }
  }

  /**
   * Get conflict statistics
   */
  async getConflictStats(timeframe = '24h') {
    try {
      const hours = parseInt(timeframe.replace('h', ''));
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const result = await db.query(`
        SELECT 
          entity_type,
          conflict_type,
          resolution_status,
          auto_resolved,
          COUNT(*) as conflict_count
        FROM wc_conflict_log 
        WHERE created_at >= $1
        GROUP BY entity_type, conflict_type, resolution_status, auto_resolved
        ORDER BY entity_type, conflict_count DESC
      `, [since]);

      return {
        timeframe,
        since: since.toISOString(),
        runtime_stats: { ...this.stats },
        database_stats: result.rows
      };
    } catch (error) {
      console.error('❌ Failed to get conflict stats:', error);
      throw error;
    }
  }

  /**
   * Get pending conflicts
   */
  async getPendingConflicts(limit = 50) {
    try {
      const result = await db.query(`
        SELECT * FROM wc_conflict_log 
        WHERE resolution_status = 'pending'
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get pending conflicts:', error);
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

module.exports = new WooCommerceConflictResolver();