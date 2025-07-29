import { db } from '../config/database.js';
import { roles, permissions, rolePermissions, userRoles } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

class RBACService {
  constructor() {
    console.log('RBAC Service initialized');
  }

  /**
   * Get all permissions for a user
   * @param {string} userId 
   * @returns {Promise<string[]>} Array of permission keys
   */
  async getUserPermissions(userId) {
    try {
      const result = await db
        .select({ permission: permissions.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(userRoles.userId, userId));

      return result.map(r => r.permission);
    } catch (error) {
      console.error('Error getting user permissions:', error);
      return [];
    }
  }

  /**
   * Check if user has a specific permission
   * @param {string} userId 
   * @param {string} permissionKey 
   * @returns {Promise<boolean>}
   */
  async hasPermission(userId, permissionKey) {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permissionKey);
  }

  /**
   * Get all roles for a user
   * @param {string} userId 
   * @returns {Promise<string[]>} Array of role names
   */
  async getUserRoles(userId) {
    try {
      const result = await db
        .select({ role: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId));

      return result.map(r => r.role);
    } catch (error) {
      console.error('Error getting user roles:', error);
      return [];
    }
  }
}

export default new RBACService();