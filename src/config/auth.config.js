/**
 * Authentication Configuration Service
 * 
 * Handles authentication setup, configuration validation, and provides
 * fallback mechanisms for development and testing environments.
 */

import { conditionalAuth, devAuthBypass, apiKeyAuth, noAuth } from '../middleware/auth-bypass.middleware.js';
import { authenticateToken } from '../middleware/rbac.middleware.js';

/**
 * Authentication Configuration Class
 */
class AuthConfig {
  constructor() {
    this.initialized = false;
    this.authMode = 'undefined';
    this.stackAuthConfigured = false;
    this.fallbackEnabled = false;
  }

  /**
   * Initialize authentication system
   */
  async initialize() {
    try {
      console.log('🔐 Initializing authentication system...');
      
      // Detect authentication configuration
      await this.detectAuthConfiguration();
      
      // Setup appropriate authentication mode
      await this.setupAuthenticationMode();
      
      this.initialized = true;
      console.log(`✅ Authentication system initialized in ${this.authMode} mode`);
      
      return true;
    } catch (error) {
      console.error('❌ Authentication initialization failed:', error);
      throw error;
    }
  }

  /**
   * Detect available authentication configurations
   */
  async detectAuthConfiguration() {
    // Check Stack Auth configuration
    const stackProjectId = process.env.VITE_STACK_PROJECT_ID;
    this.stackAuthConfigured = stackProjectId && stackProjectId.trim() !== '';
    
    if (this.stackAuthConfigured) {
      console.log('✅ Stack Auth configuration detected');
      
      // Test Stack Auth connectivity
      try {
        const jwksUri = `https://api.stack-auth.com/api/v1/projects/${stackProjectId}/.well-known/jwks.json`;
        const response = await fetch(jwksUri, { timeout: 5000 });
        
        if (response.ok) {
          console.log('✅ Stack Auth connectivity verified');
          this.authMode = 'stack-auth';
        } else {
          console.warn('⚠️ Stack Auth configured but unreachable');
          this.authMode = 'fallback';
          this.fallbackEnabled = true;
        }
      } catch (error) {
        console.warn('⚠️ Stack Auth connectivity test failed:', error.message);
        this.authMode = 'fallback';
        this.fallbackEnabled = true;
      }
    } else {
      console.warn('⚠️ Stack Auth not configured (VITE_STACK_PROJECT_ID missing)');
      
      if (process.env.NODE_ENV !== 'production') {
        this.authMode = 'development';
        console.log('🔓 Development mode authentication enabled');
      } else {
        this.authMode = 'error';
        console.error('❌ Production environment requires proper authentication configuration');
      }
    }
  }

  /**
   * Setup authentication mode
   */
  async setupAuthenticationMode() {
    switch (this.authMode) {
      case 'stack-auth':
        console.log('🔐 Using Stack Auth JWT authentication');
        break;
        
      case 'development':
        console.log('🔓 Using development authentication bypass');
        break;
        
      case 'fallback':
        console.log('🔄 Using fallback authentication (Stack Auth configured but unreachable)');
        break;
        
      case 'error':
        throw new Error('Authentication system not properly configured for production environment');
        
      default:
        throw new Error(`Unknown authentication mode: ${this.authMode}`);
    }
  }

  /**
   * Get authentication middleware for routes
   */
  getAuthMiddleware(options = {}) {
    const {
      bypassInDev = true,
      requiredRole = null,
      requiredPermission = null,
      allowApiKey = false,
      publicRoute = false
    } = options;

    if (publicRoute) {
      return noAuth;
    }

    if (allowApiKey && process.env.NODE_ENV !== 'production') {
      return apiKeyAuth();
    }

    switch (this.authMode) {
      case 'stack-auth':
        return authenticateToken;
        
      case 'development':
        if (bypassInDev) {
          return devAuthBypass({
            roles: requiredRole ? [requiredRole] : ['admin'],
            permissions: requiredPermission ? [requiredPermission] : null
          });
        }
        return authenticateToken;
        
      case 'fallback':
        return conditionalAuth({
          roles: requiredRole ? [requiredRole] : ['user']
        });
        
      default:
        return (req, res, next) => {
          res.status(500).json({
            success: false,
            error: 'Authentication system not properly initialized',
            code: 'AUTH_SYSTEM_ERROR',
            timestamp: new Date().toISOString()
          });
        };
    }
  }

  /**
   * Get authentication status
   */
  getAuthStatus() {
    return {
      initialized: this.initialized,
      authMode: this.authMode,
      stackAuthConfigured: this.stackAuthConfigured,
      fallbackEnabled: this.fallbackEnabled,
      environment: process.env.NODE_ENV || 'development',
      projectId: process.env.VITE_STACK_PROJECT_ID ? 'configured' : 'not-configured',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create authentication middleware with specific configuration
   */
  createAuthMiddleware(config = {}) {
    const {
      mode = 'auto', // 'auto', 'strict', 'bypass', 'api-key'
      roles = ['user'],
      permissions = [],
      allowPublic = false
    } = config;

    if (allowPublic) {
      return noAuth;
    }

    switch (mode) {
      case 'strict':
        return authenticateToken;
        
      case 'bypass':
        if (process.env.NODE_ENV === 'production') {
          return authenticateToken; // Force real auth in production
        }
        return devAuthBypass({ roles, permissions });
        
      case 'api-key':
        return apiKeyAuth();
        
      case 'auto':
      default:
        return this.getAuthMiddleware({ requiredRole: roles[0], requiredPermission: permissions[0] });
    }
  }

  /**
   * Validate environment configuration
   */
  validateEnvironmentConfig() {
    const issues = [];
    
    if (!process.env.VITE_STACK_PROJECT_ID) {
      issues.push('VITE_STACK_PROJECT_ID environment variable is not set');
    }
    
    if (process.env.NODE_ENV === 'production') {
      if (!this.stackAuthConfigured) {
        issues.push('Production environment requires Stack Auth configuration');
      }
    }
    
    return {
      valid: issues.length === 0,
      issues,
      recommendations: this.generateRecommendations(issues)
    };
  }

  /**
   * Generate configuration recommendations
   */
  generateRecommendations(issues) {
    const recommendations = [];
    
    if (issues.some(issue => issue.includes('VITE_STACK_PROJECT_ID'))) {
      recommendations.push('Set VITE_STACK_PROJECT_ID environment variable with your Stack Auth project ID');
      recommendations.push('Example: VITE_STACK_PROJECT_ID=6f9b7dc6-e7b3-4880-a99e-64a4120ab4f5');
    }
    
    if (issues.some(issue => issue.includes('Production'))) {
      recommendations.push('Configure Stack Auth for production deployment');
      recommendations.push('Ensure JWKS endpoint is accessible from production environment');
    }
    
    if (issues.length === 0) {
      recommendations.push('Authentication configuration looks good!');
    }
    
    return recommendations;
  }

  /**
   * Test authentication configuration
   */
  async testAuthConfiguration() {
    const results = {
      stackAuthConnectivity: false,
      jwksEndpoint: false,
      environmentVariables: false,
      overallStatus: false
    };
    
    try {
      // Test environment variables
      results.environmentVariables = !!process.env.VITE_STACK_PROJECT_ID;
      
      if (results.environmentVariables) {
        // Test Stack Auth connectivity
        const projectId = process.env.VITE_STACK_PROJECT_ID;
        const jwksUri = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json`;
        
        try {
          const response = await fetch(jwksUri, { timeout: 10000 });
          results.stackAuthConnectivity = response.ok;
          results.jwksEndpoint = response.ok;
        } catch (error) {
          console.warn('Stack Auth connectivity test failed:', error.message);
        }
      }
      
      results.overallStatus = results.environmentVariables && (results.stackAuthConnectivity || process.env.NODE_ENV !== 'production');
      
    } catch (error) {
      console.error('Authentication configuration test failed:', error);
    }
    
    return results;
  }

  /**
   * Get troubleshooting guide
   */
  getTroubleshootingGuide() {
    return {
      common_issues: [
        {
          issue: 'VITE_STACK_PROJECT_ID not configured',
          solution: 'Add VITE_STACK_PROJECT_ID=your-project-id to your .env file',
          commands: ['echo "VITE_STACK_PROJECT_ID=your-project-id" >> .env']
        },
        {
          issue: 'Stack Auth JWKS endpoint unreachable',
          solution: 'Check network connectivity and firewall settings',
          commands: ['curl -f https://api.stack-auth.com/api/v1/projects/PROJECT_ID/.well-known/jwks.json']
        },
        {
          issue: 'JWT token validation failing',
          solution: 'Verify token format and Stack Auth project configuration',
          commands: ['Check token in https://jwt.io/']
        },
        {
          issue: 'Authentication hangs or times out',
          solution: 'Use development bypass or API key authentication for testing',
          commands: ['Set NODE_ENV=development for bypass mode']
        }
      ],
      testing_options: [
        {
          method: 'Development Bypass',
          description: 'Use built-in development authentication bypass',
          setup: 'Set NODE_ENV=development'
        },
        {
          method: 'API Key Authentication', 
          description: 'Use X-API-Key header for authentication',
          setup: 'Add X-API-Key: dev-admin-key-12345 to request headers'
        },
        {
          method: 'Public Routes',
          description: 'Configure routes as public for testing',
          setup: 'Use { publicRoute: true } in route configuration'
        }
      ]
    };
  }
}

// Export singleton instance
export const authConfig = new AuthConfig();

// Export individual functions for convenience
export {
  conditionalAuth,
  devAuthBypass,
  apiKeyAuth,
  noAuth
};

export default authConfig;