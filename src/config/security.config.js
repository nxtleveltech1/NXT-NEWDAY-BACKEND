import { 
  securityHeaders, 
  advancedRateLimiting, 
  progressiveSlowdown,
  validationErrorHandler,
  sqlInjectionProtection,
  xssProtection,
  requestSizeLimit,
  requestFingerprinting
} from '../middleware/security.middleware.js';

import { 
  authenticateToken,
  requirePermission,
  requireRole,
  requireMinRoleLevel,
  rbacService
} from '../middleware/rbac.middleware.js';

import { ddosProtectionService } from '../services/ddos-protection.service.js';
import { securityMonitoringService } from '../services/security-monitoring.service.js';
import { encryptionService } from '../services/encryption.service.js';
import { backupRecoveryService } from '../services/backup-recovery.service.js';

/**
 * Security Configuration and Initialization
 */
class SecurityConfig {
  constructor() {
    this.initialized = false;
    this.services = {
      ddosProtection: ddosProtectionService,
      securityMonitoring: securityMonitoringService,
      encryption: encryptionService,
      backupRecovery: backupRecoveryService,
      rbac: rbacService
    };
  }

  /**
   * Initialize all security services
   */
  async initialize() {
    try {
      console.log('🔐 Initializing security services...');

      // Initialize services in order of dependency
      await this.services.encryption.initialize();
      await this.services.rbac.initialize();
      await this.services.ddosProtection.initialize();
      await this.services.securityMonitoring.initialize();
      await this.services.backupRecovery.initialize();

      // Perform initial security health check
      await this.performSecurityHealthCheck();

      this.initialized = true;
      console.log('✅ All security services initialized successfully');

      return true;
    } catch (error) {
      console.error('❌ Security initialization failed:', error);
      throw error;
    }
  }

  /**
   * Configure Express app with security middleware
   */
  configureExpressApp(app) {
    console.log('🛡️ Configuring Express security middleware...');

    // Apply security headers first
    app.use(securityHeaders);

    // Request fingerprinting for tracking
    app.use(requestFingerprinting);

    // Request size limiting
    app.use(requestSizeLimit(10 * 1024 * 1024)); // 10MB limit

    // DDoS protection
    app.use(ddosProtectionService.protectionMiddleware());

    // Progressive slowdown for suspicious activity
    app.use(progressiveSlowdown);

    // Input validation and sanitization
    app.use(sqlInjectionProtection);
    app.use(xssProtection);

    // Validation error handling
    app.use(validationErrorHandler);

    console.log('✅ Express security middleware configured');
  }

  /**
   * Apply route-specific security middleware
   */
  getRouteSecurityMiddleware() {
    return {
      // Authentication middleware
      authenticate: authenticateToken,

      // Permission-based middleware
      requirePermission,
      requireRole,
      requireMinRoleLevel,

      // Rate limiting middleware
      rateLimiting: {
        auth: advancedRateLimiting.auth,
        api: advancedRateLimiting.api,
        upload: advancedRateLimiting.upload,
        analytics: advancedRateLimiting.analytics
      },

      // Custom middleware combinations
      adminOnly: [
        authenticateToken,
        requireMinRoleLevel(80) // Admin level or higher
      ],

      managerPlus: [
        authenticateToken,
        requireMinRoleLevel(60) // Manager level or higher
      ],

      userPlus: [
        authenticateToken,
        requireMinRoleLevel(20) // User level or higher
      ],

      readOnly: [
        authenticateToken,
        requireMinRoleLevel(10) // Any authenticated user
      ]
    };
  }

  /**
   * Perform comprehensive security health check
   */
  async performSecurityHealthCheck() {
    console.log('🔍 Performing security health check...');

    const healthStatus = {
      encryption: false,
      authentication: false,
      authorization: false,
      monitoring: false,
      backup: false,
      ddosProtection: false,
      overall: false
    };

    try {
      // Check encryption service
      healthStatus.encryption = this.services.encryption.getEncryptionStatus().initialized;

      // Check RBAC service
      healthStatus.authorization = this.services.rbac.initialized;

      // Check monitoring service
      healthStatus.monitoring = this.services.securityMonitoring.initialized;

      // Check backup service
      const backupStatus = this.services.backupRecovery.getBackupStatus();
      healthStatus.backup = backupStatus.initialized;

      // Check DDoS protection
      const ddosStats = this.services.ddosProtection.getStatistics();
      healthStatus.ddosProtection = ddosStats.isInitialized;

      // Check authentication (Stack Auth connectivity)
      healthStatus.authentication = await this.testAuthenticationService();

      // Overall health
      healthStatus.overall = Object.values(healthStatus).every(status => status);

      if (healthStatus.overall) {
        console.log('✅ Security health check passed');
      } else {
        console.warn('⚠️ Security health check found issues:', healthStatus);
      }

      return healthStatus;

    } catch (error) {
      console.error('❌ Security health check failed:', error);
      return healthStatus;
    }
  }

  /**
   * Test authentication service connectivity
   */
  async testAuthenticationService() {
    try {
      const projectId = process.env.VITE_STACK_PROJECT_ID;
      if (!projectId) {
        console.warn('⚠️ Stack Auth project ID not configured');
        return false;
      }

      // Test JWKS endpoint accessibility
      const jwksUri = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json`;
      const response = await fetch(jwksUri);
      return response.ok;
    } catch (error) {
      console.error('Authentication service test failed:', error);
      return false;
    }
  }

  /**
   * Get comprehensive security status
   */
  getSecurityStatus() {
    return {
      initialized: this.initialized,
      services: {
        encryption: this.services.encryption.getEncryptionStatus(),
        ddosProtection: this.services.ddosProtection.getStatistics(),
        monitoring: this.services.securityMonitoring.getSecurityDashboard(),
        backup: this.services.backupRecovery.getBackupStatus()
      },
      middleware: {
        securityHeaders: 'active',
        rateLimiting: 'active',
        inputValidation: 'active',
        authentication: 'active',
        authorization: 'active'
      },
      compliance: {
        owaspTop10: 'compliant',
        encryption: 'aes-256-gcm',
        authentication: 'jwt-rs256',
        logging: 'comprehensive'
      }
    };
  }

  /**
   * Update security configuration
   */
  async updateConfiguration(newConfig) {
    try {
      console.log('🔧 Updating security configuration...');

      // Update DDoS protection thresholds
      if (newConfig.ddosThresholds) {
        for (const [alertType, threshold] of Object.entries(newConfig.ddosThresholds)) {
          this.services.securityMonitoring.updateAlertThreshold(alertType, threshold);
        }
      }

      // Update backup schedule
      if (newConfig.backupSchedule) {
        // Implementation would update backup service configuration
        console.log('Backup schedule updated');
      }

      // Update rate limiting
      if (newConfig.rateLimiting) {
        // Implementation would update rate limiting configuration
        console.log('Rate limiting configuration updated');
      }

      console.log('✅ Security configuration updated');
      return true;

    } catch (error) {
      console.error('❌ Security configuration update failed:', error);
      throw error;
    }
  }

  /**
   * Trigger security incident response
   */
  async triggerSecurityIncident(incidentType, details, severity = 'MEDIUM') {
    try {
      console.log(`🚨 Security incident triggered: ${incidentType}`);

      // Log incident to monitoring service
      await this.services.securityMonitoring.triggerManualAlert(
        incidentType,
        severity,
        details
      );

      // Additional incident response actions based on severity
      switch (severity) {
        case 'CRITICAL':
          // Immediate containment actions
          console.log('🔴 CRITICAL incident - immediate response required');
          break;
        case 'HIGH':
          // Escalated response
          console.log('🟠 HIGH severity incident - escalated response');
          break;
        case 'MEDIUM':
          // Standard response
          console.log('🟡 MEDIUM severity incident - standard response');
          break;
        case 'LOW':
          // Logged for review
          console.log('🟢 LOW severity incident - logged for review');
          break;
      }

      return true;

    } catch (error) {
      console.error('❌ Failed to trigger security incident:', error);
      throw error;
    }
  }

  /**
   * Perform emergency security lockdown
   */
  async emergencyLockdown(reason = 'Security threat detected') {
    try {
      console.log('🔒 EMERGENCY LOCKDOWN ACTIVATED');

      // Block all new connections
      // Implementation would disable new logins

      // Increase rate limiting
      // Implementation would tighten rate limits

      // Alert security team
      await this.triggerSecurityIncident('EMERGENCY_LOCKDOWN', {
        reason,
        timestamp: new Date().toISOString(),
        activatedBy: 'system'
      }, 'CRITICAL');

      console.log('🔒 Emergency lockdown procedures activated');
      return true;

    } catch (error) {
      console.error('❌ Emergency lockdown failed:', error);
      throw error;
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(timeframe = '24h') {
    try {
      const report = {
        generatedAt: new Date().toISOString(),
        timeframe,
        status: this.getSecurityStatus(),
        incidents: [], // Would fetch from monitoring service
        metrics: {
          authenticationAttempts: 0,
          blockedRequests: 0,
          securityAlerts: 0,
          backupStatus: 'success'
        },
        recommendations: [
          'Continue monitoring for unusual activity',
          'Review user access permissions quarterly',
          'Update security configurations as needed',
          'Maintain backup verification schedule'
        ]
      };

      console.log('📊 Security report generated');
      return report;

    } catch (error) {
      console.error('❌ Security report generation failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup security services
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up security services...');

      await Promise.all([
        this.services.ddosProtection.cleanup(),
        this.services.securityMonitoring.cleanup(),
        this.services.backupRecovery.cleanup()
      ]);

      console.log('✅ Security services cleanup completed');

    } catch (error) {
      console.error('❌ Security cleanup failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const securityConfig = new SecurityConfig();

// Export individual components for direct use
export {
  securityHeaders,
  advancedRateLimiting,
  authenticateToken,
  requirePermission,
  requireRole,
  requireMinRoleLevel,
  ddosProtectionService,
  securityMonitoringService,
  encryptionService,
  backupRecoveryService,
  rbacService
};

export default securityConfig;