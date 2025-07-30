/**
 * NXT NEW DAY - Data Validation and Integrity Suite
 * 
 * Comprehensive validation tools for ensuring data integrity during migration
 * and ongoing operations. Includes data quality checks, relationship validation,
 * and business rule enforcement.
 * 
 * Author: Data Migration Agent
 * Version: 1.0.0
 * Last Updated: 2025-01-19
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, and, or, isNull, isNotNull, desc, asc, count, sum, avg, min, max } from 'drizzle-orm';
import { 
  customers, 
  suppliers, 
  products, 
  inventory, 
  priceLists, 
  priceListItems, 
  uploadHistory,
  analyticsDailyAggregates 
} from '../schema.js';

// ==================== VALIDATION CONFIGURATION ====================

const VALIDATION_CONFIG = {
  batchSize: 1000,
  sampleSize: 100,
  timeout: 120000, // 2 minutes
  strictMode: false,
  generateReport: true,
  autoFix: false // Set to true to automatically fix some issues
};

const VALIDATION_LEVELS = {
  CRITICAL: 'critical', // Must be fixed before proceeding
  WARNING: 'warning',   // Should be reviewed
  INFO: 'info'         // Informational only
};

const DATA_QUALITY_RULES = {
  customers: {
    required: ['customerCode', 'companyName', 'email'],
    unique: ['customerCode', 'email'],
    format: {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      phone: /^[\+]?[0-9\s\-\(\)]{10,}$/
    },
    businessRules: {
      customerCodeLength: { min: 3, max: 50 },
      companyNameLength: { min: 2, max: 255 }
    }
  },
  suppliers: {
    required: ['supplierCode', 'companyName', 'email'],
    unique: ['supplierCode', 'email'],
    format: {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      phone: /^[\+]?[0-9\s\-\(\)]{10,}$/
    },
    businessRules: {
      supplierCodeLength: { min: 3, max: 50 },
      performanceRating: { min: 0, max: 5 },
      leadTimeDays: { min: 0, max: 365 }
    }
  },
  products: {
    required: ['sku', 'name'],
    unique: ['sku'],
    businessRules: {
      skuLength: { min: 3, max: 100 },
      unitPrice: { min: 0 },
      costPrice: { min: 0 }
    }
  },
  inventory: {
    required: ['productId', 'warehouseId'],
    businessRules: {
      quantityOnHand: { min: 0 },
      quantityAvailable: { min: 0 },
      quantityReserved: { min: 0 },
      reorderPoint: { min: 0 },
      minStockLevel: { min: 0 }
    }
  },
  priceLists: {
    required: ['supplierId', 'name', 'effectiveDate'],
    businessRules: {
      nameLength: { min: 2, max: 255 },
      itemCount: { min: 0 }
    }
  },
  priceListItems: {
    required: ['priceListId', 'sku', 'unitPrice'],
    businessRules: {
      unitPrice: { min: 0 },
      minQuantity: { min: 1 },
      discountPercent: { min: 0, max: 100 }
    }
  }
};

// ==================== DATA VALIDATION SUITE ====================

export class DataValidationSuite {
  constructor(db, options = {}) {
    this.db = db;
    this.config = { ...VALIDATION_CONFIG, ...options };
    this.validationResults = {
      summary: {
        totalChecks: 0,
        passed: 0,
        warnings: 0,
        critical: 0,
        startTime: null,
        endTime: null,
        duration: 0
      },
      details: {
        customers: [],
        suppliers: [],
        products: [],
        inventory: [],
        priceLists: [],
        priceListItems: [],
        relationships: [],
        businessRules: []
      },
      fixes: []
    };
  }

  // ==================== MAIN VALIDATION ORCHESTRATION ====================

  async runCompleteValidation() {
    try {
      this.validationResults.summary.startTime = new Date();
      this.log('INFO', 'Starting comprehensive data validation');

      // Core data validation
      await this.validateCustomers();
      await this.validateSuppliers();
      await this.validateProducts();
      await this.validateInventory();
      await this.validatePriceLists();
      await this.validatePriceListItems();

      // Relationship validation
      await this.validateRelationships();

      // Business rule validation
      await this.validateBusinessRules();

      // Data consistency checks
      await this.validateDataConsistency();

      // Performance validation
      await this.validatePerformance();

      this.validationResults.summary.endTime = new Date();
      this.validationResults.summary.duration = 
        this.validationResults.summary.endTime - this.validationResults.summary.startTime;

      this.calculateSummary();

      if (this.config.generateReport) {
        await this.generateValidationReport();
      }

      this.log('SUCCESS', 'Data validation completed');
      return this.validationResults;

    } catch (error) {
      this.log('ERROR', `Validation failed: ${error.message}`);
      throw error;
    }
  }

  // ==================== CUSTOMER VALIDATION ====================

  async validateCustomers() {
    this.log('INFO', 'Validating customers data');
    const tableName = 'customers';
    const rules = DATA_QUALITY_RULES.customers;

    try {
      // Count total records
      const totalCount = await this.db.select({ count: count() }).from(customers);
      const total = totalCount[0].count;

      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(customers)
          .where(or(isNull(customers[field]), eq(customers[field], '')));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL, 
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count, totalRecords: total });
        }
      }

      // Uniqueness validation
      for (const field of rules.unique) {
        const duplicates = await this.db
          .select({ 
            value: customers[field], 
            count: count() 
          })
          .from(customers)
          .where(isNotNull(customers[field]))
          .groupBy(customers[field])
          .having(sql`COUNT(*) > 1`);

        if (duplicates.length > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${duplicates.length} duplicate values found in field: ${field}`,
            { field, duplicates: duplicates.slice(0, 10) }); // Show first 10
        }
      }

      // Format validation
      if (rules.format.email) {
        const invalidEmails = await this.db
          .select({ id: customers.id, email: customers.email })
          .from(customers)
          .where(isNotNull(customers.email))
          .limit(this.config.sampleSize);

        const invalidEmailRecords = invalidEmails.filter(record => 
          !rules.format.email.test(record.email)
        );

        if (invalidEmailRecords.length > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
            `${invalidEmailRecords.length} records with invalid email format`,
            { invalidEmails: invalidEmailRecords.slice(0, 5) });
        }
      }

      // Business rule validation
      const longCodes = await this.db
        .select({ count: count() })
        .from(customers)
        .where(sql`LENGTH(${customers.customerCode}) > ${rules.businessRules.customerCodeLength.max}`);

      if (longCodes[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${longCodes[0].count} customer codes exceed maximum length`,
          { maxLength: rules.businessRules.customerCodeLength.max });
      }

      this.log('SUCCESS', `Customer validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Customer validation failed: ${error.message}`);
    }
  }

  // ==================== SUPPLIER VALIDATION ====================

  async validateSuppliers() {
    this.log('INFO', 'Validating suppliers data');
    const tableName = 'suppliers';
    const rules = DATA_QUALITY_RULES.suppliers;

    try {
      const totalCount = await this.db.select({ count: count() }).from(suppliers);
      const total = totalCount[0].count;

      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(suppliers)
          .where(or(isNull(suppliers[field]), eq(suppliers[field], '')));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count, totalRecords: total });
        }
      }

      // Uniqueness validation
      for (const field of rules.unique) {
        const duplicates = await this.db
          .select({ 
            value: suppliers[field], 
            count: count() 
          })
          .from(suppliers)
          .where(isNotNull(suppliers[field]))
          .groupBy(suppliers[field])
          .having(sql`COUNT(*) > 1`);

        if (duplicates.length > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${duplicates.length} duplicate values found in field: ${field}`,
            { field, duplicates: duplicates.slice(0, 10) });
        }
      }

      // Performance rating validation
      const invalidRatings = await this.db
        .select({ count: count() })
        .from(suppliers)
        .where(or(
          sql`${suppliers.performanceRating} < ${rules.businessRules.performanceRating.min}`,
          sql`${suppliers.performanceRating} > ${rules.businessRules.performanceRating.max}`
        ));

      if (invalidRatings[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidRatings[0].count} suppliers with invalid performance ratings`,
          { validRange: rules.businessRules.performanceRating });
      }

      // Lead time validation
      const invalidLeadTimes = await this.db
        .select({ count: count() })
        .from(suppliers)
        .where(sql`${suppliers.leadTimeDays} > ${rules.businessRules.leadTimeDays.max}`);

      if (invalidLeadTimes[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidLeadTimes[0].count} suppliers with excessive lead times`,
          { maxLeadTime: rules.businessRules.leadTimeDays.max });
      }

      this.log('SUCCESS', `Supplier validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Supplier validation failed: ${error.message}`);
    }
  }

  // ==================== PRODUCT VALIDATION ====================

  async validateProducts() {
    this.log('INFO', 'Validating products data');
    const tableName = 'products';
    const rules = DATA_QUALITY_RULES.products;

    try {
      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(products)
          .where(or(isNull(products[field]), eq(products[field], '')));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count });
        }
      }

      // SKU uniqueness
      const duplicateSkus = await this.db
        .select({ 
          sku: products.sku, 
          count: count() 
        })
        .from(products)
        .groupBy(products.sku)
        .having(sql`COUNT(*) > 1`);

      if (duplicateSkus.length > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
          `${duplicateSkus.length} duplicate SKUs found`,
          { duplicates: duplicateSkus.slice(0, 10) });
      }

      // Price validation
      const negativeUnitPrices = await this.db
        .select({ count: count() })
        .from(products)
        .where(sql`${products.unitPrice} < 0`);

      if (negativeUnitPrices[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${negativeUnitPrices[0].count} products with negative unit prices`);
      }

      const negativeCostPrices = await this.db
        .select({ count: count() })
        .from(products)
        .where(sql`${products.costPrice} < 0`);

      if (negativeCostPrices[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${negativeCostPrices[0].count} products with negative cost prices`);
      }

      // Cost vs Price validation
      const invalidMargins = await this.db
        .select({ count: count() })
        .from(products)
        .where(and(
          isNotNull(products.unitPrice),
          isNotNull(products.costPrice),
          sql`${products.costPrice} > ${products.unitPrice}`
        ));

      if (invalidMargins[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidMargins[0].count} products with cost price higher than unit price`);
      }

      this.log('SUCCESS', `Product validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Product validation failed: ${error.message}`);
    }
  }

  // ==================== INVENTORY VALIDATION ====================

  async validateInventory() {
    this.log('INFO', 'Validating inventory data');
    const tableName = 'inventory';
    const rules = DATA_QUALITY_RULES.inventory;

    try {
      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(inventory)
          .where(isNull(inventory[field]));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count });
        }
      }

      // Negative quantity validation
      const negativeQuantities = await this.db
        .select({ count: count() })
        .from(inventory)
        .where(sql`${inventory.quantityOnHand} < 0`);

      if (negativeQuantities[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${negativeQuantities[0].count} inventory records with negative quantities`);
      }

      // Available vs On Hand validation
      const invalidAvailable = await this.db
        .select({ count: count() })
        .from(inventory)
        .where(sql`${inventory.quantityAvailable} > ${inventory.quantityOnHand}`);

      if (invalidAvailable[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidAvailable[0].count} inventory records with available > on hand`);
      }

      // Reserved quantity validation
      const invalidReserved = await this.db
        .select({ count: count() })
        .from(inventory)
        .where(sql`${inventory.quantityReserved} > ${inventory.quantityOnHand}`);

      if (invalidReserved[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidReserved[0].count} inventory records with reserved > on hand`);
      }

      // Reorder point validation
      const invalidReorderPoints = await this.db
        .select({ count: count() })
        .from(inventory)
        .where(and(
          isNotNull(inventory.minStockLevel),
          isNotNull(inventory.reorderPoint),
          sql`${inventory.reorderPoint} < ${inventory.minStockLevel}`
        ));

      if (invalidReorderPoints[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.INFO,
          `${invalidReorderPoints[0].count} inventory records with reorder point below minimum stock level`);
      }

      this.log('SUCCESS', `Inventory validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Inventory validation failed: ${error.message}`);
    }
  }

  // ==================== PRICE LIST VALIDATION ====================

  async validatePriceLists() {
    this.log('INFO', 'Validating price lists data');
    const tableName = 'priceLists';
    const rules = DATA_QUALITY_RULES.priceLists;

    try {
      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(priceLists)
          .where(or(isNull(priceLists[field]), eq(priceLists[field], '')));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count });
        }
      }

      // Date validation
      const invalidDates = await this.db
        .select({ count: count() })
        .from(priceLists)
        .where(and(
          isNotNull(priceLists.expiryDate),
          sql`${priceLists.expiryDate} < ${priceLists.effectiveDate}`
        ));

      if (invalidDates[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidDates[0].count} price lists with expiry date before effective date`);
      }

      // Status validation
      const invalidStatuses = await this.db
        .select({ count: count() })
        .from(priceLists)
        .where(sql`${priceLists.status} NOT IN ('draft', 'active', 'expired', 'archived')`);

      if (invalidStatuses[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidStatuses[0].count} price lists with invalid status`);
      }

      this.log('SUCCESS', `Price list validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Price list validation failed: ${error.message}`);
    }
  }

  // ==================== PRICE LIST ITEMS VALIDATION ====================

  async validatePriceListItems() {
    this.log('INFO', 'Validating price list items data');
    const tableName = 'priceListItems';
    const rules = DATA_QUALITY_RULES.priceListItems;

    try {
      // Required field validation
      for (const field of rules.required) {
        const nullCount = await this.db
          .select({ count: count() })
          .from(priceListItems)
          .where(or(isNull(priceListItems[field]), eq(priceListItems[field], '')));

        if (nullCount[0].count > 0) {
          this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
            `${nullCount[0].count} records missing required field: ${field}`,
            { field, affectedRecords: nullCount[0].count });
        }
      }

      // Price validation
      const negativeUnitPrices = await this.db
        .select({ count: count() })
        .from(priceListItems)
        .where(sql`${priceListItems.unitPrice} < 0`);

      if (negativeUnitPrices[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${negativeUnitPrices[0].count} price list items with negative unit prices`);
      }

      // Discount validation
      const invalidDiscounts = await this.db
        .select({ count: count() })
        .from(priceListItems)
        .where(or(
          sql`${priceListItems.discountPercent} < 0`,
          sql`${priceListItems.discountPercent} > 100`
        ));

      if (invalidDiscounts[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidDiscounts[0].count} price list items with invalid discount percentages`);
      }

      // Minimum quantity validation
      const invalidMinQuantities = await this.db
        .select({ count: count() })
        .from(priceListItems)
        .where(sql`${priceListItems.minQuantity} < 1`);

      if (invalidMinQuantities[0].count > 0) {
        this.addValidationResult(tableName, VALIDATION_LEVELS.WARNING,
          `${invalidMinQuantities[0].count} price list items with invalid minimum quantities`);
      }

      this.log('SUCCESS', `Price list items validation completed`);

    } catch (error) {
      this.addValidationResult(tableName, VALIDATION_LEVELS.CRITICAL,
        `Price list items validation failed: ${error.message}`);
    }
  }

  // ==================== RELATIONSHIP VALIDATION ====================

  async validateRelationships() {
    this.log('INFO', 'Validating foreign key relationships');

    try {
      // Product -> Supplier relationships
      const orphanedProducts = await this.db
        .select({ count: count() })
        .from(products)
        .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(and(isNotNull(products.supplierId), isNull(suppliers.id)));

      if (orphanedProducts[0].count > 0) {
        this.addValidationResult('relationships', VALIDATION_LEVELS.CRITICAL,
          `${orphanedProducts[0].count} products reference non-existent suppliers`);
      }

      // Inventory -> Product relationships
      const orphanedInventory = await this.db
        .select({ count: count() })
        .from(inventory)
        .leftJoin(products, eq(inventory.productId, products.id))
        .where(isNull(products.id));

      if (orphanedInventory[0].count > 0) {
        this.addValidationResult('relationships', VALIDATION_LEVELS.CRITICAL,
          `${orphanedInventory[0].count} inventory records reference non-existent products`);
      }

      // Price List -> Supplier relationships
      const orphanedPriceLists = await this.db
        .select({ count: count() })
        .from(priceLists)
        .leftJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
        .where(isNull(suppliers.id));

      if (orphanedPriceLists[0].count > 0) {
        this.addValidationResult('relationships', VALIDATION_LEVELS.CRITICAL,
          `${orphanedPriceLists[0].count} price lists reference non-existent suppliers`);
      }

      // Price List Items -> Price List relationships
      const orphanedPriceListItems = await this.db
        .select({ count: count() })
        .from(priceListItems)
        .leftJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(isNull(priceLists.id));

      if (orphanedPriceListItems[0].count > 0) {
        this.addValidationResult('relationships', VALIDATION_LEVELS.CRITICAL,
          `${orphanedPriceListItems[0].count} price list items reference non-existent price lists`);
      }

      this.log('SUCCESS', `Relationship validation completed`);

    } catch (error) {
      this.addValidationResult('relationships', VALIDATION_LEVELS.CRITICAL,
        `Relationship validation failed: ${error.message}`);
    }
  }

  // ==================== BUSINESS RULES VALIDATION ====================

  async validateBusinessRules() {
    this.log('INFO', 'Validating business rules');

    try {
      // Rule: Active price lists should have items
      const activePriceListsWithoutItems = await this.db
        .select({ count: count() })
        .from(priceLists)
        .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
        .where(and(
          eq(priceLists.status, 'active'),
          isNull(priceListItems.id)
        ));

      if (activePriceListsWithoutItems[0].count > 0) {
        this.addValidationResult('businessRules', VALIDATION_LEVELS.WARNING,
          `${activePriceListsWithoutItems[0].count} active price lists have no items`);
      }

      // Rule: Active suppliers should have products or price lists
      const inactiveSuppliers = await this.db
        .select({ 
          id: suppliers.id,
          companyName: suppliers.companyName
        })
        .from(suppliers)
        .leftJoin(products, eq(suppliers.id, products.supplierId))
        .leftJoin(priceLists, eq(suppliers.id, priceLists.supplierId))
        .where(and(
          eq(suppliers.isActive, true),
          isNull(products.id),
          isNull(priceLists.id)
        ));

      if (inactiveSuppliers.length > 0) {
        this.addValidationResult('businessRules', VALIDATION_LEVELS.INFO,
          `${inactiveSuppliers.length} active suppliers have no products or price lists`,
          { suppliers: inactiveSuppliers.slice(0, 5) });
      }

      // Rule: Products should have inventory records
      const productsWithoutInventory = await this.db
        .select({ count: count() })
        .from(products)
        .leftJoin(inventory, eq(products.id, inventory.productId))
        .where(and(
          eq(products.isActive, true),
          isNull(inventory.id)
        ));

      if (productsWithoutInventory[0].count > 0) {
        this.addValidationResult('businessRules', VALIDATION_LEVELS.INFO,
          `${productsWithoutInventory[0].count} active products have no inventory records`);
      }

      this.log('SUCCESS', `Business rules validation completed`);

    } catch (error) {
      this.addValidationResult('businessRules', VALIDATION_LEVELS.CRITICAL,
        `Business rules validation failed: ${error.message}`);
    }
  }

  // ==================== DATA CONSISTENCY VALIDATION ====================

  async validateDataConsistency() {
    this.log('INFO', 'Validating data consistency');

    try {
      // Check for inconsistent inventory calculations
      const inconsistentInventory = await this.db
        .select({ count: count() })
        .from(inventory)
        .where(sql`${inventory.quantityAvailable} != (${inventory.quantityOnHand} - ${inventory.quantityReserved})`);

      if (inconsistentInventory[0].count > 0) {
        this.addValidationResult('consistency', VALIDATION_LEVELS.WARNING,
          `${inconsistentInventory[0].count} inventory records with inconsistent available quantities`);
      }

      // Check for price list items without corresponding products
      const itemsWithoutProducts = await this.db
        .select({ count: count() })
        .from(priceListItems)
        .leftJoin(products, eq(priceListItems.sku, products.sku))
        .where(isNull(products.id));

      if (itemsWithoutProducts[0].count > 0) {
        this.addValidationResult('consistency', VALIDATION_LEVELS.WARNING,
          `${itemsWithoutProducts[0].count} price list items reference non-existent product SKUs`);
      }

      this.log('SUCCESS', `Data consistency validation completed`);

    } catch (error) {
      this.addValidationResult('consistency', VALIDATION_LEVELS.CRITICAL,
        `Data consistency validation failed: ${error.message}`);
    }
  }

  // ==================== PERFORMANCE VALIDATION ====================

  async validatePerformance() {
    this.log('INFO', 'Validating database performance');

    try {
      // Check for tables without proper indexes
      const indexChecks = [
        { table: 'customers', column: 'customer_code' },
        { table: 'suppliers', column: 'supplier_code' },
        { table: 'products', column: 'sku' },
        { table: 'inventory', column: 'product_id' },
        { table: 'price_lists', column: 'supplier_id' }
      ];

      for (const check of indexChecks) {
        const indexExists = await this.db.execute(sql`
          SELECT COUNT(*) as count
          FROM pg_indexes 
          WHERE tablename = ${check.table} 
          AND indexdef LIKE '%${check.column}%'
        `);

        if (parseInt(indexExists.rows[0].count) === 0) {
          this.addValidationResult('performance', VALIDATION_LEVELS.WARNING,
            `Missing index on ${check.table}.${check.column}`);
        }
      }

      // Check for large tables that might need partitioning
      const tableSizes = await this.db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      `);

      const largeTables = tableSizes.rows.filter(table => 
        parseInt(table.size_bytes) > 1000000000 // > 1GB
      );

      if (largeTables.length > 0) {
        this.addValidationResult('performance', VALIDATION_LEVELS.INFO,
          `${largeTables.length} tables larger than 1GB may benefit from optimization`,
          { tables: largeTables });
      }

      this.log('SUCCESS', `Performance validation completed`);

    } catch (error) {
      this.addValidationResult('performance', VALIDATION_LEVELS.WARNING,
        `Performance validation failed: ${error.message}`);
    }
  }

  // ==================== HELPER METHODS ====================

  addValidationResult(category, level, message, details = {}) {
    const result = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };

    this.validationResults.details[category].push(result);
    this.validationResults.summary.totalChecks++;

    switch (level) {
      case VALIDATION_LEVELS.CRITICAL:
        this.validationResults.summary.critical++;
        break;
      case VALIDATION_LEVELS.WARNING:
        this.validationResults.summary.warnings++;
        break;
      default:
        this.validationResults.summary.passed++;
    }

    this.log(level.toUpperCase(), message);
  }

  calculateSummary() {
    const { summary } = this.validationResults;
    summary.successRate = summary.totalChecks > 0 ? 
      (summary.passed / summary.totalChecks * 100).toFixed(2) : 0;
    
    summary.status = summary.critical > 0 ? 'CRITICAL_ISSUES' :
                    summary.warnings > 0 ? 'WARNINGS' : 'PASSED';
  }

  async generateValidationReport() {
    const reportPath = `/tmp/data-validation-report-${new Date().toISOString().split('T')[0]}.json`;
    
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        validator: 'NXT NEW DAY Data Validation Suite v1.0.0',
        database: 'NXT Production Database'
      },
      summary: this.validationResults.summary,
      details: this.validationResults.details,
      recommendations: this.generateRecommendations()
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    this.log('INFO', `Validation report saved: ${reportPath}`);
    
    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    const { summary } = this.validationResults;

    if (summary.critical > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Fix critical issues before proceeding to production',
        description: `${summary.critical} critical issues require immediate attention`
      });
    }

    if (summary.warnings > 10) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Review and address data quality warnings',
        description: `${summary.warnings} warnings detected that could impact system performance`
      });
    }

    const orphanedRelationships = this.validationResults.details.relationships
      .filter(r => r.level === VALIDATION_LEVELS.CRITICAL).length;
    
    if (orphanedRelationships > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Clean up orphaned relationships',
        description: 'Fix foreign key reference issues to maintain data integrity'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'LOW',
        action: 'Continue with deployment',
        description: 'Data validation passed successfully'
      });
    }

    return recommendations;
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
  }
}

// ==================== QUICK VALIDATION FUNCTIONS ====================

export async function validateMigrationReadiness(db) {
  const validator = new DataValidationSuite(db, { 
    strictMode: true,
    sampleSize: 50 
  });
  
  const results = await validator.runCompleteValidation();
  
  return {
    ready: results.summary.critical === 0,
    issues: results.summary.critical + results.summary.warnings,
    recommendations: validator.generateRecommendations()
  };
}

export async function validateSampleData(db, tableName, sampleSize = 10) {
  const validator = new DataValidationSuite(db, { sampleSize });
  
  switch (tableName) {
    case 'customers':
      await validator.validateCustomers();
      break;
    case 'suppliers':
      await validator.validateSuppliers();
      break;
    case 'products':
      await validator.validateProducts();
      break;
    case 'inventory':
      await validator.validateInventory();
      break;
    default:
      throw new Error(`Unsupported table: ${tableName}`);
  }
  
  return validator.validationResults.details[tableName];
}

export default DataValidationSuite;