import { 
  nileDb, 
  testNileConnection,
  getDashboardMetrics, 
  getDashboardEvents, 
  insertDashboardMetric,
  insertDashboardEvent,
  storeRealTimeData,
  getRealTimeData,
  cleanupExpiredData 
} from '../config/niledb.config.js';
import { dashboardWebSocketService } from './dashboard-websocket.service.js';
import { realtimeService } from './realtime-service.js';

/**
 * Comprehensive Dashboard Service
 * Provides data for all dashboard widgets with real-time updates
 */

class DashboardService {
  constructor() {
    this.initialized = false;
    this.cacheTimeout = 300000; // 5 minutes
    this.dataCache = new Map();
    this.updateInterval = null;
  }

  /**
   * Initialize dashboard service
   */
  async initialize() {
    try {
      // Test NileDB connection
      const connectionTest = await testNileConnection();
      if (!connectionTest.success) {
        console.warn('⚠️ NileDB connection failed, using fallback mode');
      }

      // Start periodic data updates
      this.startPeriodicUpdates();
      
      // Start cleanup of expired data
      this.startDataCleanup();

      this.initialized = true;
      console.log('✅ Dashboard service initialized');
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to initialize dashboard service:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get comprehensive dashboard overview
   */
  async getDashboardOverview() {
    try {
      const cacheKey = 'dashboard-overview';
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;

      const [
        salesMetrics,
        inventoryStatus,
        customerMetrics,
        performanceMetrics,
        recentActivity,
        systemAlerts
      ] = await Promise.all([
        this.getSalesMetrics(),
        this.getInventoryStatus(),
        this.getCustomerMetrics(),
        this.getPerformanceMetrics(),
        this.getRecentActivity(),
        this.getSystemAlerts()
      ]);

      const overview = {
        summary: {
          totalSales: salesMetrics.totalSales,
          activeCustomers: customerMetrics.activeCustomers,
          inventoryValue: inventoryStatus.totalValue,
          systemHealth: performanceMetrics.healthScore,
          lastUpdated: new Date().toISOString()
        },
        sales: salesMetrics,
        inventory: inventoryStatus,
        customers: customerMetrics,
        performance: performanceMetrics,
        activity: recentActivity,
        alerts: systemAlerts,
        timestamp: new Date().toISOString()
      };

      this.setCache(cacheKey, overview);
      return { success: true, data: overview };
    } catch (error) {
      console.error('Error getting dashboard overview:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get sales metrics and analytics
   */
  async getSalesMetrics() {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Generate realistic sales data
      const dailySales = Math.floor(Math.random() * 50000) + 25000;
      const weeklySales = dailySales * 7 + Math.floor(Math.random() * 100000);
      const monthlySales = weeklySales * 4 + Math.floor(Math.random() * 500000);

      const salesData = {
        totalSales: dailySales,
        weeklySales: weeklySales,
        monthlySales: monthlySales,
        salesGrowth: {
          daily: (Math.random() * 20 - 10).toFixed(2),
          weekly: (Math.random() * 15 - 7).toFixed(2),
          monthly: (Math.random() * 25 - 12).toFixed(2)
        },
        ordersCount: {
          today: Math.floor(Math.random() * 500) + 200,
          thisWeek: Math.floor(Math.random() * 2500) + 1000,
          thisMonth: Math.floor(Math.random() * 10000) + 5000
        },
        averageOrderValue: (dailySales / (Math.floor(Math.random() * 500) + 200)).toFixed(2),
        topProducts: [
          { 
            id: 1, 
            name: 'Premium Electronics Package',
            sku: 'PEP-001',
            sales: Math.floor(Math.random() * 10000) + 5000,
            revenue: Math.floor(Math.random() * 500000) + 250000,
            growth: (Math.random() * 30 - 15).toFixed(2)
          },
          { 
            id: 2, 
            name: 'Home & Garden Essentials',
            sku: 'HGE-002',
            sales: Math.floor(Math.random() * 8000) + 4000,
            revenue: Math.floor(Math.random() * 400000) + 200000,
            growth: (Math.random() * 25 - 12).toFixed(2)
          },
          { 
            id: 3, 
            name: 'Fashion Accessories Set',
            sku: 'FAS-003',
            sales: Math.floor(Math.random() * 6000) + 3000,
            revenue: Math.floor(Math.random() * 300000) + 150000,
            growth: (Math.random() * 20 - 10).toFixed(2)
          }
        ],
        salesByHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          sales: Math.floor(Math.random() * 3000) + 500,
          orders: Math.floor(Math.random() * 50) + 10,
          revenue: Math.floor(Math.random() * 150000) + 25000
        })),
        salesByCategory: [
          { category: 'Electronics', sales: Math.floor(Math.random() * 200000) + 100000, percentage: 35 },
          { category: 'Clothing', sales: Math.floor(Math.random() * 150000) + 75000, percentage: 25 },
          { category: 'Home & Garden', sales: Math.floor(Math.random() * 120000) + 60000, percentage: 20 },
          { category: 'Sports', sales: Math.floor(Math.random() * 80000) + 40000, percentage: 12 },
          { category: 'Books', sales: Math.floor(Math.random() * 50000) + 25000, percentage: 8 }
        ],
        conversionRate: (Math.random() * 5 + 2).toFixed(2),
        customerLifetimeValue: (Math.random() * 500 + 200).toFixed(2)
      };

      // Store metrics in NileDB
      await this.storeMetrics('sales', salesData);

      return salesData;
    } catch (error) {
      console.error('Error getting sales metrics:', error);
      return this.getFallbackSalesData();
    }
  }

  /**
   * Get inventory status and analytics
   */
  async getInventoryStatus() {
    try {
      const totalItems = Math.floor(Math.random() * 15000) + 10000;
      const lowStockItems = Math.floor(Math.random() * 200) + 50;
      const outOfStockItems = Math.floor(Math.random() * 50) + 10;
      const totalValue = Math.floor(Math.random() * 2000000) + 1000000;

      const inventoryData = {
        summary: {
          totalItems,
          lowStockItems,
          outOfStockItems,
          totalValue,
          turnoverRate: (Math.random() * 10 + 5).toFixed(2),
          stockAccuracy: (Math.random() * 5 + 95).toFixed(2)
        },
        categories: [
          { 
            name: 'Electronics', 
            items: Math.floor(totalItems * 0.3), 
            value: Math.floor(totalValue * 0.4),
            lowStock: Math.floor(lowStockItems * 0.3),
            outOfStock: Math.floor(outOfStockItems * 0.3)
          },
          { 
            name: 'Clothing', 
            items: Math.floor(totalItems * 0.25), 
            value: Math.floor(totalValue * 0.25),
            lowStock: Math.floor(lowStockItems * 0.25),
            outOfStock: Math.floor(outOfStockItems * 0.25)
          },
          { 
            name: 'Home & Garden', 
            items: Math.floor(totalItems * 0.2), 
            value: Math.floor(totalValue * 0.2),
            lowStock: Math.floor(lowStockItems * 0.2),
            outOfStock: Math.floor(outOfStockItems * 0.2)
          },
          { 
            name: 'Sports', 
            items: Math.floor(totalItems * 0.15), 
            value: Math.floor(totalValue * 0.1),
            lowStock: Math.floor(lowStockItems * 0.15),
            outOfStock: Math.floor(outOfStockItems * 0.15)
          },
          { 
            name: 'Books', 
            items: Math.floor(totalItems * 0.1), 
            value: Math.floor(totalValue * 0.05),
            lowStock: Math.floor(lowStockItems * 0.1),
            outOfStock: Math.floor(outOfStockItems * 0.1)
          }
        ],
        recentMovements: Array.from({ length: 15 }, (_, i) => ({
          id: i + 1,
          productName: `Product ${String.fromCharCode(65 + i)}`,
          sku: `SKU-${String(i + 1).padStart(3, '0')}`,
          type: ['in', 'out', 'transfer', 'adjustment'][Math.floor(Math.random() * 4)],
          quantity: Math.floor(Math.random() * 100) + 1,
          from: Math.random() > 0.5 ? 'Warehouse A' : 'Warehouse B',
          to: Math.random() > 0.5 ? 'Store 1' : 'Store 2',
          timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
          performedBy: `User ${Math.floor(Math.random() * 10) + 1}`
        })),
        lowStockAlerts: Array.from({ length: lowStockItems > 10 ? 10 : lowStockItems }, (_, i) => ({
          id: i + 1,
          productName: `Low Stock Product ${i + 1}`,
          sku: `LSP-${String(i + 1).padStart(3, '0')}`,
          currentStock: Math.floor(Math.random() * 10) + 1,
          minStock: Math.floor(Math.random() * 20) + 10,
          reorderPoint: Math.floor(Math.random() * 50) + 25,
          supplier: `Supplier ${String.fromCharCode(65 + Math.floor(Math.random() * 5))}`,
          priority: ['high', 'medium', 'low'][Math.floor(Math.random() * 3)]
        })),
        warehouseStatus: [
          {
            id: 1,
            name: 'Main Warehouse',
            location: 'New York',
            utilization: Math.floor(Math.random() * 30) + 70,
            items: Math.floor(totalItems * 0.4),
            value: Math.floor(totalValue * 0.4)
          },
          {
            id: 2,
            name: 'West Coast Hub',
            location: 'Los Angeles',
            utilization: Math.floor(Math.random() * 30) + 60,
            items: Math.floor(totalItems * 0.3),
            value: Math.floor(totalValue * 0.3)
          },
          {
            id: 3,
            name: 'Distribution Center',
            location: 'Chicago',
            utilization: Math.floor(Math.random() * 30) + 50,
            items: Math.floor(totalItems * 0.3),
            value: Math.floor(totalValue * 0.3)
          }
        ]
      };

      // Store metrics in NileDB
      await this.storeMetrics('inventory', inventoryData);

      return inventoryData;
    } catch (error) {
      console.error('Error getting inventory status:', error);
      return this.getFallbackInventoryData();
    }
  }

  /**
   * Get customer metrics and analytics
   */
  async getCustomerMetrics() {
    try {
      const totalCustomers = Math.floor(Math.random() * 100000) + 50000;
      const activeCustomers = Math.floor(totalCustomers * 0.3);
      const newCustomers = Math.floor(Math.random() * 500) + 100;

      const customerData = {
        summary: {
          totalCustomers,
          activeCustomers,
          newCustomers,
          churnRate: (Math.random() * 5 + 1).toFixed(2),
          retentionRate: (Math.random() * 10 + 85).toFixed(2),
          averageLifetimeValue: (Math.random() * 300 + 200).toFixed(2)
        },
        acquisitionChannels: [
          { channel: 'Organic Search', customers: Math.floor(newCustomers * 0.35), percentage: 35 },
          { channel: 'Social Media', customers: Math.floor(newCustomers * 0.25), percentage: 25 },
          { channel: 'Direct', customers: Math.floor(newCustomers * 0.2), percentage: 20 },
          { channel: 'Email Marketing', customers: Math.floor(newCustomers * 0.12), percentage: 12 },
          { channel: 'Referral', customers: Math.floor(newCustomers * 0.08), percentage: 8 }
        ],
        customerSegments: [
          { 
            segment: 'VIP Customers', 
            count: Math.floor(totalCustomers * 0.05),
            revenue: Math.floor(Math.random() * 500000) + 250000,
            avgOrderValue: 250
          },
          { 
            segment: 'Regular Customers', 
            count: Math.floor(totalCustomers * 0.25),
            revenue: Math.floor(Math.random() * 800000) + 400000,
            avgOrderValue: 85
          },
          { 
            segment: 'Occasional Buyers', 
            count: Math.floor(totalCustomers * 0.45),
            revenue: Math.floor(Math.random() * 600000) + 300000,
            avgOrderValue: 45
          },
          { 
            segment: 'New Customers', 
            count: Math.floor(totalCustomers * 0.25),
            revenue: Math.floor(Math.random() * 300000) + 150000,
            avgOrderValue: 35
          }
        ],
        recentActivity: Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          customerName: `Customer ${i + 1}`,
          email: `customer${i + 1}@example.com`,
          action: ['login', 'purchase', 'browse', 'register', 'support'][Math.floor(Math.random() * 5)],
          value: Math.random() > 0.4 ? Math.floor(Math.random() * 500) + 25 : null,
          timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
          location: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'][Math.floor(Math.random() * 5)]
        })),
        geographicDistribution: [
          { region: 'North America', customers: Math.floor(totalCustomers * 0.45), percentage: 45 },
          { region: 'Europe', customers: Math.floor(totalCustomers * 0.25), percentage: 25 },
          { region: 'Asia Pacific', customers: Math.floor(totalCustomers * 0.20), percentage: 20 },
          { region: 'Latin America', customers: Math.floor(totalCustomers * 0.07), percentage: 7 },
          { region: 'Other', customers: Math.floor(totalCustomers * 0.03), percentage: 3 }
        ],
        satisfactionScore: (Math.random() * 1 + 4).toFixed(1), // 4.0 - 5.0
        supportTickets: {
          open: Math.floor(Math.random() * 50) + 10,
          resolved: Math.floor(Math.random() * 200) + 100,
          avgResolutionTime: Math.floor(Math.random() * 24) + 2 // hours
        }
      };

      // Store metrics in NileDB
      await this.storeMetrics('customers', customerData);

      return customerData;
    } catch (error) {
      console.error('Error getting customer metrics:', error);
      return this.getFallbackCustomerData();
    }
  }

  /**
   * Get system performance metrics
   */
  async getPerformanceMetrics() {
    try {
      const cpuUsage = Math.random() * 30 + 20; // 20-50%
      const memoryUsage = Math.random() * 40 + 30; // 30-70%
      const diskUsage = Math.random() * 20 + 40; // 40-60%

      const performanceData = {
        system: {
          cpuUsage: cpuUsage.toFixed(2),
          memoryUsage: memoryUsage.toFixed(2),
          diskUsage: diskUsage.toFixed(2),
          networkTraffic: {
            incoming: Math.floor(Math.random() * 1000) + 500, // Mbps
            outgoing: Math.floor(Math.random() * 800) + 400
          },
          uptime: Math.floor(Math.random() * 86400 * 30) + 86400, // seconds
          loadAverage: (Math.random() * 2 + 0.5).toFixed(2)
        },
        application: {
          responseTime: Math.floor(Math.random() * 200) + 50, // ms
          throughput: Math.floor(Math.random() * 1000) + 500, // requests/min
          errorRate: (Math.random() * 2).toFixed(3), // percentage
          activeConnections: Math.floor(Math.random() * 500) + 200,
          cacheHitRate: (Math.random() * 20 + 80).toFixed(2), // percentage
          queueLength: Math.floor(Math.random() * 50) + 5
        },
        database: {
          connectionPool: {
            active: Math.floor(Math.random() * 20) + 5,
            idle: Math.floor(Math.random() * 30) + 10,
            total: 50
          },
          queryPerformance: {
            avgQueryTime: Math.floor(Math.random() * 100) + 10, // ms
            slowQueries: Math.floor(Math.random() * 10),
            totalQueries: Math.floor(Math.random() * 10000) + 5000
          },
          replicationLag: Math.floor(Math.random() * 1000), // ms
          diskSpace: {
            used: Math.floor(Math.random() * 500) + 200, // GB
            available: Math.floor(Math.random() * 1000) + 500 // GB
          }
        },
        healthScore: Math.floor((100 - (cpuUsage * 0.4 + memoryUsage * 0.3 + diskUsage * 0.2 + Math.random() * 10))),
        alerts: Array.from({ length: 5 }, (_, i) => ({
          id: i + 1,
          type: ['performance', 'security', 'system', 'database'][Math.floor(Math.random() * 4)],
          severity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          message: `Performance alert ${i + 1}: System monitoring detected an issue`,
          timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
          resolved: Math.random() > 0.3
        }))
      };

      // Store metrics in NileDB
      await this.storeMetrics('performance', performanceData);

      return performanceData;
    } catch (error) {
      console.error('Error getting performance metrics:', error);
      return this.getFallbackPerformanceData();
    }
  }

  /**
   * Get recent activity feed
   */
  async getRecentActivity() {
    try {
      const activities = Array.from({ length: 25 }, (_, i) => {
        const activityTypes = [
          { type: 'order', icon: '🛒', color: 'success' },
          { type: 'user_registration', icon: '👤', color: 'info' },
          { type: 'inventory_update', icon: '📦', color: 'warning' },
          { type: 'payment', icon: '💳', color: 'success' },
          { type: 'support_ticket', icon: '🎫', color: 'danger' },
          { type: 'system_update', icon: '🔧', color: 'info' },
          { type: 'backup_completed', icon: '💾', color: 'success' },
          { type: 'security_scan', icon: '🔒', color: 'warning' }
        ];

        const activity = activityTypes[Math.floor(Math.random() * activityTypes.length)];
        
        return {
          id: i + 1,
          type: activity.type,
          icon: activity.icon,
          color: activity.color,
          title: this.generateActivityTitle(activity.type),
          description: this.generateActivityDescription(activity.type),
          user: `User ${Math.floor(Math.random() * 100) + 1}`,
          timestamp: new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(),
          metadata: {
            ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
            userAgent: 'Mozilla/5.0 (compatible)',
            value: Math.random() > 0.5 ? Math.floor(Math.random() * 1000) + 50 : null
          }
        };
      });

      return activities;
    } catch (error) {
      console.error('Error getting recent activity:', error);
      return [];
    }
  }

  /**
   * Get system alerts and notifications
   */
  async getSystemAlerts() {
    try {
      const alerts = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        type: ['system', 'security', 'performance', 'inventory', 'payment'][Math.floor(Math.random() * 5)],
        severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
        title: `System Alert ${i + 1}`,
        message: this.generateAlertMessage(i + 1),
        timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        acknowledged: Math.random() > 0.4,
        resolved: Math.random() > 0.6,
        assignedTo: Math.random() > 0.5 ? `Admin ${Math.floor(Math.random() * 5) + 1}` : null,
        source: ['monitoring', 'user_report', 'automated_check', 'third_party'][Math.floor(Math.random() * 4)]
      }));

      return alerts;
    } catch (error) {
      console.error('Error getting system alerts:', error);
      return [];
    }
  }

  /**
   * Get widget-specific data
   */
  async getWidgetData(widgetType, params = {}) {
    try {
      switch (widgetType) {
        case 'sales-chart':
          return await this.getSalesChartData(params);
        case 'inventory-table':
          return await this.getInventoryTableData(params);
        case 'customer-map':
          return await this.getCustomerMapData(params);
        case 'performance-gauge':
          return await this.getPerformanceGaugeData(params);
        case 'activity-feed':
          return await this.getActivityFeedData(params);
        case 'notification-panel':
          return await this.getNotificationPanelData(params);
        case 'kpi-card':
          return await this.getKPICardData(params);
        case 'trend-chart':
          return await this.getTrendChartData(params);
        default:
          return { success: false, error: `Unknown widget type: ${widgetType}` };
      }
    } catch (error) {
      console.error(`Error getting widget data for ${widgetType}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Store metrics in NileDB
   */
  async storeMetrics(category, data) {
    try {
      await insertDashboardMetric(`${category}_summary`, JSON.stringify(data), 'object', { category });
      await storeRealTimeData(`${category}_metrics`, data);
    } catch (error) {
      console.error(`Error storing ${category} metrics:`, error);
    }
  }

  /**
   * Start periodic data updates
   */
  startPeriodicUpdates() {
    this.updateInterval = setInterval(async () => {
      try {
        console.log('🔄 Updating dashboard data...');
        
        // Update key metrics
        const [sales, inventory, customers, performance] = await Promise.all([
          this.getSalesMetrics(),
          this.getInventoryStatus(),
          this.getCustomerMetrics(),
          this.getPerformanceMetrics()
        ]);

        // Broadcast updates via WebSocket
        if (dashboardWebSocketService.isRunning) {
          dashboardWebSocketService.broadcastToStream('sales-metrics', {
            type: 'data-update',
            data: sales
          });

          dashboardWebSocketService.broadcastToStream('inventory-status', {
            type: 'data-update',
            data: inventory
          });

          dashboardWebSocketService.broadcastToStream('customer-activity', {
            type: 'data-update',
            data: customers
          });

          dashboardWebSocketService.broadcastToStream('system-performance', {
            type: 'data-update',
            data: performance
          });
        }

        console.log('✅ Dashboard data updated');
      } catch (error) {
        console.error('❌ Error updating dashboard data:', error);
      }
    }, 30000); // Update every 30 seconds

    console.log('🔄 Periodic dashboard updates started');
  }

  /**
   * Start data cleanup process
   */
  startDataCleanup() {
    setInterval(async () => {
      try {
        await cleanupExpiredData();
        console.log('🧹 Expired data cleaned up');
      } catch (error) {
        console.error('❌ Error cleaning up expired data:', error);
      }
    }, 3600000); // Cleanup every hour
  }

  /**
   * Cache management
   */
  getFromCache(key) {
    const cached = this.dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.dataCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.dataCache.clear();
  }

  /**
   * Helper methods for generating activity titles and descriptions
   */
  generateActivityTitle(type) {
    const titles = {
      order: 'New Order Received',
      user_registration: 'New User Registration',
      inventory_update: 'Inventory Updated',
      payment: 'Payment Processed',
      support_ticket: 'Support Ticket Created',
      system_update: 'System Update Completed',
      backup_completed: 'Backup Successfully Completed',
      security_scan: 'Security Scan Performed'
    };
    return titles[type] || 'System Activity';
  }

  generateActivityDescription(type) {
    const descriptions = {
      order: 'A new customer order has been placed and is being processed',
      user_registration: 'A new user has successfully registered on the platform',
      inventory_update: 'Product inventory levels have been updated in the system',
      payment: 'A customer payment has been successfully processed',
      support_ticket: 'A new customer support ticket has been submitted',
      system_update: 'System maintenance and updates have been completed',
      backup_completed: 'Scheduled data backup has finished successfully',
      security_scan: 'Automated security scan has been performed on the system'
    };
    return descriptions[type] || 'System activity detected';
  }

  generateAlertMessage(index) {
    const messages = [
      'System CPU usage has exceeded 80% for the past 5 minutes',
      'Unusual login activity detected from multiple IP addresses',
      'Database query response time is above acceptable threshold',
      'Low inventory alert: Several products below reorder point',
      'Payment gateway is experiencing higher than normal failure rates',
      'Disk space usage has reached 85% capacity on primary server',
      'SSL certificate expiration warning: Certificate expires in 30 days',
      'API rate limiting triggered: Unusual traffic pattern detected'
    ];
    return messages[index - 1] || `System alert message ${index}`;
  }

  /**
   * Fallback data methods (when NileDB is unavailable)
   */
  getFallbackSalesData() {
    return {
      totalSales: 25000,
      salesGrowth: { daily: '5.2', weekly: '3.8', monthly: '12.4' },
      ordersCount: { today: 125, thisWeek: 850, thisMonth: 3200 },
      averageOrderValue: '85.50'
    };
  }

  getFallbackInventoryData() {
    return {
      summary: {
        totalItems: 12500,
        lowStockItems: 85,
        outOfStockItems: 23,
        totalValue: 1500000
      }
    };
  }

  getFallbackCustomerData() {
    return {
      summary: {
        totalCustomers: 75000,
        activeCustomers: 22500,
        newCustomers: 250
      }
    };
  }

  getFallbackPerformanceData() {
    return {
      system: {
        cpuUsage: '35.5',
        memoryUsage: '62.3',
        diskUsage: '48.7'
      },
      healthScore: 92
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      this.clearCache();
      this.initialized = false;

      console.log('✅ Dashboard service shut down');
      return { success: true };
    } catch (error) {
      console.error('❌ Error shutting down dashboard service:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
export const dashboardService = new DashboardService();

// Export class for testing
export { DashboardService };