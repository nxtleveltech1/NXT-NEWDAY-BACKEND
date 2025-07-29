import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { db } from '../config/database.js';
import { timeSeriesMetrics, users, userRoles, roles, rolePermissions, permissions } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Role-Based Access Control (RBAC) System
 */

// Define system roles and their hierarchies
export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: 'super_admin',
    level: 100,
    description: 'Full system access'
  },
  ADMIN: {
    name: 'admin',
    level: 80,
    description: 'Administrative access'
  },
  MANAGER: {
    name: 'manager',
    level: 60,
    description: 'Management level access'
  },
  SUPERVISOR: {
    name: 'supervisor',
    level: 40,
    description: 'Supervisory access'
  },
  USER: {
    name: 'user',
    level: 20,
    description: 'Standard user access'
  },
  VIEWER: {
    name: 'viewer',
    level: 10,
    description: 'Read-only access'
  }
};

// Define system permissions
export const SYSTEM_PERMISSIONS = {
  // User Management
  'users.create': 'Create new users',
  'users.read': 'View user information',
  'users.update': 'Update user information',
  'users.delete': 'Delete users',
  'users.manage_roles': 'Assign roles to users',

  // Supplier Management
  'suppliers.create': 'Create new suppliers',
  'suppliers.read': 'View supplier information',
  'suppliers.update': 'Update supplier information',
  'suppliers.delete': 'Delete suppliers',
  'suppliers.manage_contracts': 'Manage supplier contracts',

  // Inventory Management
  'inventory.create': 'Create inventory items',
  'inventory.read': 'View inventory information',
  'inventory.update': 'Update inventory levels',
  'inventory.delete': 'Delete inventory items',
  'inventory.adjust': 'Adjust stock levels',
  'inventory.reserve': 'Reserve inventory',
  'inventory.movements': 'View inventory movements',

  // Price List Management
  'pricelists.create': 'Create price lists',
  'pricelists.read': 'View price lists',
  'pricelists.update': 'Update price lists',
  'pricelists.delete': 'Delete price lists',
  'pricelists.approve': 'Approve price lists',
  'pricelists.activate': 'Activate price lists',

  // Customer Management
  'customers.create': 'Create customers',
  'customers.read': 'View customer information',
  'customers.update': 'Update customer information',
  'customers.delete': 'Delete customers',
  'customers.sales': 'Process customer sales',

  // Analytics and Reporting
  'analytics.read': 'View analytics reports',
  'analytics.advanced': 'Access advanced analytics',
  'analytics.export': 'Export analytics data',

  // System Administration
  'system.settings': 'Manage system settings',
  'system.security': 'Manage security settings',
  'system.backup': 'Perform system backups',
  'system.maintenance': 'System maintenance access',

  // File Management
  'files.upload': 'Upload files',
  'files.download': 'Download files',
  'files.delete': 'Delete files',

  // API Access
  'api.read': 'Read API access',
  'api.write': 'Write API access',
  'api.admin': 'Administrative API access'
};

// Default role permissions mapping
export const DEFAULT_ROLE_PERMISSIONS = {
  [SYSTEM_ROLES.SUPER_ADMIN.name]: Object.keys(SYSTEM_PERMISSIONS),
  [SYSTEM_ROLES.ADMIN.name]: [
    'users.create', 'users.read', 'users.update', 'users.manage_roles',
    'suppliers.create', 'suppliers.read', 'suppliers.update', 'suppliers.manage_contracts',
    'inventory.create', 'inventory.read', 'inventory.update', 'inventory.adjust', 'inventory.reserve', 'inventory.movements',
    'pricelists.create', 'pricelists.read', 'pricelists.update', 'pricelists.approve', 'pricelists.activate',
    'customers.create', 'customers.read', 'customers.update', 'customers.sales',
    'analytics.read', 'analytics.advanced', 'analytics.export',
    'files.upload', 'files.download', 'files.delete',
    'api.read', 'api.write'
  ],
  [SYSTEM_ROLES.MANAGER.name]: [
    'users.read',
    'suppliers.read', 'suppliers.update',
    'inventory.read', 'inventory.update', 'inventory.adjust', 'inventory.reserve', 'inventory.movements',
    'pricelists.read', 'pricelists.update', 'pricelists.approve',
    'customers.read', 'customers.update', 'customers.sales',
    'analytics.read', 'analytics.advanced',
    'files.upload', 'files.download',
    'api.read', 'api.write'
  ],
  [SYSTEM_ROLES.SUPERVISOR.name]: [
    'suppliers.read',
    'inventory.read', 'inventory.update', 'inventory.movements',
    'pricelists.read',
    'customers.read', 'customers.sales',
    'analytics.read',
    'files.upload', 'files.download',
    'api.read', 'api.write'
  ],
  [SYSTEM_ROLES.USER.name]: [
    'suppliers.read',
    'inventory.read', 'inventory.movements',
    'pricelists.read',
    'customers.read',
    'analytics.read',
    'files.upload', 'files.download',
    'api.read'
  ],
  [SYSTEM_ROLES.VIEWER.name]: [
    'suppliers.read',
    'inventory.read',
    'pricelists.read',
    'customers.read',
    'analytics.read',
    'api.read'
  ]
};

/**
 * RBAC Service Class
 */
class RBACService {
  constructor() {
    this.initialized = false;
    this.permissionCache = new Map();
    this.roleCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    try {
      await this.ensureSystemRolesExist();
      await this.ensureSystemPermissionsExist();
      await this.assignDefaultPermissions();
      this.initialized = true;
      console.log('✅ RBAC Service initialized');
    } catch (error) {
      console.error('❌ RBAC initialization failed:', error);
      throw error;
    }
  }

  /**
   * Ensure system roles exist in database
   */
  async ensureSystemRolesExist() {
    for (const [key, roleData] of Object.entries(SYSTEM_ROLES)) {
      try {
        await db.insert(roles).values({
          name: roleData.name,
          description: roleData.description,
          level: roleData.level,
          isSystemRole: true
        }).onConflictDoNothing();
      } catch (error) {
        // Role might already exist, continue
      }
    }
  }

  /**
   * Ensure system permissions exist in database
   */
  async ensureSystemPermissionsExist() {
    for (const [permission, description] of Object.entries(SYSTEM_PERMISSIONS)) {
      try {
        await db.insert(permissions).values({
          name: permission,
          description,
          category: permission.split('.')[0] // e.g., 'users' from 'users.create'
        }).onConflictDoNothing();
      } catch (error) {
        // Permission might already exist, continue
      }
    }
  }

  /**
   * Assign default permissions to roles
   */
  async assignDefaultPermissions() {
    for (const [roleName, permissionNames] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      try {
        // Get role
        const role = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
        if (role.length === 0) continue;

        // Get permissions
        const rolePermissions = await db.select()
          .from(permissions)
          .where(inArray(permissions.name, permissionNames));

        // Assign permissions to role
        for (const permission of rolePermissions) {
          try {
            await db.insert(rolePermissions).values({
              roleId: role[0].id,
              permissionId: permission.id
            }).onConflictDoNothing();
          } catch (error) {
            // Permission might already be assigned
          }
        }
      } catch (error) {
        console.error(`Error assigning permissions to role ${roleName}:`, error);
      }
    }
  }

  /**
   * Get user permissions (with caching)
   */
  async getUserPermissions(userId) {
    const cacheKey = `user_permissions:${userId}`;
    const cached = this.permissionCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.permissions;
    }

    try {
      // Get user roles and their permissions
      const userPermissions = await db
        .select({
          permission: permissions.name,
          role: roles.name,
          roleLevel: roles.level
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(userRoles.userId, userId));

      const permissionSet = new Set(userPermissions.map(p => p.permission));
      const maxRoleLevel = Math.max(...userPermissions.map(p => p.roleLevel), 0);

      const result = {
        permissions: Array.from(permissionSet),
        roles: [...new Set(userPermissions.map(p => p.role))],
        maxRoleLevel
      };

      // Cache the result
      this.permissionCache.set(cacheKey, {
        permissions: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      return { permissions: [], roles: [], maxRoleLevel: 0 };
    }
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(userId, requiredPermission) {
    const userPerms = await this.getUserPermissions(userId);
    return userPerms.permissions.includes(requiredPermission);
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(userId, requiredPermissions) {
    const userPerms = await this.getUserPermissions(userId);
    return requiredPermissions.some(perm => userPerms.permissions.includes(perm));
  }

  /**
   * Check if user has minimum role level
   */
  async hasMinRoleLevel(userId, minLevel) {
    const userPerms = await this.getUserPermissions(userId);
    return userPerms.maxRoleLevel >= minLevel;
  }

  /**
   * Assign role to user
   */
  async assignRole(userId, roleName) {
    try {
      const role = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
      if (role.length === 0) {
        throw new Error(`Role ${roleName} not found`);
      }

      await db.insert(userRoles).values({
        userId,
        roleId: role[0].id,
        assignedAt: new Date()
      }).onConflictDoNothing();

      // Clear cache
      this.permissionCache.delete(`user_permissions:${userId}`);

      await this.logSecurityEvent('ROLE_ASSIGNED', {
        userId,
        roleName,
        roleId: role[0].id
      });

      return true;
    } catch (error) {
      console.error('Error assigning role:', error);
      throw error;
    }
  }

  /**
   * Remove role from user
   */
  async removeRole(userId, roleName) {
    try {
      const role = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
      if (role.length === 0) {
        throw new Error(`Role ${roleName} not found`);
      }

      await db.delete(userRoles)
        .where(and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, role[0].id)
        ));

      // Clear cache
      this.permissionCache.delete(`user_permissions:${userId}`);

      await this.logSecurityEvent('ROLE_REMOVED', {
        userId,
        roleName,
        roleId: role[0].id
      });

      return true;
    } catch (error) {
      console.error('Error removing role:', error);
      throw error;
    }
  }

  /**
   * Clear permission cache for user
   */
  clearUserCache(userId) {
    this.permissionCache.delete(`user_permissions:${userId}`);
  }

  /**
   * Log security events
   */
  async logSecurityEvent(eventType, details) {
    try {
      await db.insert(timeSeriesMetrics).values({
        timestamp: new Date(),
        metricName: 'rbac_event',
        metricType: 'counter',
        dimension1: eventType,
        dimension2: details.userId || 'unknown',
        dimension3: details.roleName || 'unknown',
        value: 1,
        tags: {
          ...details,
          service: 'rbac'
        }
      });
    } catch (error) {
      console.error('Failed to log RBAC event:', error);
    }
  }
}

// Create singleton instance
export const rbacService = new RBACService();

/**
 * JWT Key retrieval function for Stack Auth
 */
export const getKey = (function() {
  // Check if Stack Auth is properly configured
  const projectId = process.env.VITE_STACK_PROJECT_ID;
  if (!projectId || projectId.trim() === '') {
    console.error('❌ VITE_STACK_PROJECT_ID not configured');
    return null;
  }

  // Stack Auth JWKS setup
  const jwksUri = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json`;
  const client = jwksClient({
    jwksUri,
    requestHeaders: {}, // Optional headers
    timeout: 30000, // 30 second timeout
    cache: true, // Cache the keys
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000 // 10 minutes
  });

  return function getKey(header, callback) {
    if (!header.kid) {
      return callback(new Error('Token header missing key ID'));
    }
    
    client.getSigningKey(header.kid, function (err, key) {
      if (err) {
        console.error('❌ Failed to get signing key:', err);
        return callback(err);
      }
      const signingKey = key && key.getPublicKey();
      callback(null, signingKey);
    });
  };
})();

/**
 * Authentication middleware with enhanced JWT verification and fallback handling
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'NO_TOKEN',
      timestamp: new Date().toISOString()
    });
  }

  if (!getKey) {
    return res.status(500).json({
      success: false,
      error: 'Authentication service not properly configured',
      code: 'AUTH_CONFIG_ERROR',
      details: 'Stack Auth Project ID not found in environment variables',
      timestamp: new Date().toISOString()
    });
  }

  jwt.verify(token, getKey, { algorithms: ['RS256'] }, async (err, decoded) => {
    if (err) {
      console.error('❌ JWT verification failed:', err.message);
      return res.status(403).json({
        success: false,
        error: 'Invalid token',
        code: 'TOKEN_INVALID',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Token verification failed',
        timestamp: new Date().toISOString()
      });
    }

    req.user = decoded;
    
    // Add user permissions to request for easy access
    try {
      req.userPermissions = await rbacService.getUserPermissions(decoded.sub);
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      req.userPermissions = { permissions: [], roles: [], maxRoleLevel: 0 };
    }

    console.log(`✅ User authenticated: ${decoded.sub}`);
    next();
  });
};

/**
 * Permission-based authorization middleware
 */
export const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const hasPermission = await rbacService.hasPermission(req.user.sub, requiredPermission);
    
    if (!hasPermission) {
      await rbacService.logSecurityEvent('PERMISSION_DENIED', {
        userId: req.user.sub,
        requiredPermission,
        endpoint: req.path,
        method: req.method
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'PERMISSION_DENIED',
        requiredPermission,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Role-level authorization middleware
 */
export const requireRole = (requiredRole) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const userPerms = await rbacService.getUserPermissions(req.user.sub);
    const hasRole = userPerms.roles.includes(requiredRole);
    
    if (!hasRole) {
      await rbacService.logSecurityEvent('ROLE_ACCESS_DENIED', {
        userId: req.user.sub,
        requiredRole,
        userRoles: userPerms.roles,
        endpoint: req.path,
        method: req.method
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient role level',
        code: 'ROLE_DENIED',
        requiredRole,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Minimum role level authorization middleware
 */
export const requireMinRoleLevel = (minLevel) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const hasLevel = await rbacService.hasMinRoleLevel(req.user.sub, minLevel);
    
    if (!hasLevel) {
      await rbacService.logSecurityEvent('ROLE_LEVEL_DENIED', {
        userId: req.user.sub,
        requiredLevel: minLevel,
        userLevel: req.userPermissions?.maxRoleLevel || 0,
        endpoint: req.path,
        method: req.method
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient role level',
        code: 'ROLE_LEVEL_DENIED',
        requiredLevel: minLevel,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Multiple permissions check (OR logic)
 */
export const requireAnyPermission = (requiredPermissions) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
        timestamp: new Date().toISOString()
      });
    }

    const hasAnyPermission = await rbacService.hasAnyPermission(req.user.sub, requiredPermissions);
    
    if (!hasAnyPermission) {
      await rbacService.logSecurityEvent('MULTIPLE_PERMISSION_DENIED', {
        userId: req.user.sub,
        requiredPermissions,
        endpoint: req.path,
        method: req.method
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'PERMISSION_DENIED',
        requiredPermissions,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

export default {
  rbacService,
  authenticateToken,
  requirePermission,
  requireRole,
  requireMinRoleLevel,
  requireAnyPermission,
  getKey,
  SYSTEM_ROLES,
  SYSTEM_PERMISSIONS
};