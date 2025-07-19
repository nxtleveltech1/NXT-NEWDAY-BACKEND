/**
 * NXT NEW DAY - Migration Execution Plan and Timing Calculator
 * 
 * Comprehensive migration planning, timing estimation, and execution orchestration.
 * Provides detailed execution plans with timing estimates, resource requirements,
 * and step-by-step procedures for production deployment.
 * 
 * Author: Data Migration Agent
 * Version: 1.0.0
 * Last Updated: 2025-01-19
 */

import { DataMigrationSuite } from './data-migration-suite.js';
import { DataValidationSuite } from './data-validation-suite.js';

// ==================== EXECUTION PLAN CONFIGURATION ====================

const EXECUTION_CONFIG = {
  environment: 'production', // development, staging, production
  batchSizes: {
    small: 500,
    medium: 1000,
    large: 2000
  },
  timeouts: {
    preparation: 1800000, // 30 minutes
    migration: 7200000,   // 2 hours
    validation: 1800000,  // 30 minutes
    cleanup: 600000       // 10 minutes
  },
  parallelization: {
    enabled: true,
    maxConcurrent: 3,
    independentTables: ['customers', 'suppliers'],
    dependentTables: ['products', 'inventory', 'priceLists', 'priceListItems']
  },
  monitoring: {
    progressReportInterval: 5000,
    healthCheckInterval: 30000,
    performanceMetrics: true
  },
  recovery: {
    checkpoints: true,
    rollbackEnabled: true,
    backupVerification: true
  }
};

// Performance benchmarks per 1000 records (in seconds)
const PERFORMANCE_BENCHMARKS = {
  customers: {
    read: 5,
    transform: 8,
    write: 12,
    validate: 3,
    total: 28
  },
  suppliers: {
    read: 6,
    transform: 10,
    write: 15,
    validate: 4,
    total: 35
  },
  products: {
    read: 4,
    transform: 6,
    write: 10,
    validate: 3,
    total: 23
  },
  inventory: {
    read: 7,
    transform: 12,
    write: 18,
    validate: 5,
    total: 42
  },
  priceLists: {
    read: 3,
    transform: 5,
    write: 8,
    validate: 2,
    total: 18
  },
  priceListItems: {
    read: 2,
    transform: 4,
    write: 6,
    validate: 2,
    total: 14
  },
  uploadHistory: {
    read: 2,
    transform: 3,
    write: 5,
    validate: 1,
    total: 11
  }
};

// ==================== MIGRATION EXECUTION PLANNER ====================

export class MigrationExecutionPlanner {
  constructor(sourceDb, targetDb, options = {}) {
    this.sourceDb = sourceDb;
    this.targetDb = targetDb;
    this.config = { ...EXECUTION_CONFIG, ...options };
    this.executionPlan = null;
    this.timingEstimates = null;
    this.resourceRequirements = null;
    this.riskAssessment = null;
  }

  // ==================== MAIN PLANNING METHODS ====================

  async generateExecutionPlan() {
    console.log('🔍 Generating comprehensive migration execution plan...');

    try {
      // Analyze source data
      const dataAnalysis = await this.analyzeSourceData();
      
      // Calculate timing estimates
      this.timingEstimates = this.calculateTimingEstimates(dataAnalysis);
      
      // Assess resource requirements
      this.resourceRequirements = this.calculateResourceRequirements(dataAnalysis);
      
      // Perform risk assessment
      this.riskAssessment = await this.performRiskAssessment(dataAnalysis);
      
      // Generate execution steps
      this.executionPlan = this.generateDetailedExecutionPlan(dataAnalysis);
      
      // Create monitoring plan
      const monitoringPlan = this.createMonitoringPlan();
      
      // Generate rollback plan
      const rollbackPlan = this.createRollbackPlan();

      const completePlan = {
        metadata: {
          generatedAt: new Date().toISOString(),
          environment: this.config.environment,
          version: '1.0.0'
        },
        analysis: dataAnalysis,
        timing: this.timingEstimates,
        resources: this.resourceRequirements,
        risks: this.riskAssessment,
        execution: this.executionPlan,
        monitoring: monitoringPlan,
        rollback: rollbackPlan,
        recommendations: this.generateRecommendations()
      };

      console.log('✅ Migration execution plan generated successfully');
      return completePlan;

    } catch (error) {
      console.error('❌ Failed to generate execution plan:', error.message);
      throw error;
    }
  }

  // ==================== DATA ANALYSIS ====================

  async analyzeSourceData() {
    console.log('📊 Analyzing source data...');

    const analysis = {
      tables: {},
      dataQuality: {},
      relationships: {},
      performance: {}
    };

    const tables = [
      'legacy_customers',
      'legacy_vendors', 
      'legacy_suppliers',
      'legacy_products',
      'legacy_inventory',
      'legacy_price_lists',
      'legacy_price_list_items',
      'legacy_upload_history'
    ];

    for (const table of tables) {
      try {
        // Get record count
        const countResult = await this.sourceDb.query(`SELECT COUNT(*) as count FROM ${table}`);
        const recordCount = parseInt(countResult.rows[0].count);

        // Get table size
        const sizeResult = await this.sourceDb.query(`
          SELECT pg_size_pretty(pg_total_relation_size('${table}')) as size,
                 pg_total_relation_size('${table}') as size_bytes
        `);

        // Sample data quality
        const sampleResult = await this.sourceDb.query(`
          SELECT * FROM ${table} 
          ORDER BY RANDOM() 
          LIMIT 100
        `);

        analysis.tables[table] = {
          recordCount,
          size: sizeResult.rows[0]?.size || 'Unknown',
          sizeBytes: parseInt(sizeResult.rows[0]?.size_bytes || 0),
          sampleData: sampleResult.rows,
          estimatedComplexity: this.assessDataComplexity(sampleResult.rows),
          dataTypes: this.analyzeDataTypes(sampleResult.rows)
        };

        console.log(`📋 ${table}: ${recordCount.toLocaleString()} records (${sizeResult.rows[0]?.size})`);

      } catch (error) {
        console.warn(`⚠️  Could not analyze ${table}: ${error.message}`);
        analysis.tables[table] = {
          recordCount: 0,
          size: 'Unknown',
          sizeBytes: 0,
          error: error.message
        };
      }
    }

    // Analyze data quality
    analysis.dataQuality = await this.analyzeDataQuality();
    
    // Analyze relationships
    analysis.relationships = await this.analyzeRelationships();

    return analysis;
  }

  assessDataComplexity(sampleData) {
    if (sampleData.length === 0) return 'low';

    let complexityScore = 0;
    const firstRow = sampleData[0];

    // Count JSONB fields
    const jsonbFields = Object.values(firstRow).filter(value => 
      typeof value === 'object' && value !== null
    ).length;
    complexityScore += jsonbFields * 2;

    // Count text fields that might need processing
    const textFields = Object.values(firstRow).filter(value => 
      typeof value === 'string' && value.length > 100
    ).length;
    complexityScore += textFields;

    // Count null values (indicates data quality issues)
    const nullValues = Object.values(firstRow).filter(value => 
      value === null || value === ''
    ).length;
    complexityScore += nullValues * 0.5;

    if (complexityScore <= 3) return 'low';
    if (complexityScore <= 7) return 'medium';
    return 'high';
  }

  analyzeDataTypes(sampleData) {
    if (sampleData.length === 0) return {};

    const firstRow = sampleData[0];
    const dataTypes = {};

    for (const [key, value] of Object.entries(firstRow)) {
      if (value === null) {
        dataTypes[key] = 'nullable';
      } else if (typeof value === 'string') {
        if (value.includes('@')) {
          dataTypes[key] = 'email';
        } else if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
          dataTypes[key] = 'date';
        } else if (value.length > 100) {
          dataTypes[key] = 'text';
        } else {
          dataTypes[key] = 'varchar';
        }
      } else if (typeof value === 'number') {
        dataTypes[key] = Number.isInteger(value) ? 'integer' : 'decimal';
      } else if (typeof value === 'object') {
        dataTypes[key] = 'jsonb';
      } else if (typeof value === 'boolean') {
        dataTypes[key] = 'boolean';
      } else {
        dataTypes[key] = 'unknown';
      }
    }

    return dataTypes;
  }

  async analyzeDataQuality() {
    console.log('🔍 Analyzing data quality...');
    
    const issues = [];

    try {
      // Check for duplicate customer codes
      const duplicateCustomers = await this.sourceDb.query(`
        SELECT customer_code, COUNT(*) as count 
        FROM legacy_customers 
        GROUP BY customer_code 
        HAVING COUNT(*) > 1
        LIMIT 10
      `);

      if (duplicateCustomers.rows.length > 0) {
        issues.push({
          type: 'duplicate_customer_codes',
          severity: 'high',
          count: duplicateCustomers.rows.length,
          impact: 'Migration will fail without deduplication'
        });
      }

      // Check for invalid email formats
      const invalidEmails = await this.sourceDb.query(`
        SELECT COUNT(*) as count 
        FROM legacy_customers 
        WHERE email NOT LIKE '%@%.%' OR email IS NULL
      `);

      if (parseInt(invalidEmails.rows[0].count) > 0) {
        issues.push({
          type: 'invalid_emails',
          severity: 'medium',
          count: parseInt(invalidEmails.rows[0].count),
          impact: 'Email validation may fail'
        });
      }

      // Check for missing required fields
      const missingSupplierNames = await this.sourceDb.query(`
        SELECT COUNT(*) as count 
        FROM legacy_suppliers 
        WHERE company_name IS NULL OR company_name = ''
      `);

      if (parseInt(missingSupplierNames.rows[0].count) > 0) {
        issues.push({
          type: 'missing_supplier_names',
          severity: 'high',
          count: parseInt(missingSupplierNames.rows[0].count),
          impact: 'Records cannot be migrated without company names'
        });
      }

    } catch (error) {
      issues.push({
        type: 'analysis_error',
        severity: 'high',
        error: error.message,
        impact: 'Unable to complete data quality analysis'
      });
    }

    return {
      issues,
      overallQuality: issues.length === 0 ? 'excellent' : 
                     issues.filter(i => i.severity === 'high').length > 0 ? 'poor' : 'good'
    };
  }

  async analyzeRelationships() {
    console.log('🔗 Analyzing relationships...');
    
    const relationships = {
      valid: [],
      broken: [],
      missing: []
    };

    try {
      // Check supplier-product relationships
      const supplierProductCheck = await this.sourceDb.query(`
        SELECT 
          COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END) as valid_relationships,
          COUNT(CASE WHEN s.id IS NULL AND p.supplier_id IS NOT NULL THEN 1 END) as broken_relationships
        FROM legacy_products p
        LEFT JOIN legacy_suppliers s ON p.supplier_id = s.id
      `);

      const validCount = parseInt(supplierProductCheck.rows[0].valid_relationships);
      const brokenCount = parseInt(supplierProductCheck.rows[0].broken_relationships);

      if (brokenCount > 0) {
        relationships.broken.push({
          type: 'product_supplier',
          count: brokenCount,
          description: 'Products referencing non-existent suppliers'
        });
      }

      relationships.valid.push({
        type: 'product_supplier',
        count: validCount,
        description: 'Valid product-supplier relationships'
      });

    } catch (error) {
      relationships.missing.push({
        type: 'analysis_error',
        error: error.message
      });
    }

    return relationships;
  }

  // ==================== TIMING CALCULATIONS ====================

  calculateTimingEstimates(dataAnalysis) {
    console.log('⏱️ Calculating timing estimates...');

    const estimates = {
      byTable: {},
      phases: {},
      total: {}
    };

    // Calculate per-table timing
    for (const [legacyTable, data] of Object.entries(dataAnalysis.tables)) {
      const targetTable = this.mapLegacyToTargetTable(legacyTable);
      const benchmark = PERFORMANCE_BENCHMARKS[targetTable];
      
      if (benchmark && data.recordCount > 0) {
        const batchSize = this.getBatchSizeForTable(targetTable, data);
        const batches = Math.ceil(data.recordCount / batchSize);
        const complexityMultiplier = this.getComplexityMultiplier(data.estimatedComplexity);
        
        const baseTimePerBatch = (batchSize / 1000) * benchmark.total;
        const adjustedTimePerBatch = baseTimePerBatch * complexityMultiplier;
        const totalTime = adjustedTimePerBatch * batches;
        
        estimates.byTable[targetTable] = {
          records: data.recordCount,
          batchSize,
          batches,
          timePerBatch: Math.round(adjustedTimePerBatch),
          totalTime: Math.round(totalTime),
          phases: {
            read: Math.round((adjustedTimePerBatch * benchmark.read / benchmark.total) * batches),
            transform: Math.round((adjustedTimePerBatch * benchmark.transform / benchmark.total) * batches),
            write: Math.round((adjustedTimePerBatch * benchmark.write / benchmark.total) * batches),
            validate: Math.round((adjustedTimePerBatch * benchmark.validate / benchmark.total) * batches)
          }
        };
      }
    }

    // Calculate phase timing
    estimates.phases = {
      preparation: {
        validation: 300,    // 5 minutes
        backup: 600,       // 10 minutes
        setup: 180,        // 3 minutes
        total: 1080        // 18 minutes
      },
      migration: {
        customers: estimates.byTable.customers?.totalTime || 0,
        suppliers: estimates.byTable.suppliers?.totalTime || 0,
        products: estimates.byTable.products?.totalTime || 0,
        inventory: estimates.byTable.inventory?.totalTime || 0,
        priceLists: estimates.byTable.priceLists?.totalTime || 0,
        priceListItems: estimates.byTable.priceListItems?.totalTime || 0,
        uploadHistory: estimates.byTable.uploadHistory?.totalTime || 0
      },
      validation: {
        integrity: 600,    // 10 minutes
        business: 300,     // 5 minutes
        performance: 180,  // 3 minutes
        total: 1080        // 18 minutes
      },
      cleanup: {
        indexing: 300,     // 5 minutes
        statistics: 120,   // 2 minutes
        monitoring: 60,    // 1 minute
        total: 480         // 8 minutes
      }
    };

    // Calculate total timing
    const migrationTime = Object.values(estimates.phases.migration).reduce((sum, time) => sum + time, 0);
    estimates.total = {
      preparation: estimates.phases.preparation.total,
      migration: migrationTime,
      validation: estimates.phases.validation.total,
      cleanup: estimates.phases.cleanup.total,
      total: estimates.phases.preparation.total + migrationTime + estimates.phases.validation.total + estimates.phases.cleanup.total,
      
      // Human readable
      totalMinutes: Math.round((estimates.phases.preparation.total + migrationTime + estimates.phases.validation.total + estimates.phases.cleanup.total) / 60),
      totalHours: Math.round((estimates.phases.preparation.total + migrationTime + estimates.phases.validation.total + estimates.phases.cleanup.total) / 3600 * 10) / 10
    };

    return estimates;
  }

  mapLegacyToTargetTable(legacyTable) {
    const mapping = {
      'legacy_customers': 'customers',
      'legacy_vendors': 'suppliers',
      'legacy_suppliers': 'suppliers',
      'legacy_products': 'products',
      'legacy_inventory': 'inventory',
      'legacy_price_lists': 'priceLists',
      'legacy_price_list_items': 'priceListItems',
      'legacy_upload_history': 'uploadHistory'
    };
    return mapping[legacyTable] || 'unknown';
  }

  getBatchSizeForTable(tableName, data) {
    const { batchSizes } = this.config;
    
    if (data.sizeBytes > 1000000000) { // > 1GB
      return batchSizes.small;
    } else if (data.sizeBytes > 100000000) { // > 100MB
      return batchSizes.medium;
    } else {
      return batchSizes.large;
    }
  }

  getComplexityMultiplier(complexity) {
    switch (complexity) {
      case 'low': return 1.0;
      case 'medium': return 1.5;
      case 'high': return 2.0;
      default: return 1.2;
    }
  }

  // ==================== RESOURCE REQUIREMENTS ====================

  calculateResourceRequirements(dataAnalysis) {
    console.log('💾 Calculating resource requirements...');

    const totalRecords = Object.values(dataAnalysis.tables)
      .reduce((sum, table) => sum + table.recordCount, 0);
    
    const totalSizeBytes = Object.values(dataAnalysis.tables)
      .reduce((sum, table) => sum + table.sizeBytes, 0);

    return {
      database: {
        connections: {
          source: 2, // Read connections
          target: 3, // Write connections
          monitoring: 1
        },
        memory: {
          recommended: '4GB',
          minimum: '2GB',
          buffers: Math.min(Math.max(Math.round(totalSizeBytes / 1000000), 100), 1000) + 'MB'
        },
        storage: {
          temporary: this.formatBytes(totalSizeBytes * 0.2), // 20% for temp files
          backup: this.formatBytes(totalSizeBytes * 1.5),    // 150% for backup
          logs: '500MB'
        }
      },
      network: {
        bandwidth: 'Minimum 100Mbps recommended',
        latency: 'Maximum 50ms between source and target',
        stability: 'Stable connection required for ' + Math.round(this.timingEstimates?.total?.totalHours || 2) + ' hours'
      },
      compute: {
        cpu: {
          cores: Math.min(Math.max(Math.ceil(totalRecords / 100000), 2), 8),
          utilization: '60-80% expected during migration'
        },
        memory: {
          application: '2-4GB for migration processes',
          database: '2-4GB for database operations',
          total: '4-8GB recommended'
        }
      },
      monitoring: {
        diskSpace: '1GB for logs and reports',
        retention: '30 days recommended for troubleshooting'
      }
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ==================== RISK ASSESSMENT ====================

  async performRiskAssessment(dataAnalysis) {
    console.log('⚠️ Performing risk assessment...');

    const risks = [];

    // Data volume risk
    const totalRecords = Object.values(dataAnalysis.tables)
      .reduce((sum, table) => sum + table.recordCount, 0);
    
    if (totalRecords > 1000000) {
      risks.push({
        category: 'Data Volume',
        level: 'High',
        description: `Large dataset (${totalRecords.toLocaleString()} records) increases migration time and complexity`,
        mitigation: 'Use parallel processing and chunked migration with progress monitoring',
        impact: 'Extended downtime, potential timeouts'
      });
    }

    // Data quality risk
    if (dataAnalysis.dataQuality.overallQuality === 'poor') {
      risks.push({
        category: 'Data Quality',
        level: 'High',
        description: 'Poor data quality detected in source system',
        mitigation: 'Clean data before migration, implement validation rules',
        impact: 'Migration failures, data corruption'
      });
    }

    // Relationship integrity risk
    const brokenRelationships = dataAnalysis.relationships.broken.length;
    if (brokenRelationships > 0) {
      risks.push({
        category: 'Data Integrity',
        level: 'Medium',
        description: `${brokenRelationships} broken relationships detected`,
        mitigation: 'Fix orphaned records before migration',
        impact: 'Foreign key constraint violations'
      });
    }

    // Timing risk
    if (this.timingEstimates?.total?.totalHours > 4) {
      risks.push({
        category: 'Duration',
        level: 'Medium',
        description: `Extended migration window (${this.timingEstimates.total.totalHours} hours)`,
        mitigation: 'Schedule during maintenance window, implement checkpoints',
        impact: 'Extended system downtime'
      });
    }

    // Complexity risk
    const complexTables = Object.values(dataAnalysis.tables)
      .filter(table => table.estimatedComplexity === 'high').length;
    
    if (complexTables > 2) {
      risks.push({
        category: 'Complexity',
        level: 'Medium',
        description: `${complexTables} tables with high complexity`,
        mitigation: 'Thorough testing, additional validation steps',
        impact: 'Increased likelihood of transformation errors'
      });
    }

    return {
      overall: risks.length === 0 ? 'Low' : 
               risks.some(r => r.level === 'High') ? 'High' : 'Medium',
      risks,
      recommendations: this.generateRiskRecommendations(risks)
    };
  }

  generateRiskRecommendations(risks) {
    const recommendations = [];

    if (risks.some(r => r.level === 'High')) {
      recommendations.push('Perform additional data cleanup before migration');
      recommendations.push('Conduct full staging environment testing');
      recommendations.push('Prepare detailed rollback procedures');
    }

    if (risks.some(r => r.category === 'Duration')) {
      recommendations.push('Schedule migration during extended maintenance window');
      recommendations.push('Implement progress checkpoints for resumability');
    }

    if (risks.some(r => r.category === 'Data Quality')) {
      recommendations.push('Run data validation suite before migration');
      recommendations.push('Implement data cleaning scripts');
    }

    if (recommendations.length === 0) {
      recommendations.push('Migration ready to proceed with standard procedures');
    }

    return recommendations;
  }

  // ==================== EXECUTION PLAN GENERATION ====================

  generateDetailedExecutionPlan(dataAnalysis) {
    console.log('📋 Generating detailed execution plan...');

    return {
      overview: {
        totalSteps: 15,
        estimatedDuration: this.timingEstimates?.total?.totalHours + ' hours',
        checkpoints: 5,
        rollbackPoints: 3
      },
      phases: [
        {
          name: 'Pre-Migration Preparation',
          duration: '15-20 minutes',
          steps: [
            {
              step: 1,
              name: 'Environment Verification',
              description: 'Verify source and target database connectivity',
              duration: '2 minutes',
              critical: true,
              commands: [
                'npm run db:check-source',
                'npm run db:check-target',
                'npm run db:verify-schema'
              ]
            },
            {
              step: 2,
              name: 'Data Quality Validation',
              description: 'Run comprehensive data validation on source',
              duration: '5 minutes',
              critical: true,
              commands: [
                'npm run migration:validate-source',
                'npm run migration:check-integrity'
              ]
            },
            {
              step: 3,
              name: 'Backup Creation',
              description: 'Create backup of target database',
              duration: '10 minutes',
              critical: true,
              commands: [
                'npm run db:backup',
                'npm run db:verify-backup'
              ]
            },
            {
              step: 4,
              name: 'Migration Setup',
              description: 'Initialize migration tools and monitoring',
              duration: '3 minutes',
              critical: false,
              commands: [
                'npm run migration:init',
                'npm run migration:start-monitoring'
              ]
            }
          ]
        },
        {
          name: 'Core Data Migration',
          duration: this.formatMinutes(this.timingEstimates?.phases?.migration),
          steps: [
            {
              step: 5,
              name: 'Customer Migration',
              description: 'Migrate customer data from legacy system',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.customers?.totalTime),
              critical: true,
              checkpoint: true,
              commands: [
                'npm run migration:customers',
                'npm run migration:validate-customers'
              ]
            },
            {
              step: 6,
              name: 'Supplier Migration',
              description: 'Migrate and consolidate vendor/supplier data',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.suppliers?.totalTime),
              critical: true,
              checkpoint: true,
              commands: [
                'npm run migration:suppliers',
                'npm run migration:validate-suppliers'
              ]
            },
            {
              step: 7,
              name: 'Product Migration',
              description: 'Migrate product catalog with supplier relationships',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.products?.totalTime),
              critical: true,
              parallel: false,
              commands: [
                'npm run migration:products',
                'npm run migration:validate-products'
              ]
            },
            {
              step: 8,
              name: 'Inventory Migration',
              description: 'Migrate inventory data with current stock levels',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.inventory?.totalTime),
              critical: true,
              commands: [
                'npm run migration:inventory',
                'npm run migration:validate-inventory'
              ]
            },
            {
              step: 9,
              name: 'Price List Migration',
              description: 'Migrate price lists and pricing history',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.priceLists?.totalTime),
              critical: true,
              commands: [
                'npm run migration:price-lists',
                'npm run migration:price-list-items',
                'npm run migration:validate-pricing'
              ]
            },
            {
              step: 10,
              name: 'Upload History Migration',
              description: 'Migrate file upload history and metadata',
              duration: this.formatMinutes(this.timingEstimates?.byTable?.uploadHistory?.totalTime),
              critical: false,
              commands: [
                'npm run migration:upload-history',
                'npm run migration:validate-uploads'
              ]
            }
          ]
        },
        {
          name: 'Post-Migration Validation',
          duration: '15-20 minutes',
          steps: [
            {
              step: 11,
              name: 'Data Integrity Validation',
              description: 'Comprehensive validation of migrated data',
              duration: '10 minutes',
              critical: true,
              commands: [
                'npm run migration:validate-all',
                'npm run migration:check-relationships',
                'npm run migration:verify-counts'
              ]
            },
            {
              step: 12,
              name: 'Business Rule Validation',
              description: 'Validate business rules and constraints',
              duration: '5 minutes',
              critical: true,
              commands: [
                'npm run migration:validate-business-rules',
                'npm run migration:check-data-quality'
              ]
            },
            {
              step: 13,
              name: 'Performance Validation',
              description: 'Verify database performance and indexing',
              duration: '3 minutes',
              critical: false,
              commands: [
                'npm run migration:check-performance',
                'npm run migration:validate-indexes'
              ]
            }
          ]
        },
        {
          name: 'Finalization',
          duration: '8-10 minutes',
          steps: [
            {
              step: 14,
              name: 'Statistics Update',
              description: 'Update database statistics and optimize',
              duration: '5 minutes',
              critical: false,
              commands: [
                'npm run db:analyze',
                'npm run db:vacuum',
                'npm run db:update-stats'
              ]
            },
            {
              step: 15,
              name: 'Migration Report',
              description: 'Generate final migration report and cleanup',
              duration: '3 minutes',
              critical: false,
              commands: [
                'npm run migration:generate-report',
                'npm run migration:cleanup',
                'npm run migration:stop-monitoring'
              ]
            }
          ]
        }
      ]
    };
  }

  formatMinutes(seconds) {
    if (!seconds) return '0 minutes';
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours ${minutes % 60} minutes`;
  }

  // ==================== MONITORING PLAN ====================

  createMonitoringPlan() {
    return {
      metrics: [
        'Records processed per minute',
        'Database connection pool utilization',
        'Memory usage during migration',
        'Error rate and failure patterns',
        'Network throughput and latency'
      ],
      alerts: [
        {
          condition: 'Error rate > 5%',
          action: 'Pause migration and investigate',
          severity: 'critical'
        },
        {
          condition: 'Processing rate drops > 50%',
          action: 'Check resource utilization',
          severity: 'warning'
        },
        {
          condition: 'Database connections exhausted',
          action: 'Restart migration with reduced concurrency',
          severity: 'critical'
        }
      ],
      checkpoints: [
        'After customer migration completion',
        'After supplier migration completion', 
        'After all core data migration',
        'After validation completion'
      ],
      logging: {
        level: 'INFO',
        destinations: ['console', 'file', 'database'],
        retention: '30 days'
      }
    };
  }

  // ==================== ROLLBACK PLAN ====================

  createRollbackPlan() {
    return {
      strategy: 'Point-in-time restore from backup',
      triggers: [
        'Critical validation failure',
        'Data corruption detected',
        'Migration timeout exceeded',
        'Manual intervention required'
      ],
      steps: [
        {
          step: 1,
          name: 'Stop Migration',
          description: 'Immediately stop all migration processes',
          duration: '1 minute'
        },
        {
          step: 2,
          name: 'Assess Impact',
          description: 'Evaluate extent of changes and data integrity',
          duration: '5 minutes'
        },
        {
          step: 3,
          name: 'Restore Backup',
          description: 'Restore target database from pre-migration backup',
          duration: '15-30 minutes'
        },
        {
          step: 4,
          name: 'Verify Restore',
          description: 'Validate restored database integrity',
          duration: '5 minutes'
        },
        {
          step: 5,
          name: 'Document Issues',
          description: 'Document rollback reason and lessons learned',
          duration: '10 minutes'
        }
      ],
      testing: {
        frequency: 'Before each migration',
        scope: 'Full restore verification',
        automation: 'Scripted rollback procedures'
      }
    };
  }

  // ==================== RECOMMENDATIONS ====================

  generateRecommendations() {
    const recommendations = [];

    // Timing recommendations
    if (this.timingEstimates?.total?.totalHours > 6) {
      recommendations.push({
        category: 'Timing',
        priority: 'High',
        recommendation: 'Consider splitting migration into multiple phases',
        rationale: 'Extended migration window increases risk of issues'
      });
    }

    // Risk-based recommendations
    if (this.riskAssessment?.overall === 'High') {
      recommendations.push({
        category: 'Risk Management',
        priority: 'Critical',
        recommendation: 'Perform additional staging environment testing',
        rationale: 'High-risk migration requires thorough validation'
      });
    }

    // Resource recommendations
    const totalRecords = Object.values(this.executionPlan?.analysis?.tables || {})
      .reduce((sum, table) => sum + (table.recordCount || 0), 0);
    
    if (totalRecords > 500000) {
      recommendations.push({
        category: 'Performance',
        priority: 'Medium',
        recommendation: 'Use parallel processing for independent tables',
        rationale: 'Large dataset benefits from concurrent processing'
      });
    }

    // Default recommendation
    if (recommendations.length === 0) {
      recommendations.push({
        category: 'General',
        priority: 'Low',
        recommendation: 'Proceed with standard migration procedures',
        rationale: 'Low-risk migration suitable for standard approach'
      });
    }

    return recommendations;
  }
}

// ==================== UTILITY FUNCTIONS ====================

export async function generateQuickEstimate(sourceDb, recordCounts) {
  const estimates = {};
  
  for (const [table, count] of Object.entries(recordCounts)) {
    const benchmark = PERFORMANCE_BENCHMARKS[table];
    if (benchmark) {
      const timeInSeconds = (count / 1000) * benchmark.total;
      estimates[table] = {
        records: count,
        estimatedSeconds: Math.round(timeInSeconds),
        estimatedMinutes: Math.round(timeInSeconds / 60)
      };
    }
  }

  const totalSeconds = Object.values(estimates).reduce((sum, est) => sum + est.estimatedSeconds, 0);
  
  return {
    byTable: estimates,
    total: {
      seconds: totalSeconds,
      minutes: Math.round(totalSeconds / 60),
      hours: Math.round(totalSeconds / 3600 * 10) / 10
    }
  };
}

export function createMigrationCommand(plan) {
  const commands = [];
  
  for (const phase of plan.execution.phases) {
    for (const step of phase.steps) {
      commands.push({
        step: step.step,
        name: step.name,
        commands: step.commands,
        critical: step.critical,
        checkpoint: step.checkpoint || false
      });
    }
  }
  
  return {
    totalSteps: commands.length,
    commands,
    estimatedDuration: plan.timing.total.totalHours + ' hours'
  };
}

export default MigrationExecutionPlanner;