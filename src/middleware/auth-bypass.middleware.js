/**
 * Authentication Bypass Middleware for Testing
 * 
 * This middleware provides authentication bypass capabilities for development and testing environments
 * when Stack Auth is not properly configured or when testing requires bypassing authentication.
 * 
 * SECURITY WARNING: This should NEVER be used in production environments!
 */

import { rbacService, SYSTEM_PERMISSIONS } from './rbac.middleware.js';

/**
 * Development Authentication Bypass
 * Creates a mock user with configurable roles and permissions
 */
export const devAuthBypass = (options = {}) => {
  return async (req, res, next) => {
    // Only allow in development environment
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'Authentication bypass not allowed in production',
        code: 'BYPASS_FORBIDDEN',
        timestamp: new Date().toISOString()
      });
    }

    const {
      userId = 'dev-user-123',
      email = 'dev@example.com',
      roles = ['admin'],
      permissions = null // Auto-calculate from roles if null
    } = options;

    // Create mock user object
    req.user = {
      sub: userId,
      email: email,
      name: 'Development User',
      roles: roles,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
      iss: 'dev-bypass',
      aud: 'nxt-backend'
    };

    // Load user permissions from RBAC service
    try {
      req.userPermissions = await rbacService.getUserPermissions(userId);
      
      // If user doesn't exist in database, create default permissions based on roles
      if (req.userPermissions.permissions.length === 0 && permissions) {
        req.userPermissions = {
          permissions: permissions,
          roles: roles,
          maxRoleLevel: Math.max(...roles.map(role => getRoleLevel(role)), 0)
        };
      }
    } catch (error) {
      console.warn('Could not load user permissions, using defaults:', error.message);
      req.userPermissions = {
        permissions: permissions || ['api.read', 'api.write'],
        roles: roles,
        maxRoleLevel: getRoleLevel(roles[0])
      };
    }

    console.log(`🔓 DEV AUTH BYPASS: User ${userId} authenticated with roles: ${roles.join(', ')}`);
    next();
  };
};

/**
 * Testing Authentication Bypass
 * Provides specific user contexts for automated testing
 */
export const testAuthBypass = (userType = 'user') => {
  const testUsers = {
    admin: {
      userId: 'test-admin-123',
      email: 'admin@test.com',
      roles: ['super_admin'],
      permissions: Object.keys(SYSTEM_PERMISSIONS || {})
    },
    manager: {
      userId: 'test-manager-123', 
      email: 'manager@test.com',
      roles: ['manager'],
      permissions: ['users.read', 'inventory.read', 'inventory.update', 'analytics.read']
    },
    user: {
      userId: 'test-user-123',
      email: 'user@test.com', 
      roles: ['user'],
      permissions: ['inventory.read', 'analytics.read', 'api.read']
    },
    viewer: {
      userId: 'test-viewer-123',
      email: 'viewer@test.com',
      roles: ['viewer'],
      permissions: ['inventory.read', 'api.read']
    }
  };

  const userData = testUsers[userType] || testUsers.user;
  return devAuthBypass(userData);
};

/**
 * Conditional Authentication Middleware
 * Uses real authentication if properly configured, falls back to bypass in development
 */
export const conditionalAuth = (bypassOptions = {}) => {
  return async (req, res, next) => {
    const hasStackAuth = process.env.VITE_STACK_PROJECT_ID && process.env.VITE_STACK_PROJECT_ID.trim() !== '';
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    if (hasStackAuth) {
      // Use real Stack Auth authentication
      const { authenticateToken } = await import('./rbac.middleware.js');
      return authenticateToken(req, res, next);
    } else if (isDevelopment) {
      // Use development bypass
      console.warn('⚠️ Stack Auth not configured, using development bypass');
      return devAuthBypass(bypassOptions)(req, res, next);
    } else {
      // Production without proper auth config - fail
      return res.status(500).json({
        success: false,
        error: 'Authentication service not properly configured',
        code: 'AUTH_CONFIG_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  };
};

/**
 * API Key Authentication (Alternative for testing)
 * Allows authentication via X-API-Key header
 */
export const apiKeyAuth = (validKeys = {}) => {
  const defaultKeys = {
    'dev-admin-key-12345': {
      userId: 'api-admin-123',
      roles: ['admin'],
      permissions: ['api.read', 'api.write', 'api.admin']
    },
    'dev-user-key-12345': {
      userId: 'api-user-123', 
      roles: ['user'],
      permissions: ['api.read']
    }
  };

  const apiKeys = Object.keys(validKeys).length > 0 ? validKeys : defaultKeys;

  return async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        code: 'API_KEY_MISSING',
        timestamp: new Date().toISOString()
      });
    }

    const keyData = apiKeys[apiKey];
    if (!keyData) {
      return res.status(403).json({
        success: false,
        error: 'Invalid API key',
        code: 'API_KEY_INVALID',
        timestamp: new Date().toISOString()
      });
    }

    // Create user context from API key
    req.user = {
      sub: keyData.userId,
      email: `${keyData.userId}@api.local`,
      name: 'API User',
      roles: keyData.roles,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'api-key-auth',
      aud: 'nxt-backend'
    };

    req.userPermissions = {
      permissions: keyData.permissions,
      roles: keyData.roles,
      maxRoleLevel: Math.max(...keyData.roles.map(role => getRoleLevel(role)), 0)
    };

    console.log(`🔑 API KEY AUTH: User ${keyData.userId} authenticated`);
    next();
  };
};

/**
 * No Authentication (Public endpoints)
 * Completely bypasses authentication for public routes
 */
export const noAuth = (req, res, next) => {
  console.log(`🌐 PUBLIC ACCESS: ${req.method} ${req.path}`);
  next();
};

/**
 * Get role level for permission calculations
 */
function getRoleLevel(roleName) {
  const roleLevels = {
    'super_admin': 100,
    'admin': 80,
    'manager': 60,
    'supervisor': 40,
    'user': 20,
    'viewer': 10
  };
  return roleLevels[roleName] || 0;
}

/**
 * Authentication Status Checker
 * Middleware to check and report authentication configuration status
 */
export const authStatusChecker = (req, res, next) => {
  const hasStackAuth = process.env.VITE_STACK_PROJECT_ID && process.env.VITE_STACK_PROJECT_ID.trim() !== '';
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  req.authStatus = {
    hasStackAuth,
    isDevelopment,
    authMode: hasStackAuth ? 'stack-auth' : (isDevelopment ? 'bypass' : 'error'),
    projectId: process.env.VITE_STACK_PROJECT_ID || 'not-configured'
  };
  
  next();
};

export default {
  devAuthBypass,
  testAuthBypass,
  conditionalAuth,
  apiKeyAuth,
  noAuth,
  authStatusChecker
};