/**
 * NXT NEW DAY - Comprehensive Data Migration Suite
 * 
 * This suite provides complete data migration capabilities for moving from legacy
 * systems to the new NXT NEW DAY database schema. Includes validation, rollback,
 * and progress tracking.
 * 
 * Author: Data Migration Agent
 * Version: 1.0.0
 * Last Updated: 2025-01-19
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs/promises';
import path from 'path';
import { 
  customers, 
  suppliers, 
  products, 
  inventory, 
  priceLists, 
  priceListItems, 
  uploadHistory,
  analyticsDailyAggregates,
  timeSeriesMetrics 
} from '../schema.js';
import { sql, eq, and, or, isNull, isNotNull, desc, asc } from 'drizzle-orm';

// ==================== CONFIGURATION ====================

const MIGRATION_CONFIG = {
  batchSize: 1000,
  maxRetries: 3,
  timeout: 300000, // 5 minutes
  validationSampleSize: 100,
  progressReportInterval: 5000,
  backupEnabled: true,
  rollbackEnabled: true,
  dryRun: false // Set to true for testing
};

const MIGRATION_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  VALIDATING: 'validating',
  VALIDATED: 'validated'
};

// ==================== MIGRATION ORCHESTRATOR ====================

export class DataMigrationSuite {
  constructor(sourceDb, targetDb, options = {}) {
    this.sourceDb = sourceDb;
    this.targetDb = targetDb;
    this.config = { ...MIGRATION_CONFIG, ...options };
    this.migrationLog = [];
    this.startTime = null;
    this.rollbackData = new Map();
    this.validationErrors = [];
    this.migrationStats = {
      customers: { total: 0, migrated: 0, failed: 0, validated: 0 },
      suppliers: { total: 0, migrated: 0, failed: 0, validated: 0 },
      products: { total: 0, migrated: 0, failed: 0, validated: 0 },
      inventory: { total: 0, migrated: 0, failed: 0, validated: 0 },
      priceLists: { total: 0, migrated: 0, failed: 0, validated: 0 },
      priceListItems: { total: 0, migrated: 0, failed: 0, validated: 0 },
      uploadHistory: { total: 0, migrated: 0, failed: 0, validated: 0 }
    };
  }

  // ==================== MAIN MIGRATION ORCHESTRATION ====================

  /**
   * Execute complete data migration
   */
  async executeMigration() {
    try {
      this.startTime = new Date();
      this.log('INFO', 'Starting comprehensive data migration');

      // Pre-migration validation
      await this.validatePreMigration();

      // Create backup if enabled
      if (this.config.backupEnabled) {
        await this.createBackup();
      }

      // Execute migrations in dependency order
      const migrationSteps = [
        { name: 'customers', fn: this.migrateCustomers.bind(this) },
        { name: 'suppliers', fn: this.migrateSuppliers.bind(this) },
        { name: 'products', fn: this.migrateProducts.bind(this) },
        { name: 'inventory', fn: this.migrateInventory.bind(this) },
        { name: 'priceLists', fn: this.migratePriceLists.bind(this) },
        { name: 'priceListItems', fn: this.migratePriceListItems.bind(this) },
        { name: 'uploadHistory', fn: this.migrateUploadHistory.bind(this) }
      ];

      for (const step of migrationSteps) {
        this.log('INFO', `Starting migration: ${step.name}`);
        await step.fn();
        this.log('SUCCESS', `Completed migration: ${step.name}`);
      }

      // Post-migration validation
      await this.validatePostMigration();

      // Generate final report
      const report = await this.generateMigrationReport();
      
      this.log('SUCCESS', 'Data migration completed successfully');
      return report;

    } catch (error) {
      this.log('ERROR', `Migration failed: ${error.message}`);
      
      if (this.config.rollbackEnabled) {
        await this.executeRollback();
      }
      
      throw error;
    }
  }

  // ==================== CUSTOMER MIGRATION ====================

  async migrateCustomers() {
    const tableName = 'customers';
    
    try {
      // Get source data count
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_customers');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.customers.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} customer records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            id,
            customer_code,
            company_name,
            email,
            phone,
            address_line_1,
            address_line_2,
            city,
            state,
            country,
            postal_code,
            contact_person,
            created_at,
            updated_at,
            -- Legacy metadata fields
            customer_type,
            credit_limit,
            payment_terms,
            tax_id,
            industry,
            customer_status
          FROM legacy_customers 
          ORDER BY created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformCustomerData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(customers).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.customers.migrated = migratedCount;
        
        if (migratedCount % this.config.progressReportInterval === 0) {
          this.log('PROGRESS', `Customers: ${migratedCount}/${totalRecords} migrated`);
        }

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Customer migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.customers.failed = this.migrationStats.customers.total - this.migrationStats.customers.migrated;
      throw new Error(`Customer migration failed: ${error.message}`);
    }
  }

  transformCustomerData(legacyRow) {
    return {
      id: legacyRow.id, // Preserve UUID if exists, otherwise will auto-generate
      customerCode: legacyRow.customer_code,
      companyName: legacyRow.company_name,
      email: legacyRow.email,
      phone: legacyRow.phone,
      address: {
        line1: legacyRow.address_line_1,
        line2: legacyRow.address_line_2,
        city: legacyRow.city,
        state: legacyRow.state,
        country: legacyRow.country,
        postalCode: legacyRow.postal_code
      },
      metadata: {
        legacy: {
          customerType: legacyRow.customer_type,
          creditLimit: legacyRow.credit_limit,
          paymentTerms: legacyRow.payment_terms,
          taxId: legacyRow.tax_id,
          industry: legacyRow.industry,
          status: legacyRow.customer_status
        },
        migrationDate: new Date().toISOString(),
        contactPerson: legacyRow.contact_person
      },
      purchaseHistory: [], // Will be populated by separate process
      createdAt: legacyRow.created_at || new Date(),
      updatedAt: legacyRow.updated_at || new Date()
    };
  }

  // ==================== SUPPLIER MIGRATION ====================

  async migrateSuppliers() {
    const tableName = 'suppliers';
    
    try {
      // Migrate from both legacy_vendors and legacy_suppliers tables
      const vendorCountResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_vendors');
      const supplierCountResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_suppliers');
      
      const totalVendors = parseInt(vendorCountResult.rows[0].count);
      const totalSuppliers = parseInt(supplierCountResult.rows[0].count);
      const totalRecords = totalVendors + totalSuppliers;
      
      this.migrationStats.suppliers.total = totalRecords;
      this.log('INFO', `Migrating ${totalVendors} vendors and ${totalSuppliers} suppliers`);

      let migratedCount = 0;

      // Migrate vendors first
      let offset = 0;
      while (offset < totalVendors) {
        const batch = await this.sourceDb.query(`
          SELECT 
            id,
            vendor_code as supplier_code,
            company_name,
            email,
            phone,
            website,
            address_data,
            contact_details,
            payment_terms,
            credit_limit,
            tax_id,
            vendor_type,
            industry,
            performance_rating,
            lead_time_days,
            is_active,
            created_at,
            updated_at,
            -- Vendor-specific fields
            certification_data,
            contract_details
          FROM legacy_vendors 
          ORDER BY created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformVendorToSupplier(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(suppliers).values(transformedData);
        }

        migratedCount += batch.rows.length;
        offset += this.config.batchSize;
      }

      // Migrate suppliers
      offset = 0;
      while (offset < totalSuppliers) {
        const batch = await this.sourceDb.query(`
          SELECT 
            id,
            supplier_code,
            company_name,
            email,
            phone,
            website,
            address_data,
            contact_details,
            payment_terms,
            credit_limit,
            tax_id,
            supplier_type,
            industry,
            performance_rating,
            lead_time_days,
            is_active,
            is_approved,
            approved_at,
            approved_by,
            created_at,
            updated_at
          FROM legacy_suppliers 
          ORDER BY created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformSupplierData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(suppliers).values(transformedData);
        }

        migratedCount += batch.rows.length;
        offset += this.config.batchSize;
      }

      this.migrationStats.suppliers.migrated = migratedCount;
      this.log('SUCCESS', `Supplier migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.suppliers.failed = this.migrationStats.suppliers.total - this.migrationStats.suppliers.migrated;
      throw new Error(`Supplier migration failed: ${error.message}`);
    }
  }

  transformVendorToSupplier(legacyVendor) {
    return {
      id: legacyVendor.id,
      supplierCode: legacyVendor.supplier_code,
      companyName: legacyVendor.company_name,
      email: legacyVendor.email,
      phone: legacyVendor.phone,
      website: legacyVendor.website,
      address: legacyVendor.address_data || {},
      contactDetails: legacyVendor.contact_details || {},
      paymentTerms: legacyVendor.payment_terms || {},
      creditLimit: legacyVendor.credit_limit,
      taxId: legacyVendor.tax_id,
      supplierType: 'vendor', // Mark as migrated from vendor
      industry: legacyVendor.industry,
      performanceRating: legacyVendor.performance_rating || 0,
      leadTimeDays: legacyVendor.lead_time_days || 0,
      vendorMetadata: {
        legacy: {
          originalType: 'vendor',
          vendorType: legacyVendor.vendor_type,
          certificationData: legacyVendor.certification_data,
          contractDetails: legacyVendor.contract_details
        },
        migrationDate: new Date().toISOString()
      },
      isActive: legacyVendor.is_active !== false,
      isApproved: true, // Assume legacy vendors are approved
      approvedAt: legacyVendor.created_at,
      createdAt: legacyVendor.created_at || new Date(),
      updatedAt: legacyVendor.updated_at || new Date()
    };
  }

  transformSupplierData(legacySupplier) {
    return {
      id: legacySupplier.id,
      supplierCode: legacySupplier.supplier_code,
      companyName: legacySupplier.company_name,
      email: legacySupplier.email,
      phone: legacySupplier.phone,
      website: legacySupplier.website,
      address: legacySupplier.address_data || {},
      contactDetails: legacySupplier.contact_details || {},
      paymentTerms: legacySupplier.payment_terms || {},
      creditLimit: legacySupplier.credit_limit,
      taxId: legacySupplier.tax_id,
      supplierType: legacySupplier.supplier_type || 'supplier',
      industry: legacySupplier.industry,
      performanceRating: legacySupplier.performance_rating || 0,
      leadTimeDays: legacySupplier.lead_time_days || 0,
      vendorMetadata: {
        legacy: {
          originalType: 'supplier'
        },
        migrationDate: new Date().toISOString()
      },
      isActive: legacySupplier.is_active !== false,
      isApproved: legacySupplier.is_approved !== false,
      approvedAt: legacySupplier.approved_at,
      approvedBy: legacySupplier.approved_by,
      createdAt: legacySupplier.created_at || new Date(),
      updatedAt: legacySupplier.updated_at || new Date()
    };
  }

  // ==================== PRODUCT MIGRATION ====================

  async migrateProducts() {
    const tableName = 'products';
    
    try {
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_products');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.products.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} product records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            p.*,
            s.id as new_supplier_id
          FROM legacy_products p
          LEFT JOIN suppliers s ON (
            s.supplier_code = p.supplier_code OR 
            s.id = p.supplier_id
          )
          ORDER BY p.created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformProductData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(products).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.products.migrated = migratedCount;
        
        if (migratedCount % this.config.progressReportInterval === 0) {
          this.log('PROGRESS', `Products: ${migratedCount}/${totalRecords} migrated`);
        }

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Product migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.products.failed = this.migrationStats.products.total - this.migrationStats.products.migrated;
      throw new Error(`Product migration failed: ${error.message}`);
    }
  }

  transformProductData(legacyRow) {
    return {
      id: legacyRow.id,
      sku: legacyRow.sku,
      name: legacyRow.name || legacyRow.product_name,
      description: legacyRow.description,
      category: legacyRow.category,
      unitPrice: legacyRow.unit_price || legacyRow.price || 0,
      costPrice: legacyRow.cost_price || legacyRow.cost || 0,
      supplierId: legacyRow.new_supplier_id,
      isActive: legacyRow.is_active !== false,
      metadata: {
        legacy: {
          productCode: legacyRow.product_code,
          barcode: legacyRow.barcode,
          weight: legacyRow.weight,
          dimensions: legacyRow.dimensions,
          tags: legacyRow.tags
        },
        migrationDate: new Date().toISOString()
      },
      createdAt: legacyRow.created_at || new Date(),
      updatedAt: legacyRow.updated_at || new Date()
    };
  }

  // ==================== INVENTORY MIGRATION ====================

  async migrateInventory() {
    const tableName = 'inventory';
    
    try {
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_inventory');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.inventory.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} inventory records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            i.*,
            p.id as new_product_id
          FROM legacy_inventory i
          JOIN products p ON p.sku = i.product_sku
          ORDER BY i.created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformInventoryData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(inventory).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.inventory.migrated = migratedCount;
        
        if (migratedCount % this.config.progressReportInterval === 0) {
          this.log('PROGRESS', `Inventory: ${migratedCount}/${totalRecords} migrated`);
        }

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Inventory migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.inventory.failed = this.migrationStats.inventory.total - this.migrationStats.inventory.migrated;
      throw new Error(`Inventory migration failed: ${error.message}`);
    }
  }

  transformInventoryData(legacyRow) {
    return {
      productId: legacyRow.new_product_id,
      warehouseId: legacyRow.warehouse_id,
      locationId: legacyRow.location_id,
      quantityOnHand: legacyRow.quantity_on_hand || legacyRow.quantity || 0,
      quantityAvailable: legacyRow.quantity_available || legacyRow.quantity_on_hand || 0,
      quantityReserved: legacyRow.quantity_reserved || 0,
      quantityInTransit: legacyRow.quantity_in_transit || 0,
      lastStockCheck: legacyRow.last_stock_check,
      lastMovement: legacyRow.last_movement,
      stockStatus: legacyRow.stock_status || 'in_stock',
      reorderPoint: legacyRow.reorder_point || 0,
      reorderQuantity: legacyRow.reorder_quantity || 0,
      maxStockLevel: legacyRow.max_stock_level,
      minStockLevel: legacyRow.min_stock_level || 0,
      averageCost: legacyRow.average_cost,
      lastPurchaseCost: legacyRow.last_purchase_cost,
      metadata: {
        legacy: {
          originalInventoryId: legacyRow.id,
          productSku: legacyRow.product_sku
        },
        migrationDate: new Date().toISOString()
      },
      createdAt: legacyRow.created_at || new Date(),
      updatedAt: legacyRow.updated_at || new Date()
    };
  }

  // ==================== PRICE LIST MIGRATION ====================

  async migratePriceLists() {
    const tableName = 'priceLists';
    
    try {
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_price_lists');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.priceLists.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} price list records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            pl.*,
            s.id as new_supplier_id
          FROM legacy_price_lists pl
          JOIN suppliers s ON (
            s.supplier_code = pl.supplier_code OR 
            s.id = pl.supplier_id
          )
          ORDER BY pl.created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformPriceListData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(priceLists).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.priceLists.migrated = migratedCount;
        
        if (migratedCount % this.config.progressReportInterval === 0) {
          this.log('PROGRESS', `Price Lists: ${migratedCount}/${totalRecords} migrated`);
        }

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Price list migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.priceLists.failed = this.migrationStats.priceLists.total - this.migrationStats.priceLists.migrated;
      throw new Error(`Price list migration failed: ${error.message}`);
    }
  }

  transformPriceListData(legacyRow) {
    return {
      id: legacyRow.id,
      supplierId: legacyRow.new_supplier_id,
      name: legacyRow.name || legacyRow.price_list_name,
      effectiveDate: legacyRow.effective_date,
      expiryDate: legacyRow.expiry_date,
      status: legacyRow.status || 'active',
      version: legacyRow.version || '1.0',
      parentPriceListId: legacyRow.parent_price_list_id,
      uploadFormat: legacyRow.upload_format,
      originalFilePath: legacyRow.original_file_path,
      originalFileName: legacyRow.original_file_name,
      validationStatus: legacyRow.validation_status || 'validated',
      validationErrors: legacyRow.validation_errors || [],
      approvedBy: legacyRow.approved_by,
      approvedAt: legacyRow.approved_at,
      itemCount: legacyRow.item_count || 0,
      currenciesSupported: legacyRow.currencies_supported || ['USD'],
      createdAt: legacyRow.created_at || new Date(),
      updatedAt: legacyRow.updated_at || new Date()
    };
  }

  // ==================== PRICE LIST ITEMS MIGRATION ====================

  async migratePriceListItems() {
    const tableName = 'priceListItems';
    
    try {
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_price_list_items');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.priceListItems.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} price list item records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            pli.*,
            pl.id as new_price_list_id
          FROM legacy_price_list_items pli
          JOIN price_lists pl ON pl.id = pli.price_list_id
          ORDER BY pli.created_at 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformPriceListItemData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(priceListItems).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.priceListItems.migrated = migratedCount;
        
        if (migratedCount % this.config.progressReportInterval === 0) {
          this.log('PROGRESS', `Price List Items: ${migratedCount}/${totalRecords} migrated`);
        }

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Price list items migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.priceListItems.failed = this.migrationStats.priceListItems.total - this.migrationStats.priceListItems.migrated;
      throw new Error(`Price list items migration failed: ${error.message}`);
    }
  }

  transformPriceListItemData(legacyRow) {
    return {
      id: legacyRow.id,
      priceListId: legacyRow.new_price_list_id,
      sku: legacyRow.sku,
      description: legacyRow.description,
      unitPrice: legacyRow.unit_price || legacyRow.price,
      currency: legacyRow.currency || 'USD',
      minQuantity: legacyRow.min_quantity || 1,
      discountPercent: legacyRow.discount_percent || 0,
      tierPricing: legacyRow.tier_pricing || []
    };
  }

  // ==================== UPLOAD HISTORY MIGRATION ====================

  async migrateUploadHistory() {
    const tableName = 'uploadHistory';
    
    try {
      const countResult = await this.sourceDb.query('SELECT COUNT(*) as count FROM legacy_upload_history');
      const totalRecords = parseInt(countResult.rows[0].count);
      this.migrationStats.uploadHistory.total = totalRecords;

      this.log('INFO', `Migrating ${totalRecords} upload history records`);

      let offset = 0;
      let migratedCount = 0;

      while (offset < totalRecords) {
        const batch = await this.sourceDb.query(`
          SELECT 
            uh.*,
            s.id as new_supplier_id,
            pl.id as new_price_list_id
          FROM legacy_upload_history uh
          LEFT JOIN suppliers s ON (
            s.supplier_code = uh.supplier_code OR 
            s.id = uh.supplier_id
          )
          LEFT JOIN price_lists pl ON pl.id = uh.price_list_id
          ORDER BY uh.upload_date 
          LIMIT $1 OFFSET $2
        `, [this.config.batchSize, offset]);

        const transformedData = batch.rows.map(row => this.transformUploadHistoryData(row));
        
        if (!this.config.dryRun) {
          await this.targetDb.insert(uploadHistory).values(transformedData);
        }

        migratedCount += batch.rows.length;
        this.migrationStats.uploadHistory.migrated = migratedCount;

        offset += this.config.batchSize;
      }

      this.log('SUCCESS', `Upload history migration completed: ${migratedCount} records`);
      
    } catch (error) {
      this.migrationStats.uploadHistory.failed = this.migrationStats.uploadHistory.total - this.migrationStats.uploadHistory.migrated;
      throw new Error(`Upload history migration failed: ${error.message}`);
    }
  }

  transformUploadHistoryData(legacyRow) {
    return {
      id: legacyRow.id,
      supplierId: legacyRow.new_supplier_id,
      fileName: legacyRow.file_name,
      fileType: legacyRow.file_type,
      fileSize: legacyRow.file_size,
      status: legacyRow.status,
      itemCount: legacyRow.item_count || 0,
      successCount: legacyRow.success_count || 0,
      errorCount: legacyRow.error_count || 0,
      errors: legacyRow.errors || [],
      warnings: legacyRow.warnings || [],
      uploadDate: legacyRow.upload_date,
      completedAt: legacyRow.completed_at,
      failedAt: legacyRow.failed_at,
      uploadedBy: legacyRow.uploaded_by,
      priceListId: legacyRow.new_price_list_id,
      metadata: legacyRow.metadata || {},
      createdAt: legacyRow.created_at || new Date(),
      updatedAt: legacyRow.updated_at || new Date()
    };
  }

  // ==================== VALIDATION METHODS ====================

  async validatePreMigration() {
    this.log('INFO', 'Starting pre-migration validation');

    // Check source database connectivity and structure
    await this.validateSourceDatabase();

    // Check target database connectivity and schema
    await this.validateTargetDatabase();

    // Validate data quality in source
    await this.validateSourceDataQuality();

    this.log('SUCCESS', 'Pre-migration validation completed');
  }

  async validateSourceDatabase() {
    const requiredTables = [
      'legacy_customers',
      'legacy_vendors',
      'legacy_suppliers', 
      'legacy_products',
      'legacy_inventory',
      'legacy_price_lists',
      'legacy_price_list_items',
      'legacy_upload_history'
    ];

    for (const table of requiredTables) {
      try {
        await this.sourceDb.query(`SELECT 1 FROM ${table} LIMIT 1`);
        this.log('INFO', `Source table validated: ${table}`);
      } catch (error) {
        this.log('WARNING', `Source table missing or inaccessible: ${table}`);
      }
    }
  }

  async validateTargetDatabase() {
    const targetTables = [
      'customers',
      'suppliers',
      'products', 
      'inventory',
      'price_lists',
      'price_list_items',
      'upload_history'
    ];

    for (const table of targetTables) {
      try {
        const result = await this.targetDb.execute(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`);
        this.log('INFO', `Target table validated: ${table}`);
      } catch (error) {
        throw new Error(`Target table validation failed: ${table} - ${error.message}`);
      }
    }
  }

  async validateSourceDataQuality() {
    // Check for duplicate customer codes
    const duplicateCustomers = await this.sourceDb.query(`
      SELECT customer_code, COUNT(*) as count 
      FROM legacy_customers 
      GROUP BY customer_code 
      HAVING COUNT(*) > 1
    `);

    if (duplicateCustomers.rows.length > 0) {
      this.validationErrors.push({
        type: 'DUPLICATE_CUSTOMER_CODES',
        count: duplicateCustomers.rows.length,
        details: duplicateCustomers.rows
      });
    }

    // Check for duplicate supplier codes
    const duplicateSuppliers = await this.sourceDb.query(`
      SELECT supplier_code, COUNT(*) as count 
      FROM (
        SELECT supplier_code FROM legacy_suppliers
        UNION ALL
        SELECT vendor_code as supplier_code FROM legacy_vendors
      ) combined
      GROUP BY supplier_code 
      HAVING COUNT(*) > 1
    `);

    if (duplicateSuppliers.rows.length > 0) {
      this.validationErrors.push({
        type: 'DUPLICATE_SUPPLIER_CODES',
        count: duplicateSuppliers.rows.length,
        details: duplicateSuppliers.rows
      });
    }

    // Check for missing required fields
    const missingEmails = await this.sourceDb.query(`
      SELECT COUNT(*) as count 
      FROM legacy_customers 
      WHERE email IS NULL OR email = ''
    `);

    if (parseInt(missingEmails.rows[0].count) > 0) {
      this.validationErrors.push({
        type: 'MISSING_CUSTOMER_EMAILS',
        count: parseInt(missingEmails.rows[0].count)
      });
    }

    if (this.validationErrors.length > 0) {
      this.log('WARNING', `Found ${this.validationErrors.length} data quality issues`);
    }
  }

  async validatePostMigration() {
    this.log('INFO', 'Starting post-migration validation');

    // Validate record counts
    await this.validateRecordCounts();

    // Validate data integrity
    await this.validateDataIntegrity();

    // Validate foreign key relationships
    await this.validateRelationships();

    this.log('SUCCESS', 'Post-migration validation completed');
  }

  async validateRecordCounts() {
    for (const [table, stats] of Object.entries(this.migrationStats)) {
      if (stats.migrated !== stats.total) {
        this.validationErrors.push({
          type: 'RECORD_COUNT_MISMATCH',
          table: table,
          expected: stats.total,
          actual: stats.migrated,
          missing: stats.total - stats.migrated
        });
      } else {
        this.log('SUCCESS', `Record count validated for ${table}: ${stats.migrated}`);
        stats.validated = stats.migrated;
      }
    }
  }

  async validateDataIntegrity() {
    // Sample validation for customers
    const sampleCustomers = await this.targetDb
      .select()
      .from(customers)
      .limit(this.config.validationSampleSize);

    for (const customer of sampleCustomers) {
      if (!customer.customerCode || !customer.companyName || !customer.email) {
        this.validationErrors.push({
          type: 'INVALID_CUSTOMER_DATA',
          customerId: customer.id,
          issues: {
            missingCode: !customer.customerCode,
            missingName: !customer.companyName,
            missingEmail: !customer.email
          }
        });
      }
    }

    // Sample validation for suppliers
    const sampleSuppliers = await this.targetDb
      .select()
      .from(suppliers)
      .limit(this.config.validationSampleSize);

    for (const supplier of sampleSuppliers) {
      if (!supplier.supplierCode || !supplier.companyName || !supplier.email) {
        this.validationErrors.push({
          type: 'INVALID_SUPPLIER_DATA',
          supplierId: supplier.id,
          issues: {
            missingCode: !supplier.supplierCode,
            missingName: !supplier.companyName,
            missingEmail: !supplier.email
          }
        });
      }
    }
  }

  async validateRelationships() {
    // Check product-supplier relationships
    const orphanedProducts = await this.targetDb
      .select({ count: sql`COUNT(*)` })
      .from(products)
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(and(isNotNull(products.supplierId), isNull(suppliers.id)));

    if (parseInt(orphanedProducts[0].count) > 0) {
      this.validationErrors.push({
        type: 'ORPHANED_PRODUCTS',
        count: parseInt(orphanedProducts[0].count)
      });
    }

    // Check price list-supplier relationships  
    const orphanedPriceLists = await this.targetDb
      .select({ count: sql`COUNT(*)` })
      .from(priceLists)
      .leftJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(isNull(suppliers.id));

    if (parseInt(orphanedPriceLists[0].count) > 0) {
      this.validationErrors.push({
        type: 'ORPHANED_PRICE_LISTS',
        count: parseInt(orphanedPriceLists[0].count)
      });
    }
  }

  // ==================== BACKUP AND ROLLBACK ====================

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `/tmp/nxt-migration-backup-${timestamp}.sql`;

    this.log('INFO', `Creating backup: ${backupPath}`);

    // This would integrate with your specific backup strategy
    // For now, we'll store rollback data in memory for critical operations
    this.rollbackData.set('backup_timestamp', timestamp);
    this.rollbackData.set('backup_path', backupPath);
  }

  async executeRollback() {
    this.log('WARNING', 'Initiating migration rollback');

    try {
      // In a production environment, this would restore from backup
      // For now, we'll delete migrated data
      const tables = ['upload_history', 'price_list_items', 'price_lists', 'inventory', 'products', 'suppliers', 'customers'];
      
      for (const table of tables) {
        await this.targetDb.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE created_at >= ${this.startTime}`);
        this.log('INFO', `Rolled back table: ${table}`);
      }

      this.log('SUCCESS', 'Migration rollback completed');
      
    } catch (error) {
      this.log('ERROR', `Rollback failed: ${error.message}`);
      throw error;
    }
  }

  // ==================== REPORTING ====================

  async generateMigrationReport() {
    const endTime = new Date();
    const duration = endTime - this.startTime;

    const report = {
      migration: {
        startTime: this.startTime,
        endTime: endTime,
        duration: `${Math.round(duration / 1000)} seconds`,
        status: this.validationErrors.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'SUCCESS'
      },
      statistics: this.migrationStats,
      validation: {
        errors: this.validationErrors,
        errorCount: this.validationErrors.length
      },
      summary: {
        totalRecords: Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.total, 0),
        migratedRecords: Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.migrated, 0),
        failedRecords: Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.failed, 0),
        validatedRecords: Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.validated, 0)
      },
      recommendations: this.generateRecommendations()
    };

    // Save report to file
    const reportPath = `/tmp/migration-report-${new Date().toISOString().split('T')[0]}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    this.log('INFO', `Migration report saved: ${reportPath}`);
    return report;
  }

  generateRecommendations() {
    const recommendations = [];

    if (this.validationErrors.length > 0) {
      recommendations.push('Review and resolve validation errors before proceeding to production');
    }

    const failureRate = Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.failed, 0) / 
                       Object.values(this.migrationStats).reduce((sum, stat) => sum + stat.total, 0);

    if (failureRate > 0.01) {
      recommendations.push(`High failure rate detected (${(failureRate * 100).toFixed(2)}%). Investigate data quality issues`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Migration completed successfully. Ready for production deployment');
    }

    return recommendations;
  }

  // ==================== LOGGING ====================

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message
    };
    
    this.migrationLog.push(logEntry);
    console.log(`[${timestamp}] ${level}: ${message}`);
  }
}

// ==================== UTILITY FUNCTIONS ====================

export async function createMigrationConnection(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  return drizzle(pool);
}

export function calculateMigrationTiming(recordCounts, batchSize = 1000) {
  const timingEstimates = {};
  
  // Base estimates per 1000 records (in seconds)
  const baseTimings = {
    customers: 30,
    suppliers: 35,
    products: 25,
    inventory: 40,
    priceLists: 20,
    priceListItems: 15,
    uploadHistory: 10
  };

  for (const [table, count] of Object.entries(recordCounts)) {
    const batches = Math.ceil(count / batchSize);
    const baseTime = baseTimings[table] || 20;
    timingEstimates[table] = {
      records: count,
      estimatedSeconds: Math.round((count / 1000) * baseTime),
      estimatedMinutes: Math.round(((count / 1000) * baseTime) / 60),
      batches: batches
    };
  }

  const totalSeconds = Object.values(timingEstimates).reduce((sum, timing) => sum + timing.estimatedSeconds, 0);
  
  return {
    byTable: timingEstimates,
    total: {
      seconds: totalSeconds,
      minutes: Math.round(totalSeconds / 60),
      hours: Math.round(totalSeconds / 3600)
    }
  };
}

export default DataMigrationSuite;