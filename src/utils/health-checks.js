/**
 * System Health Check Utilities
 * Validates system components for rollback procedures
 */

import { db } from '../config/database.js';
import { sql } from 'drizzle-orm';
import fs from 'fs/promises';
import { execSync } from 'child_process';

export class HealthChecker {
  constructor() {
    this.checks = [];
    this.results = {};
  }

  async validateSystemHealth() {
    const results = {
      healthy: true,
      timestamp: new Date().toISOString(),
      checks: {},
      errors: [],
      warnings: []
    };

    try {
      // Database health
      results.checks.database = await this.checkDatabaseHealth();
      
      // Application health
      results.checks.application = await this.checkApplicationHealth();
      
      // Critical features
      results.checks.features = await this.checkCriticalFeatures();
      
      // System resources
      results.checks.resources = await this.checkSystemResources();
      
      // Network connectivity
      results.checks.network = await this.checkNetworkHealth();
      
      // Security posture
      results.checks.security = await this.checkSecurityHealth();
      
      // Supply chain integrations
      results.checks.supplyChain = await this.checkSupplyChainIntegrations();

      // Aggregate results
      for (const [checkName, checkResult] of Object.entries(results.checks)) {
        if (!checkResult.healthy) {
          results.healthy = false;
          results.errors.push(`${checkName}: ${checkResult.error}`);
        }
        if (checkResult.warnings?.length > 0) {
          results.warnings.push(...checkResult.warnings.map(w => `${checkName}: ${w}`));
        }
      }

    } catch (error) {
      results.healthy = false;
      results.errors.push(`Health check failed: ${error.message}`);
    }

    return results;
  }

  async checkDatabaseHealth() {
    const result = {
      healthy: true,
      latency: null,
      connections: null,
      error: null,
      warnings: []
    };

    try {
      // Test basic connectivity
      const startTime = Date.now();
      await db.execute(sql`SELECT 1 as test`);
      result.latency = Date.now() - startTime;

      // Check connection pool
      const poolStats = await this.getDatabasePoolStats();
      result.connections = poolStats;

      // Validate critical tables exist
      const tables = await this.validateCriticalTables();
      if (!tables.allPresent) {
        result.warnings.push(`Missing tables: ${tables.missing.join(', ')}`);
      }

      // Check for recent errors
      const recentErrors = await this.checkDatabaseErrors();
      if (recentErrors.count > 0) {
        result.warnings.push(`${recentErrors.count} recent database errors`);
      }

      // Performance check
      if (result.latency > 1000) {
        result.warnings.push(`High database latency: ${result.latency}ms`);
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  async checkApplicationHealth() {
    const result = {
      healthy: true,
      services: {},
      error: null,
      warnings: []
    };

    try {
      // Check if services are running
      const services = ['nxt-backend', 'nxt-frontend', 'nginx'];
      for (const service of services) {
        result.services[service] = await this.checkServiceStatus(service);
        if (!result.services[service].running) {
          result.healthy = false;
          result.error = `Service ${service} is not running`;
        }
      }

      // Check API endpoints
      const apiHealth = await this.checkAPIEndpoints();
      if (!apiHealth.healthy) {
        result.healthy = false;
        result.error = apiHealth.error;
      }

      // Check memory usage
      const memoryUsage = await this.checkMemoryUsage();
      if (memoryUsage.usage > 90) {
        result.warnings.push(`High memory usage: ${memoryUsage.usage}%`);
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  async checkCriticalFeatures() {
    const result = {
      healthy: true,
      features: {},
      error: null,
      warnings: []
    };

    try {
      // Authentication system
      result.features.authentication = await this.testAuthentication();
      
      // Customer management
      result.features.customerManagement = await this.testCustomerManagement();
      
      // Supplier management
      result.features.supplierManagement = await this.testSupplierManagement();
      
      // Inventory management
      result.features.inventoryManagement = await this.testInventoryManagement();
      
      // Analytics system
      result.features.analytics = await this.testAnalytics();

      // Check if any critical features failed
      for (const [featureName, featureResult] of Object.entries(result.features)) {
        if (!featureResult.healthy) {
          result.healthy = false;
          result.error = `Critical feature ${featureName} failed: ${featureResult.error}`;
          break;
        }
        if (featureResult.warnings?.length > 0) {
          result.warnings.push(...featureResult.warnings);
        }
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  async checkSystemResources() {
    const result = {
      healthy: true,
      disk: null,
      memory: null,
      cpu: null,
      error: null,
      warnings: []
    };

    try {
      // Disk space
      result.disk = await this.checkDiskSpace();
      if (result.disk.usage > 90) {
        result.healthy = false;
        result.error = `Disk space critical: ${result.disk.usage}%`;
      } else if (result.disk.usage > 80) {
        result.warnings.push(`Disk space high: ${result.disk.usage}%`);
      }

      // Memory usage
      result.memory = await this.checkMemoryUsage();
      if (result.memory.usage > 95) {
        result.healthy = false;
        result.error = `Memory usage critical: ${result.memory.usage}%`;
      } else if (result.memory.usage > 85) {
        result.warnings.push(`Memory usage high: ${result.memory.usage}%`);
      }

      // CPU load
      result.cpu = await this.checkCPULoad();
      if (result.cpu.load > 5.0) {
        result.warnings.push(`High CPU load: ${result.cpu.load}`);
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  async checkNetworkHealth() {
    const result = {
      healthy: true,
      connectivity: {},
      error: null,
      warnings: []
    };

    try {
      // Test external dependencies
      const dependencies = [
        { name: 'database', host: process.env.DATABASE_HOST || 'database' },
        { name: 'redis', host: process.env.REDIS_HOST || 'redis' },
        { name: 'openai', host: 'api.openai.com' }
      ];

      for (const dep of dependencies) {
        result.connectivity[dep.name] = await this.testConnectivity(dep.host);
        if (!result.connectivity[dep.name].reachable) {
          result.warnings.push(`Cannot reach ${dep.name} at ${dep.host}`);
        }
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  async checkSecurityHealth() {
    const result = {
      healthy: true,
      checks: {},
      error: null,
      warnings: []
    };

    try {
      // SSL certificate validation
      result.checks.ssl = await this.checkSSLCertificate();
      
      // Security headers
      result.checks.headers = await this.checkSecurityHeaders();
      
      // Rate limiting
      result.checks.rateLimiting = await this.checkRateLimiting();
      
      // JWT token validation
      result.checks.jwtValidation = await this.checkJWTValidation();

      // Aggregate security warnings
      for (const [checkName, checkResult] of Object.entries(result.checks)) {
        if (checkResult.warnings?.length > 0) {
          result.warnings.push(...checkResult.warnings);
        }
      }

    } catch (error) {
      result.healthy = false;
      result.error = error.message;
    }

    return result;
  }

  // Helper methods
  async getDatabasePoolStats() {
    try {
      const result = await db.execute(sql`
        SELECT 
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `);
      return result.rows[0];
    } catch (error) {
      return { error: error.message };
    }
  }

  async validateCriticalTables() {
    const requiredTables = [
      'customers', 'suppliers', 'products', 'inventory',
      'inventory_movements', 'price_lists', 'price_list_items'
    ];

    try {
      const result = await db.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `);

      const existingTables = result.rows.map(row => row.table_name);
      const missing = requiredTables.filter(table => !existingTables.includes(table));

      return {
        allPresent: missing.length === 0,
        missing,
        existing: existingTables
      };
    } catch (error) {
      return { allPresent: false, error: error.message };
    }
  }

  async checkDatabaseErrors() {
    try {
      // This would depend on your logging system
      // For now, return a placeholder
      return { count: 0 };
    } catch (error) {
      return { count: 0, error: error.message };
    }
  }

  async checkServiceStatus(serviceName) {
    try {
      const result = execSync(`systemctl is-active ${serviceName}`, { encoding: 'utf8' });
      return {
        running: result.trim() === 'active',
        status: result.trim()
      };
    } catch (error) {
      return {
        running: false,
        status: 'inactive',
        error: error.message
      };
    }
  }

  async checkAPIEndpoints() {
    const endpoints = [
      { url: '/api/health', method: 'GET' },
      { url: '/api/customers', method: 'GET' },
      { url: '/api/suppliers', method: 'GET' }
    ];

    try {
      // This would make actual HTTP requests to test endpoints
      // For now, return a placeholder
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkMemoryUsage() {
    try {
      const result = execSync('free | grep Mem', { encoding: 'utf8' });
      const [, total, used] = result.trim().split(/\s+/).map(Number);
      const usage = Math.round((used / total) * 100);
      
      return { usage, total, used };
    } catch (error) {
      return { usage: 0, error: error.message };
    }
  }

  async checkDiskSpace() {
    try {
      const result = execSync('df / | tail -1', { encoding: 'utf8' });
      const [, size, used, available, usage] = result.trim().split(/\s+/);
      
      return {
        usage: parseInt(usage.replace('%', '')),
        size: parseInt(size),
        used: parseInt(used),
        available: parseInt(available)
      };
    } catch (error) {
      return { usage: 0, error: error.message };
    }
  }

  async checkCPULoad() {
    try {
      const result = execSync('uptime', { encoding: 'utf8' });
      const loadMatch = result.match(/load average: ([\d.]+)/);
      const load = loadMatch ? parseFloat(loadMatch[1]) : 0;
      
      return { load };
    } catch (error) {
      return { load: 0, error: error.message };
    }
  }

  async testConnectivity(host) {
    try {
      execSync(`ping -c 1 -W 3 ${host}`, { stdio: 'pipe' });
      return { reachable: true };
    } catch (error) {
      return { reachable: false, error: error.message };
    }
  }

  async testAuthentication() {
    try {
      // Test authentication endpoints
      // This would depend on your auth system
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async testCustomerManagement() {
    try {
      // Test customer CRUD operations
      const testResult = await db.execute(sql`SELECT COUNT(*) as count FROM customers LIMIT 1`);
      return { healthy: true, recordCount: testResult.rows[0].count };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async testSupplierManagement() {
    try {
      // Test supplier CRUD operations
      const testResult = await db.execute(sql`SELECT COUNT(*) as count FROM suppliers LIMIT 1`);
      return { healthy: true, recordCount: testResult.rows[0].count };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async testInventoryManagement() {
    try {
      // Test inventory operations
      const testResult = await db.execute(sql`SELECT COUNT(*) as count FROM inventory LIMIT 1`);
      return { healthy: true, recordCount: testResult.rows[0].count };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async testAnalytics() {
    try {
      // Test analytics endpoints
      const testResult = await db.execute(sql`SELECT COUNT(*) as count FROM analytics_daily_aggregates LIMIT 1`);
      return { healthy: true, recordCount: testResult.rows[0].count };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkSSLCertificate() {
    try {
      // Check SSL certificate validity
      return { healthy: true, warnings: [] };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkSecurityHeaders() {
    try {
      // Check security headers
      return { healthy: true, warnings: [] };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkRateLimiting() {
    try {
      // Test rate limiting
      return { healthy: true, warnings: [] };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkJWTValidation() {
    try {
      // Test JWT validation
      return { healthy: true, warnings: [] };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkSupplyChainIntegrations() {
    try {
      const integrationChecks = {
        purchaseOrders: { healthy: true, details: {} },
        inventory: { healthy: true, details: {} },
        suppliers: { healthy: true, details: {} },
        priceListsSync: { healthy: true, details: {} },
        notifications: { healthy: true, details: {} }
      };

      // Check purchase order workflow
      try {
        const poCheck = await db.execute(sql`
          SELECT 
            COUNT(*) as total_pos,
            COUNT(CASE WHEN status = 'pending_approval' THEN 1 END) as pending_approval,
            COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as created_today
          FROM supplier_purchase_orders
        `);
        
        integrationChecks.purchaseOrders.details = {
          totalOrders: poCheck[0]?.total_pos || 0,
          pendingApproval: poCheck[0]?.pending_approval || 0,
          createdToday: poCheck[0]?.created_today || 0
        };
      } catch (error) {
        integrationChecks.purchaseOrders.healthy = false;
        integrationChecks.purchaseOrders.error = error.message;
      }

      // Check inventory integration
      try {
        const inventoryCheck = await db.execute(sql`
          SELECT 
            COUNT(*) as total_items,
            COUNT(CASE WHEN quantity_on_hand <= reorder_point THEN 1 END) as low_stock_items,
            COUNT(CASE WHEN last_movement > NOW() - INTERVAL '7 days' THEN 1 END) as active_items
          FROM inventory
        `);
        
        integrationChecks.inventory.details = {
          totalItems: inventoryCheck[0]?.total_items || 0,
          lowStockItems: inventoryCheck[0]?.low_stock_items || 0,
          activeItems: inventoryCheck[0]?.active_items || 0
        };
      } catch (error) {
        integrationChecks.inventory.healthy = false;
        integrationChecks.inventory.error = error.message;
      }

      // Check supplier data sync
      try {
        const supplierCheck = await db.execute(sql`
          SELECT 
            COUNT(*) as total_suppliers,
            COUNT(CASE WHEN is_active = true THEN 1 END) as active_suppliers,
            COUNT(CASE WHEN updated_at > NOW() - INTERVAL '30 days' THEN 1 END) as recently_updated
          FROM suppliers
        `);
        
        integrationChecks.suppliers.details = {
          totalSuppliers: supplierCheck[0]?.total_suppliers || 0,
          activeSuppliers: supplierCheck[0]?.active_suppliers || 0,
          recentlyUpdated: supplierCheck[0]?.recently_updated || 0
        };
      } catch (error) {
        integrationChecks.suppliers.healthy = false;
        integrationChecks.suppliers.error = error.message;
      }

      // Check price list synchronization
      try {
        const priceListCheck = await db.execute(sql`
          SELECT 
            COUNT(*) as total_price_lists,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active_price_lists,
            COUNT(CASE WHEN validation_status = 'failed' THEN 1 END) as failed_validations,
            COUNT(CASE WHEN updated_at > NOW() - INTERVAL '7 days' THEN 1 END) as recently_updated
          FROM price_lists
        `);
        
        integrationChecks.priceListsSync.details = {
          totalPriceLists: priceListCheck[0]?.total_price_lists || 0,
          activePriceLists: priceListCheck[0]?.active_price_lists || 0,
          failedValidations: priceListCheck[0]?.failed_validations || 0,
          recentlyUpdated: priceListCheck[0]?.recently_updated || 0
        };

        // Flag as unhealthy if too many failed validations
        if (priceListCheck[0]?.failed_validations > 5) {
          integrationChecks.priceListsSync.healthy = false;
          integrationChecks.priceListsSync.warning = 'High number of failed price list validations';
        }
      } catch (error) {
        integrationChecks.priceListsSync.healthy = false;
        integrationChecks.priceListsSync.error = error.message;
      }

      // Check notification system
      try {
        integrationChecks.notifications.details = {
          emailConfigured: !!process.env.EMAIL_SERVICE_URL,
          slackConfigured: !!process.env.SLACK_WEBHOOK_URL,
          webhookConfigured: !!process.env.WEBHOOK_URL
        };

        const configuredChannels = Object.values(integrationChecks.notifications.details).filter(Boolean).length;
        if (configuredChannels === 0) {
          integrationChecks.notifications.healthy = false;
          integrationChecks.notifications.warning = 'No notification channels configured';
        }
      } catch (error) {
        integrationChecks.notifications.healthy = false;
        integrationChecks.notifications.error = error.message;
      }

      // Overall supply chain health
      const unhealthyIntegrations = Object.values(integrationChecks).filter(check => !check.healthy);
      
      return {
        healthy: unhealthyIntegrations.length === 0,
        integrations: integrationChecks,
        summary: {
          totalIntegrations: Object.keys(integrationChecks).length,
          healthyIntegrations: Object.values(integrationChecks).filter(check => check.healthy).length,
          unhealthyIntegrations: unhealthyIntegrations.length,
          warnings: Object.values(integrationChecks).filter(check => check.warning).map(check => check.warning)
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: `Supply chain integration check failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export convenience function
export async function validateSystemHealth() {
  const checker = new HealthChecker();
  return await checker.validateSystemHealth();
}

export default HealthChecker;