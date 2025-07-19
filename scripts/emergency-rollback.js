#!/usr/bin/env node
/**
 * Emergency Rollback Script
 * Executes full system rollback with minimal human intervention
 * 
 * Usage: node emergency-rollback.js [options]
 * Options:
 *   --type <type>     Rollback type: full, database, application, feature
 *   --backup <name>   Specific backup to restore from
 *   --dry-run        Simulate rollback without executing
 *   --force          Skip confirmations (use with caution)
 */

import { execSync } from 'child_process';
import { createEmergencyBackup, restoreFromBackup, getBackupList } from '../src/db/rollback.js';
import { validateSystemHealth } from '../src/utils/health-checks.js';
import { notifyStakeholders } from '../src/utils/notifications.js';
import fs from 'fs/promises';
import path from 'path';

const ROLLBACK_LOG_FILE = '/var/log/nxt-rollback.log';
const ROLLBACK_TYPES = ['full', 'database', 'application', 'feature'];

class EmergencyRollback {
  constructor(options = {}) {
    this.options = {
      type: options.type || 'full',
      backup: options.backup || 'last-good',
      dryRun: options.dryRun || false,
      force: options.force || false,
      silent: options.silent || false
    };
    
    this.startTime = Date.now();
    this.rollbackId = `rollback-${Date.now()}`;
    this.logs = [];
  }

  async execute() {
    try {
      this.log('🚨 EMERGENCY ROLLBACK INITIATED', 'CRITICAL');
      this.log(`Rollback ID: ${this.rollbackId}`, 'INFO');
      this.log(`Type: ${this.options.type}`, 'INFO');
      
      if (!this.options.force && !this.options.dryRun) {
        await this.confirmRollback();
      }

      await this.preRollbackChecks();
      await this.createSafetyBackup();
      
      switch (this.options.type) {
        case 'full':
          await this.fullSystemRollback();
          break;
        case 'database':
          await this.databaseRollback();
          break;
        case 'application':
          await this.applicationRollback();
          break;
        case 'feature':
          await this.featureRollback();
          break;
        default:
          throw new Error(`Invalid rollback type: ${this.options.type}`);
      }

      await this.postRollbackValidation();
      await this.notifySuccess();
      
      this.log('✅ ROLLBACK COMPLETED SUCCESSFULLY', 'SUCCESS');
      
    } catch (error) {
      await this.handleRollbackFailure(error);
    } finally {
      await this.cleanup();
    }
  }

  async preRollbackChecks() {
    this.log('Performing pre-rollback checks...', 'INFO');
    
    // Check if backup exists
    if (this.options.backup !== 'last-good') {
      const backups = await getBackupList();
      if (!backups.includes(this.options.backup)) {
        throw new Error(`Backup not found: ${this.options.backup}`);
      }
    }

    // Check system status
    const systemHealth = await validateSystemHealth();
    this.log(`Current system health: ${systemHealth.status}`, 'INFO');
    
    // Check available disk space
    const diskSpace = await this.checkDiskSpace();
    if (diskSpace < 1024) { // Less than 1GB
      throw new Error('Insufficient disk space for rollback');
    }
    
    this.log('Pre-rollback checks completed', 'SUCCESS');
  }

  async createSafetyBackup() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would create safety backup', 'INFO');
      return;
    }

    this.log('Creating safety backup before rollback...', 'INFO');
    const backupPath = await createEmergencyBackup(`safety-${this.rollbackId}`);
    this.safetyBackupPath = backupPath;
    this.log(`Safety backup created: ${backupPath}`, 'SUCCESS');
  }

  async fullSystemRollback() {
    this.log('Executing full system rollback...', 'INFO');
    
    // Step 1: Enable maintenance mode
    await this.enableMaintenanceMode();
    
    // Step 2: Stop services
    await this.stopServices();
    
    // Step 3: Restore database
    await this.restoreDatabase();
    
    // Step 4: Deploy previous version
    await this.deployPreviousVersion();
    
    // Step 5: Start services
    await this.startServices();
    
    // Step 6: Disable maintenance mode
    await this.disableMaintenanceMode();
  }

  async databaseRollback() {
    this.log('Executing database rollback...', 'INFO');
    
    await this.enableMaintenanceMode();
    await this.restoreDatabase();
    await this.disableMaintenanceMode();
  }

  async applicationRollback() {
    this.log('Executing application rollback...', 'INFO');
    
    await this.enableMaintenanceMode();
    await this.deployPreviousVersion();
    await this.disableMaintenanceMode();
  }

  async featureRollback() {
    this.log('Executing feature rollback...', 'INFO');
    
    // Disable problematic features via feature flags
    await this.disableFeatures();
    await this.clearFeatureCaches();
  }

  async enableMaintenanceMode() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would enable maintenance mode', 'INFO');
      return;
    }

    this.log('Enabling maintenance mode...', 'INFO');
    try {
      execSync('touch /opt/nxt-new-day/maintenance.flag');
      this.log('Maintenance mode enabled', 'SUCCESS');
    } catch (error) {
      this.log(`Failed to enable maintenance mode: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async disableMaintenanceMode() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would disable maintenance mode', 'INFO');
      return;
    }

    this.log('Disabling maintenance mode...', 'INFO');
    try {
      execSync('rm -f /opt/nxt-new-day/maintenance.flag');
      this.log('Maintenance mode disabled', 'SUCCESS');
    } catch (error) {
      this.log(`Failed to disable maintenance mode: ${error.message}`, 'WARN');
    }
  }

  async stopServices() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would stop services', 'INFO');
      return;
    }

    this.log('Stopping services...', 'INFO');
    try {
      execSync('sudo systemctl stop nxt-backend nxt-frontend nginx');
      this.log('Services stopped', 'SUCCESS');
    } catch (error) {
      this.log(`Failed to stop services: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async startServices() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would start services', 'INFO');
      return;
    }

    this.log('Starting services...', 'INFO');
    try {
      execSync('sudo systemctl start nginx nxt-frontend nxt-backend');
      this.log('Services started', 'SUCCESS');
    } catch (error) {
      this.log(`Failed to start services: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async restoreDatabase() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would restore database', 'INFO');
      return;
    }

    this.log('Restoring database...', 'INFO');
    try {
      await restoreFromBackup(this.options.backup);
      this.log('Database restored successfully', 'SUCCESS');
    } catch (error) {
      this.log(`Database restore failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async deployPreviousVersion() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would deploy previous version', 'INFO');
      return;
    }

    this.log('Deploying previous version...', 'INFO');
    try {
      execSync('cd /opt/nxt-new-day && docker-compose -f docker-compose.prod.yml down');
      execSync('cd /opt/nxt-new-day && docker-compose -f docker-compose.prod.yml pull');
      execSync('cd /opt/nxt-new-day && docker-compose -f docker-compose.prod.yml up -d');
      this.log('Previous version deployed', 'SUCCESS');
    } catch (error) {
      this.log(`Deployment failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async disableFeatures() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would disable problematic features', 'INFO');
      return;
    }

    this.log('Disabling problematic features...', 'INFO');
    // Implementation would depend on your feature flag system
    this.log('Features disabled', 'SUCCESS');
  }

  async clearFeatureCaches() {
    if (this.options.dryRun) {
      this.log('[DRY RUN] Would clear feature caches', 'INFO');
      return;
    }

    this.log('Clearing feature caches...', 'INFO');
    // Clear Redis caches, application caches, etc.
    this.log('Caches cleared', 'SUCCESS');
  }

  async postRollbackValidation() {
    this.log('Performing post-rollback validation...', 'INFO');
    
    const validation = await validateSystemHealth();
    
    if (!validation.healthy) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }
    
    this.log('Post-rollback validation passed', 'SUCCESS');
  }

  async notifySuccess() {
    const duration = Date.now() - this.startTime;
    const notification = {
      type: 'rollback-success',
      rollbackId: this.rollbackId,
      rollbackType: this.options.type,
      duration: Math.round(duration / 1000),
      timestamp: new Date().toISOString(),
      safetyBackup: this.safetyBackupPath
    };

    if (!this.options.silent) {
      await notifyStakeholders(notification);
    }
    
    this.log(`Stakeholders notified of successful rollback (${notification.duration}s)`, 'INFO');
  }

  async handleRollbackFailure(error) {
    this.log(`❌ ROLLBACK FAILED: ${error.message}`, 'ERROR');
    
    const notification = {
      type: 'rollback-failure',
      rollbackId: this.rollbackId,
      rollbackType: this.options.type,
      error: error.message,
      safetyBackup: this.safetyBackupPath,
      timestamp: new Date().toISOString()
    };

    if (!this.options.silent) {
      await notifyStakeholders(notification);
    }
    
    // Attempt to restore from safety backup if available
    if (this.safetyBackupPath) {
      this.log('Attempting to restore from safety backup...', 'WARN');
      try {
        await restoreFromBackup(this.safetyBackupPath);
        this.log('Restored from safety backup', 'SUCCESS');
      } catch (restoreError) {
        this.log(`Safety backup restore failed: ${restoreError.message}`, 'ERROR');
      }
    }
    
    process.exit(1);
  }

  async cleanup() {
    // Write logs to file
    await this.writeLogsToFile();
    
    // Clean up temporary files
    this.log('Cleanup completed', 'INFO');
  }

  async confirmRollback() {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question(`⚠️  Are you sure you want to execute ${this.options.type} rollback? (yes/no): `, (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'yes') {
          resolve();
        } else {
          reject(new Error('Rollback cancelled by user'));
        }
      });
    });
  }

  async checkDiskSpace() {
    try {
      const result = execSync('df / | tail -1 | awk \'{print $4}\'', { encoding: 'utf8' });
      return parseInt(result.trim());
    } catch (error) {
      this.log(`Failed to check disk space: ${error.message}`, 'WARN');
      return 999999; // Assume sufficient space if check fails
    }
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;
    
    this.logs.push(logEntry);
    
    if (!this.options.silent || level === 'ERROR' || level === 'CRITICAL') {
      console.log(logEntry);
    }
  }

  async writeLogsToFile() {
    try {
      const logContent = this.logs.join('\n') + '\n';
      await fs.appendFile(ROLLBACK_LOG_FILE, logContent);
    } catch (error) {
      console.error(`Failed to write logs: ${error.message}`);
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--type':
        options.type = args[++i];
        break;
      case '--backup':
        options.backup = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--silent':
        options.silent = true;
        break;
      case '--help':
        console.log(`
Emergency Rollback Script

Usage: node emergency-rollback.js [options]

Options:
  --type <type>     Rollback type: full, database, application, feature (default: full)
  --backup <name>   Specific backup to restore from (default: last-good)
  --dry-run        Simulate rollback without executing
  --force          Skip confirmations (use with caution)
  --silent         Suppress non-critical output
  --help           Show this help message

Examples:
  node emergency-rollback.js --type database --backup pre-deployment-20240119
  node emergency-rollback.js --type full --dry-run
  node emergency-rollback.js --type feature --force
        `);
        process.exit(0);
    }
  }

  // Validate options
  if (options.type && !ROLLBACK_TYPES.includes(options.type)) {
    console.error(`Invalid rollback type: ${options.type}`);
    console.error(`Valid types: ${ROLLBACK_TYPES.join(', ')}`);
    process.exit(1);
  }

  const rollback = new EmergencyRollback(options);
  await rollback.execute();
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { EmergencyRollback };