import { db } from '../config/database.js';
import { timeSeriesMetrics } from '../db/schema.js';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { createClient } from 'redis';

/**
 * Comprehensive Security Monitoring and Alerting Service
 */
class SecurityMonitoringService {
  constructor() {
    this.initialized = false;
    this.redis = null;
    this.alertThresholds = {
      // Rate limiting violations
      rateLimitViolations: {
        threshold: 10,
        timeWindow: 5 * 60 * 1000, // 5 minutes
        severity: 'HIGH'
      },
      
      // Failed authentication attempts
      authFailures: {
        threshold: 5,
        timeWindow: 15 * 60 * 1000, // 15 minutes
        severity: 'HIGH'
      },
      
      // SQL injection attempts
      sqlInjectionAttempts: {
        threshold: 1,
        timeWindow: 60 * 1000, // 1 minute
        severity: 'CRITICAL'
      },
      
      // XSS attempts
      xssAttempts: {
        threshold: 1,
        timeWindow: 60 * 1000, // 1 minute
        severity: 'CRITICAL'
      },
      
      // Large file uploads
      largeFileUploads: {
        threshold: 5,
        timeWindow: 10 * 60 * 1000, // 10 minutes
        severity: 'MEDIUM'
      },
      
      // Suspicious IP activity
      suspiciousIPActivity: {
        threshold: 50,
        timeWindow: 15 * 60 * 1000, // 15 minutes
        severity: 'HIGH'
      },
      
      // Error rate spike
      errorRateSpike: {
        threshold: 25,
        timeWindow: 5 * 60 * 1000, // 5 minutes
        severity: 'MEDIUM'
      },
      
      // Brute force attempts
      bruteForceAttempts: {
        threshold: 10,
        timeWindow: 10 * 60 * 1000, // 10 minutes
        severity: 'HIGH'
      }
    };
    
    this.activeAlerts = new Map();
    this.alertCallbacks = new Map();
    this.securityMetrics = {
      totalEvents: 0,
      criticalAlerts: 0,
      highAlerts: 0,
      mediumAlerts: 0,
      lowAlerts: 0,
      lastScanTime: null,
      lastComprehensiveScan: null,
      skippedScans: 0
    };
  }

  async initialize() {
    try {
      // Try to connect to Redis for real-time alerting
      if (process.env.REDIS_URL) {
        const redisConfig = {
          url: process.env.REDIS_URL,
          // Only set password if it exists and is not empty
          ...(process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== '' && {
            password: process.env.REDIS_PASSWORD
          }),
        };
        this.redis = createClient(redisConfig);
        await this.redis.connect();
        console.log('✅ Security Monitoring: Redis connected');
      }

      // Start continuous monitoring
      this.startContinuousMonitoring();
      
      // Setup alert handlers
      this.setupAlertHandlers();
      
      this.initialized = true;
      console.log('✅ Security Monitoring Service initialized');
    } catch (error) {
      console.error('❌ Security Monitoring initialization failed:', error);
      // Continue without Redis
      this.startContinuousMonitoring();
      this.setupAlertHandlers();
      this.initialized = true;
    }
  }

  /**
   * Start optimized continuous monitoring prioritizing API responsiveness
   */
  startContinuousMonitoring() {
    // OPTIMIZED: Reduced frequency during business hours, increased during off-peak
    // Real-time monitoring with adaptive intervals
    setInterval(() => {
      this.adaptiveSecurityScan();
    }, 60000); // Reduced from 30s to 1 minute

    // Comprehensive security scan - only during off-peak hours
    setInterval(() => {
      this.scheduleComprehensiveScan();
    }, 15 * 60 * 1000); // Check every 15 minutes if comprehensive scan should run

    // Alert cleanup every 2 hours (reduced frequency)
    setInterval(() => {
      this.cleanupExpiredAlerts();
    }, 2 * 60 * 60 * 1000);

    console.log('🔍 Optimized security monitoring started with API priority');
  }

  /**
   * Setup alert handlers for different notification channels
   */
  setupAlertHandlers() {
    // Console logging (always enabled)
    this.registerAlertHandler('console', (alert) => {
      const emoji = this.getSeverityEmoji(alert.severity);
      console.warn(`${emoji} SECURITY ALERT [${alert.severity}]: ${alert.type}`);
      console.warn(`Details:`, alert.details);
      console.warn(`Triggered at: ${alert.timestamp}`);
    });

    // Email alerts (if configured)
    if (process.env.SMTP_HOST) {
      this.registerAlertHandler('email', (alert) => {
        this.sendEmailAlert(alert);
      });
    }

    // Slack alerts (if configured)
    if (process.env.SLACK_WEBHOOK_URL) {
      this.registerAlertHandler('slack', (alert) => {
        this.sendSlackAlert(alert);
      });
    }

    // Database logging
    this.registerAlertHandler('database', (alert) => {
      this.logAlertToDatabase(alert);
    });
  }

  /**
   * Register an alert handler
   */
  registerAlertHandler(name, handler) {
    this.alertCallbacks.set(name, handler);
  }

  /**
   * Adaptive security scan that adjusts based on system load and time
   */
  async adaptiveSecurityScan() {
    try {
      // Check system load before performing heavy operations
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      const currentHour = new Date().getHours();
      const isBusinessHours = currentHour >= 9 && currentHour <= 18;
      
      // Skip scan if system is under high load during business hours
      if (isBusinessHours && memUsagePercent > 80) {
        console.log(`Skipping security scan due to high load (${memUsagePercent.toFixed(1)}%) during business hours`);
        return;
      }

      const now = new Date();
      const alerts = [];

      // Always check critical security threats
      const criticalChecks = [
        this.checkRateLimitViolations(),
        this.checkInjectionAttempts()
      ];

      // Add less critical checks only during off-peak hours or low load
      if (!isBusinessHours || memUsagePercent < 60) {
        criticalChecks.push(
          this.checkAuthenticationFailures(),
          this.checkSuspiciousIPActivity()
        );
      }

      const results = await Promise.allSettled(criticalChecks);
      
      // Process successful results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          alerts.push(...result.value);
        } else if (result.status === 'rejected') {
          console.error(`Security check ${index} failed:`, result.reason);
        }
      });

      // Process alerts with throttling
      for (const alert of alerts) {
        await this.processAlert(alert);
        // Add small delay between alerts during business hours
        if (isBusinessHours && alerts.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.securityMetrics.lastScanTime = now;
      this.securityMetrics.totalEvents += alerts.length;

    } catch (error) {
      console.error('Error during adaptive security scan:', error);
    }
  }

  /**
   * Legacy method for immediate security threat scanning
   */
  async scanForSecurityThreats() {
    try {
      const now = new Date();
      const alerts = [];

      // Check for rate limit violations
      const rateLimitViolations = await this.checkRateLimitViolations();
      if (rateLimitViolations.length > 0) {
        alerts.push(...rateLimitViolations);
      }

      // Check for authentication failures
      const authFailures = await this.checkAuthenticationFailures();
      if (authFailures.length > 0) {
        alerts.push(...authFailures);
      }

      // Check for injection attacks
      const injectionAttempts = await this.checkInjectionAttempts();
      if (injectionAttempts.length > 0) {
        alerts.push(...injectionAttempts);
      }

      // Check for suspicious IP activity
      const suspiciousIPs = await this.checkSuspiciousIPActivity();
      if (suspiciousIPs.length > 0) {
        alerts.push(...suspiciousIPs);
      }

      // Process all alerts
      for (const alert of alerts) {
        await this.processAlert(alert);
      }

      this.securityMetrics.lastScanTime = now;
      this.securityMetrics.totalEvents += alerts.length;

    } catch (error) {
      console.error('Error during security threat scan:', error);
    }
  }

  /**
   * Check for rate limit violations
   */
  async checkRateLimitViolations() {
    const threshold = this.alertThresholds.rateLimitViolations;
    const since = new Date(Date.now() - threshold.timeWindow);
    
    try {
      const violations = await db
        .select({
          ip: timeSeriesMetrics.dimension2,
          count: sql`COUNT(*)`.as('count')
        })
        .from(timeSeriesMetrics)
        .where(and(
          eq(timeSeriesMetrics.metricName, 'ddos_protection_event'),
          eq(timeSeriesMetrics.dimension1, 'RATE_LIMIT_EXCEEDED'),
          gte(timeSeriesMetrics.timestamp, since)
        ))
        .groupBy(timeSeriesMetrics.dimension2)
        .having(sql`COUNT(*) >= ${threshold.threshold}`);

      return violations.map(v => ({
        type: 'RATE_LIMIT_VIOLATIONS',
        severity: threshold.severity,
        details: {
          ip: v.ip,
          violationCount: v.count,
          timeWindow: threshold.timeWindow / 1000 / 60, // minutes
          threshold: threshold.threshold
        },
        timestamp: new Date(),
        source: 'security_monitoring'
      }));
    } catch (error) {
      console.error('Error checking rate limit violations:', error);
      return [];
    }
  }

  /**
   * Check for authentication failures
   */
  async checkAuthenticationFailures() {
    const threshold = this.alertThresholds.authFailures;
    const since = new Date(Date.now() - threshold.timeWindow);
    
    try {
      const failures = await db
        .select({
          ip: timeSeriesMetrics.dimension2,
          count: sql`COUNT(*)`.as('count')
        })
        .from(timeSeriesMetrics)
        .where(and(
          eq(timeSeriesMetrics.metricName, 'security_event'),
          eq(timeSeriesMetrics.dimension1, 'AUTH_FAILURE'),
          gte(timeSeriesMetrics.timestamp, since)
        ))
        .groupBy(timeSeriesMetrics.dimension2)
        .having(sql`COUNT(*) >= ${threshold.threshold}`);

      return failures.map(f => ({
        type: 'AUTHENTICATION_FAILURES',
        severity: threshold.severity,
        details: {
          ip: f.ip,
          failureCount: f.count,
          timeWindow: threshold.timeWindow / 1000 / 60, // minutes
          threshold: threshold.threshold
        },
        timestamp: new Date(),
        source: 'security_monitoring'
      }));
    } catch (error) {
      console.error('Error checking authentication failures:', error);
      return [];
    }
  }

  /**
   * Check for injection attempts (SQL, XSS, etc.)
   */
  async checkInjectionAttempts() {
    const sqlThreshold = this.alertThresholds.sqlInjectionAttempts;
    const xssThreshold = this.alertThresholds.xssAttempts;
    const since = new Date(Date.now() - Math.max(sqlThreshold.timeWindow, xssThreshold.timeWindow));
    
    try {
      const injectionAttempts = await db
        .select({
          type: timeSeriesMetrics.dimension1,
          ip: timeSeriesMetrics.dimension2,
          endpoint: timeSeriesMetrics.dimension3,
          count: sql`COUNT(*)`.as('count')
        })
        .from(timeSeriesMetrics)
        .where(and(
          eq(timeSeriesMetrics.metricName, 'security_event'),
          sql`dimension1 IN ('SQL_INJECTION_ATTEMPT', 'XSS_ATTEMPT')`,
          gte(timeSeriesMetrics.timestamp, since)
        ))
        .groupBy(timeSeriesMetrics.dimension1, timeSeriesMetrics.dimension2, timeSeriesMetrics.dimension3);

      const alerts = [];
      
      for (const attempt of injectionAttempts) {
        const isSQL = attempt.type === 'SQL_INJECTION_ATTEMPT';
        const threshold = isSQL ? sqlThreshold : xssThreshold;
        
        if (attempt.count >= threshold.threshold) {
          alerts.push({
            type: isSQL ? 'SQL_INJECTION_ATTACK' : 'XSS_ATTACK',
            severity: threshold.severity,
            details: {
              attackType: attempt.type,
              ip: attempt.ip,
              endpoint: attempt.endpoint,
              attemptCount: attempt.count,
              timeWindow: threshold.timeWindow / 1000 / 60, // minutes
              threat: 'CRITICAL'
            },
            timestamp: new Date(),
            source: 'security_monitoring'
          });
        }
      }

      return alerts;
    } catch (error) {
      console.error('Error checking injection attempts:', error);
      return [];
    }
  }

  /**
   * Check for suspicious IP activity
   */
  async checkSuspiciousIPActivity() {
    const threshold = this.alertThresholds.suspiciousIPActivity;
    const since = new Date(Date.now() - threshold.timeWindow);
    
    try {
      const suspiciousActivity = await db
        .select({
          ip: timeSeriesMetrics.dimension2,
          eventTypes: sql`STRING_AGG(DISTINCT dimension1, ',')`.as('eventTypes'),
          count: sql`COUNT(*)`.as('count')
        })
        .from(timeSeriesMetrics)
        .where(and(
          eq(timeSeriesMetrics.metricName, 'security_event'),
          gte(timeSeriesMetrics.timestamp, since)
        ))
        .groupBy(timeSeriesMetrics.dimension2)
        .having(sql`COUNT(*) >= ${threshold.threshold}`);

      return suspiciousActivity.map(activity => ({
        type: 'SUSPICIOUS_IP_ACTIVITY',
        severity: threshold.severity,
        details: {
          ip: activity.ip,
          eventCount: activity.count,
          eventTypes: activity.eventTypes.split(','),
          timeWindow: threshold.timeWindow / 1000 / 60, // minutes
          threshold: threshold.threshold
        },
        timestamp: new Date(),
        source: 'security_monitoring'
      }));
    } catch (error) {
      console.error('Error checking suspicious IP activity:', error);
      return [];
    }
  }

  /**
   * Schedule comprehensive scan only during off-peak hours
   */
  async scheduleComprehensiveScan() {
    const currentHour = new Date().getHours();
    const isOffPeakHours = currentHour >= 1 && currentHour <= 5; // 1 AM to 5 AM
    
    if (!isOffPeakHours) {
      return; // Skip comprehensive scan during business and evening hours
    }

    // Check if comprehensive scan was recently run (within last 4 hours)
    const lastComprehensiveScan = this.securityMetrics.lastComprehensiveScan;
    if (lastComprehensiveScan) {
      const hoursSinceLastScan = (Date.now() - new Date(lastComprehensiveScan).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastScan < 4) {
        return; // Skip if run within last 4 hours
      }
    }

    await this.performComprehensiveScan();
    this.securityMetrics.lastComprehensiveScan = new Date().toISOString();
  }

  /**
   * Perform comprehensive security scan (optimized for off-peak execution)
   */
  async performComprehensiveScan() {
    try {
      console.log('🔍 Performing comprehensive security scan (off-peak mode)...');
      
      // Add delays between checks to prevent overwhelming the system
      await this.checkSystemHealth();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      
      await this.checkDatabaseIntegrity();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      
      // Skip file system and network checks if memory usage is high
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (memUsagePercent < 75) {
        await this.checkFileSystemSecurity();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await this.checkNetworkSecurity();
      } else {
        console.log('Skipping file system and network checks due to high memory usage');
      }
      
      console.log('✅ Comprehensive security scan completed');
    } catch (error) {
      console.error('Error during comprehensive security scan:', error);
    }
  }

  /**
   * Check system health for security issues
   */
  async checkSystemHealth() {
    const alerts = [];
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    if (memUsagePercent > 90) {
      alerts.push({
        type: 'HIGH_MEMORY_USAGE',
        severity: 'MEDIUM',
        details: {
          memoryUsagePercent: memUsagePercent.toFixed(2),
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal
        },
        timestamp: new Date(),
        source: 'system_health'
      });
    }

    // Check error rates
    const errorRate = await this.calculateRecentErrorRate();
    if (errorRate > 10) { // 10% error rate
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'HIGH',
        details: {
          errorRate: errorRate.toFixed(2),
          threshold: 10
        },
        timestamp: new Date(),
        source: 'system_health'
      });
    }

    // Process alerts
    for (const alert of alerts) {
      await this.processAlert(alert);
    }
  }

  /**
   * Calculate recent error rate
   */
  async calculateRecentErrorRate() {
    try {
      const since = new Date(Date.now() - 15 * 60 * 1000); // Last 15 minutes
      
      const [errorCount, totalCount] = await Promise.all([
        db.select({ count: sql`COUNT(*)` })
          .from(timeSeriesMetrics)
          .where(and(
            eq(timeSeriesMetrics.metricName, 'api_error'),
            gte(timeSeriesMetrics.timestamp, since)
          )),
        db.select({ count: sql`COUNT(*)` })
          .from(timeSeriesMetrics)
          .where(and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, since)
          ))
      ]);

      const errors = errorCount[0]?.count || 0;
      const total = totalCount[0]?.count || 1;
      
      return (errors / total) * 100;
    } catch (error) {
      console.error('Error calculating error rate:', error);
      return 0;
    }
  }

  /**
   * Check database integrity
   */
  async checkDatabaseIntegrity() {
    try {
      // Check for unusual data patterns
      // This is a placeholder for more sophisticated integrity checks
      const alerts = [];

      // Example: Check for unusual data volumes
      const recentDataVolume = await db
        .select({ count: sql`COUNT(*)` })
        .from(timeSeriesMetrics)
        .where(gte(timeSeriesMetrics.timestamp, new Date(Date.now() - 60 * 60 * 1000)));

      const dataCount = recentDataVolume[0]?.count || 0;
      if (dataCount > 100000) { // Unusual volume threshold
        alerts.push({
          type: 'UNUSUAL_DATA_VOLUME',
          severity: 'MEDIUM',
          details: {
            dataCount,
            timeWindow: '1 hour',
            threshold: 100000
          },
          timestamp: new Date(),
          source: 'database_integrity'
        });
      }

      // Process alerts
      for (const alert of alerts) {
        await this.processAlert(alert);
      }
    } catch (error) {
      console.error('Error checking database integrity:', error);
    }
  }

  /**
   * Check file system security
   */
  async checkFileSystemSecurity() {
    // Placeholder for file system security checks
    // In a real implementation, this would check for:
    // - Unusual file access patterns
    // - Suspicious file modifications
    // - Unauthorized file uploads
    // - File permission changes
  }

  /**
   * Check network security
   */
  async checkNetworkSecurity() {
    // Placeholder for network security checks
    // In a real implementation, this would check for:
    // - Unusual network traffic patterns
    // - Connection attempts from blacklisted IPs
    // - DDoS attack patterns
    // - Port scanning attempts
  }

  /**
   * Process security alert
   */
  async processAlert(alert) {
    const alertKey = `${alert.type}_${alert.details.ip || 'system'}_${Date.now()}`;
    
    // Check if similar alert already exists
    const existingAlert = this.findSimilarAlert(alert);
    if (existingAlert) {
      existingAlert.count++;
      existingAlert.lastOccurrence = alert.timestamp;
      return;
    }

    // Add to active alerts
    this.activeAlerts.set(alertKey, {
      ...alert,
      id: alertKey,
      count: 1,
      firstOccurrence: alert.timestamp,
      lastOccurrence: alert.timestamp,
      status: 'ACTIVE'
    });

    // Update metrics
    this.updateAlertMetrics(alert.severity);

    // Trigger all alert handlers
    for (const [name, handler] of this.alertCallbacks) {
      try {
        await handler(alert);
      } catch (error) {
        console.error(`Error in alert handler ${name}:`, error);
      }
    }

    console.log(`🚨 Security alert processed: ${alert.type} [${alert.severity}]`);
  }

  /**
   * Find similar existing alert
   */
  findSimilarAlert(newAlert) {
    for (const [key, existingAlert] of this.activeAlerts) {
      if (existingAlert.type === newAlert.type &&
          existingAlert.details.ip === newAlert.details.ip &&
          Date.now() - existingAlert.lastOccurrence.getTime() < 60 * 1000) { // Within 1 minute
        return existingAlert;
      }
    }
    return null;
  }

  /**
   * Update alert metrics
   */
  updateAlertMetrics(severity) {
    switch (severity) {
      case 'CRITICAL':
        this.securityMetrics.criticalAlerts++;
        break;
      case 'HIGH':
        this.securityMetrics.highAlerts++;
        break;
      case 'MEDIUM':
        this.securityMetrics.mediumAlerts++;
        break;
      case 'LOW':
        this.securityMetrics.lowAlerts++;
        break;
    }
  }

  /**
   * Clean up expired alerts
   */
  cleanupExpiredAlerts() {
    const now = Date.now();
    const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, alert] of this.activeAlerts) {
      if (now - alert.lastOccurrence.getTime() > expiryTime) {
        this.activeAlerts.delete(key);
      }
    }
  }

  /**
   * Log alert to database
   */
  async logAlertToDatabase(alert) {
    try {
      await db.insert(timeSeriesMetrics).values({
        timestamp: alert.timestamp,
        metricName: 'security_alert',
        metricType: 'counter',
        dimension1: alert.type,
        dimension2: alert.severity,
        dimension3: alert.source,
        value: 1,
        tags: {
          ...alert.details,
          alertId: alert.id || 'unknown'
        }
      });
    } catch (error) {
      console.error('Error logging alert to database:', error);
    }
  }

  /**
   * Send email alert (placeholder)
   */
  async sendEmailAlert(alert) {
    // Placeholder for email integration
    console.log(`📧 Email alert would be sent: ${alert.type}`);
  }

  /**
   * Send Slack alert (placeholder)
   */
  async sendSlackAlert(alert) {
    // Placeholder for Slack integration
    console.log(`💬 Slack alert would be sent: ${alert.type}`);
  }

  /**
   * Get severity emoji
   */
  getSeverityEmoji(severity) {
    const emojiMap = {
      'CRITICAL': '🔴',
      'HIGH': '🟠',
      'MEDIUM': '🟡',
      'LOW': '🟢'
    };
    return emojiMap[severity] || '🔵';
  }

  /**
   * Get security dashboard data
   */
  getSecurityDashboard() {
    return {
      metrics: this.securityMetrics,
      activeAlerts: Array.from(this.activeAlerts.values()),
      alertThresholds: this.alertThresholds,
      alertHandlers: Array.from(this.alertCallbacks.keys()),
      systemStatus: {
        initialized: this.initialized,
        redisConnected: !!this.redis,
        lastScanTime: this.securityMetrics.lastScanTime
      }
    };
  }

  /**
   * Update alert threshold
   */
  updateAlertThreshold(alertType, newThreshold) {
    if (this.alertThresholds[alertType]) {
      this.alertThresholds[alertType] = { ...this.alertThresholds[alertType], ...newThreshold };
      console.log(`Updated alert threshold for ${alertType}:`, this.alertThresholds[alertType]);
    }
  }

  /**
   * Manually trigger alert
   */
  async triggerManualAlert(type, severity, details) {
    const alert = {
      type,
      severity,
      details,
      timestamp: new Date(),
      source: 'manual'
    };
    
    await this.processAlert(alert);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.disconnect();
    }
  }
}

// Export singleton instance
export const securityMonitoringService = new SecurityMonitoringService();
export default securityMonitoringService;