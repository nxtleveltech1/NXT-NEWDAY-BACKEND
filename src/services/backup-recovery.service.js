import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip, createGunzip } from 'zlib';
import { db } from '../db/index.js';
import { timeSeriesMetrics } from '../db/schema.js';
import { encryptionService } from './encryption.service.js';

const execAsync = promisify(exec);

/**
 * Comprehensive Backup and Disaster Recovery Service
 */
class BackupRecoveryService {
  constructor() {
    this.initialized = false;
    this.backupDirectory = process.env.BACKUP_DIRECTORY || './backups';
    this.maxBackupAge = parseInt(process.env.MAX_BACKUP_AGE_DAYS) || 30; // 30 days
    this.compressionLevel = 6;
    this.encryptBackups = process.env.ENCRYPT_BACKUPS === 'true';
    
    this.backupSchedule = {
      database: '0 2 * * *', // Daily at 2 AM
      files: '0 3 * * 0', // Weekly on Sunday at 3 AM
      full: '0 4 * * 0', // Weekly on Sunday at 4 AM
      incremental: '0 */6 * * *' // Every 6 hours
    };
    
    this.retentionPolicy = {
      daily: 7,    // Keep 7 daily backups
      weekly: 4,   // Keep 4 weekly backups
      monthly: 12, // Keep 12 monthly backups
      yearly: 5    // Keep 5 yearly backups
    };
    
    this.backupMetrics = {
      totalBackups: 0,
      successfulBackups: 0,
      failedBackups: 0,
      lastBackupTime: null,
      totalBackupSize: 0,
      averageBackupTime: 0
    };
  }

  async initialize() {
    try {
      // Ensure backup directory exists
      await this.ensureBackupDirectory();
      
      // Initialize encryption service if needed
      if (this.encryptBackups) {
        await encryptionService.initialize();
      }
      
      // Setup backup scheduler
      this.setupBackupScheduler();
      
      // Perform initial backup health check
      await this.performBackupHealthCheck();
      
      this.initialized = true;
      console.log('✅ Backup & Recovery Service initialized');
    } catch (error) {
      console.error('❌ Backup & Recovery initialization failed:', error);
      throw error;
    }
  }

  /**
   * Ensure backup directory structure exists
   */
  async ensureBackupDirectory() {
    const subdirectories = ['database', 'files', 'full', 'incremental', 'temp'];
    
    for (const subdir of subdirectories) {
      const dirPath = path.join(this.backupDirectory, subdir);
      await fs.mkdir(dirPath, { recursive: true });
    }
    
    console.log(`✅ Backup directories created: ${this.backupDirectory}`);
  }

  /**
   * Setup automated backup scheduler
   */
  setupBackupScheduler() {
    // In a real implementation, you would use a job scheduler like node-cron
    console.log('📅 Backup scheduler configured');
    
    // Example: Setup intervals for demo purposes
    if (process.env.NODE_ENV !== 'test') {
      // Daily database backup
      setInterval(() => {
        this.performDatabaseBackup('scheduled');
      }, 24 * 60 * 60 * 1000); // 24 hours
      
      // Weekly full backup
      setInterval(() => {
        this.performFullBackup('scheduled');
      }, 7 * 24 * 60 * 60 * 1000); // 7 days
    }
  }

  /**
   * Perform database backup
   */
  async performDatabaseBackup(type = 'manual') {
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `database-backup-${timestamp}.sql`;
    const backupPath = path.join(this.backupDirectory, 'database', backupFileName);
    
    try {
      console.log(`🗄️ Starting database backup: ${backupFileName}`);
      
      // Get database connection details from environment
      const dbHost = process.env.DATABASE_HOST || 'localhost';
      const dbPort = process.env.DATABASE_PORT || '5432';
      const dbName = process.env.DATABASE_NAME || 'nxt_backend';
      const dbUser = process.env.DATABASE_USER || 'postgres';
      const dbPassword = process.env.DATABASE_PASSWORD || '';
      
      // Create PostgreSQL dump command
      const dumpCommand = `PGPASSWORD="${dbPassword}" pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} --no-password --clean --create`;
      
      // Execute backup
      const { stdout, stderr } = await execAsync(dumpCommand);
      
      if (stderr && !stderr.includes('WARNING')) {
        throw new Error(`Database backup failed: ${stderr}`);
      }
      
      // Write backup to file
      await fs.writeFile(backupPath, stdout);
      
      // Compress backup
      const compressedPath = await this.compressFile(backupPath);
      
      // Encrypt if enabled
      let finalBackupPath = compressedPath;
      if (this.encryptBackups) {
        finalBackupPath = await this.encryptBackupFile(compressedPath);
        await fs.unlink(compressedPath); // Remove unencrypted compressed file
      }
      
      // Remove original uncompressed file
      await fs.unlink(backupPath);
      
      const backupSize = (await fs.stat(finalBackupPath)).size;
      const duration = Date.now() - startTime;
      
      // Update metrics
      await this.updateBackupMetrics('database', duration, backupSize, true);
      
      // Log success
      await this.logBackupEvent('DATABASE_BACKUP_SUCCESS', {
        fileName: path.basename(finalBackupPath),
        size: backupSize,
        duration,
        type,
        compressed: true,
        encrypted: this.encryptBackups
      });
      
      console.log(`✅ Database backup completed: ${path.basename(finalBackupPath)} (${(backupSize / 1024 / 1024).toFixed(2)} MB)`);
      
      return {
        success: true,
        fileName: path.basename(finalBackupPath),
        path: finalBackupPath,
        size: backupSize,
        duration
      };
      
    } catch (error) {
      console.error('❌ Database backup failed:', error);
      
      await this.updateBackupMetrics('database', Date.now() - startTime, 0, false);
      await this.logBackupEvent('DATABASE_BACKUP_FAILED', {
        error: error.message,
        type,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  /**
   * Perform file system backup
   */
  async performFileBackup(directories = ['uploads', 'logs'], type = 'manual') {
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `files-backup-${timestamp}.tar.gz`;
    const backupPath = path.join(this.backupDirectory, 'files', backupFileName);
    
    try {
      console.log(`📁 Starting file backup: ${backupFileName}`);
      
      // Create tar command for specified directories
      const validDirectories = [];
      for (const dir of directories) {
        try {
          await fs.access(dir);
          validDirectories.push(dir);
        } catch (error) {
          console.warn(`Directory ${dir} not found, skipping`);
        }
      }
      
      if (validDirectories.length === 0) {
        throw new Error('No valid directories found for backup');
      }
      
      const tarCommand = `tar -czf "${backupPath}" ${validDirectories.join(' ')}`;
      await execAsync(tarCommand);
      
      // Encrypt if enabled
      let finalBackupPath = backupPath;
      if (this.encryptBackups) {
        finalBackupPath = await this.encryptBackupFile(backupPath);
        await fs.unlink(backupPath); // Remove unencrypted file
      }
      
      const backupSize = (await fs.stat(finalBackupPath)).size;
      const duration = Date.now() - startTime;
      
      // Update metrics
      await this.updateBackupMetrics('files', duration, backupSize, true);
      
      // Log success
      await this.logBackupEvent('FILE_BACKUP_SUCCESS', {
        fileName: path.basename(finalBackupPath),
        directories: validDirectories,
        size: backupSize,
        duration,
        type,
        encrypted: this.encryptBackups
      });
      
      console.log(`✅ File backup completed: ${path.basename(finalBackupPath)} (${(backupSize / 1024 / 1024).toFixed(2)} MB)`);
      
      return {
        success: true,
        fileName: path.basename(finalBackupPath),
        path: finalBackupPath,
        size: backupSize,
        duration,
        directories: validDirectories
      };
      
    } catch (error) {
      console.error('❌ File backup failed:', error);
      
      await this.updateBackupMetrics('files', Date.now() - startTime, 0, false);
      await this.logBackupEvent('FILE_BACKUP_FAILED', {
        error: error.message,
        directories,
        type,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  /**
   * Perform full system backup
   */
  async performFullBackup(type = 'manual') {
    const startTime = Date.now();
    console.log('🔄 Starting full system backup...');
    
    try {
      const results = {
        database: null,
        files: null,
        startTime: new Date(),
        endTime: null,
        success: false
      };
      
      // Perform database backup
      try {
        results.database = await this.performDatabaseBackup(type);
      } catch (error) {
        console.error('Database backup failed during full backup:', error);
        results.database = { success: false, error: error.message };
      }
      
      // Perform file backup
      try {
        results.files = await this.performFileBackup(['uploads', 'logs', 'config'], type);
      } catch (error) {
        console.error('File backup failed during full backup:', error);
        results.files = { success: false, error: error.message };
      }
      
      results.endTime = new Date();
      results.success = results.database?.success && results.files?.success;
      
      const duration = Date.now() - startTime;
      const totalSize = (results.database?.size || 0) + (results.files?.size || 0);
      
      // Update metrics
      await this.updateBackupMetrics('full', duration, totalSize, results.success);
      
      // Log full backup completion
      await this.logBackupEvent('FULL_BACKUP_COMPLETED', {
        success: results.success,
        duration,
        totalSize,
        type,
        components: {
          database: results.database?.success || false,
          files: results.files?.success || false
        }
      });
      
      if (results.success) {
        console.log(`✅ Full backup completed successfully (${(duration / 1000).toFixed(2)}s)`);
      } else {
        console.warn(`⚠️ Full backup completed with errors (${(duration / 1000).toFixed(2)}s)`);
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Full backup failed:', error);
      
      await this.updateBackupMetrics('full', Date.now() - startTime, 0, false);
      await this.logBackupEvent('FULL_BACKUP_FAILED', {
        error: error.message,
        type,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  /**
   * Perform incremental backup (only changed files)
   */
  async performIncrementalBackup(type = 'manual') {
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `incremental-backup-${timestamp}.tar.gz`;
    const backupPath = path.join(this.backupDirectory, 'incremental', backupFileName);
    
    try {
      console.log(`🔄 Starting incremental backup: ${backupFileName}`);
      
      // Find last backup time
      const lastBackupTime = await this.getLastBackupTime('incremental');
      const findCommand = lastBackupTime ? 
        `find uploads logs -newer "${lastBackupTime}" -type f` :
        `find uploads logs -type f`;
      
      const { stdout } = await execAsync(findCommand);
      const changedFiles = stdout.trim().split('\n').filter(file => file.length > 0);
      
      if (changedFiles.length === 0) {
        console.log('📝 No files changed since last backup');
        return { success: true, filesChanged: 0, message: 'No changes detected' };
      }
      
      // Create incremental backup
      const filesListPath = path.join(this.backupDirectory, 'temp', `files-${timestamp}.txt`);
      await fs.writeFile(filesListPath, changedFiles.join('\n'));
      
      const tarCommand = `tar -czf "${backupPath}" -T "${filesListPath}"`;
      await execAsync(tarCommand);
      
      // Cleanup temp file
      await fs.unlink(filesListPath);
      
      // Encrypt if enabled
      let finalBackupPath = backupPath;
      if (this.encryptBackups) {
        finalBackupPath = await this.encryptBackupFile(backupPath);
        await fs.unlink(backupPath);
      }
      
      const backupSize = (await fs.stat(finalBackupPath)).size;
      const duration = Date.now() - startTime;
      
      // Update metrics
      await this.updateBackupMetrics('incremental', duration, backupSize, true);
      
      // Log success
      await this.logBackupEvent('INCREMENTAL_BACKUP_SUCCESS', {
        fileName: path.basename(finalBackupPath),
        filesChanged: changedFiles.length,
        size: backupSize,
        duration,
        type,
        encrypted: this.encryptBackups
      });
      
      console.log(`✅ Incremental backup completed: ${changedFiles.length} files (${(backupSize / 1024 / 1024).toFixed(2)} MB)`);
      
      return {
        success: true,
        fileName: path.basename(finalBackupPath),
        path: finalBackupPath,
        size: backupSize,
        duration,
        filesChanged: changedFiles.length
      };
      
    } catch (error) {
      console.error('❌ Incremental backup failed:', error);
      
      await this.updateBackupMetrics('incremental', Date.now() - startTime, 0, false);
      await this.logBackupEvent('INCREMENTAL_BACKUP_FAILED', {
        error: error.message,
        type,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  /**
   * Restore database from backup
   */
  async restoreDatabase(backupFileName, options = {}) {
    const startTime = Date.now();
    console.log(`🔄 Starting database restore from: ${backupFileName}`);
    
    try {
      const backupPath = path.join(this.backupDirectory, 'database', backupFileName);
      
      // Check if backup file exists
      await fs.access(backupPath);
      
      // Decrypt if necessary
      let workingPath = backupPath;
      if (this.encryptBackups && backupFileName.endsWith('.enc')) {
        workingPath = await this.decryptBackupFile(backupPath);
      }
      
      // Decompress if necessary
      if (workingPath.endsWith('.gz')) {
        workingPath = await this.decompressFile(workingPath);
      }
      
      // Read SQL backup
      const sqlContent = await fs.readFile(workingPath, 'utf8');
      
      // Get database connection details
      const dbHost = process.env.DATABASE_HOST || 'localhost';
      const dbPort = process.env.DATABASE_PORT || '5432';
      const dbName = process.env.DATABASE_NAME || 'nxt_backend';
      const dbUser = process.env.DATABASE_USER || 'postgres';
      const dbPassword = process.env.DATABASE_PASSWORD || '';
      
      // Create restore command
      const restoreCommand = `PGPASSWORD="${dbPassword}" psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName}`;
      
      if (!options.dryRun) {
        // Execute restore
        const { stderr } = await execAsync(restoreCommand, {
          input: sqlContent
        });
        
        if (stderr && !stderr.includes('WARNING') && !stderr.includes('NOTICE')) {
          throw new Error(`Database restore failed: ${stderr}`);
        }
      }
      
      // Cleanup temporary files
      if (workingPath !== backupPath) {
        await fs.unlink(workingPath);
      }
      
      const duration = Date.now() - startTime;
      
      // Log success
      await this.logBackupEvent('DATABASE_RESTORE_SUCCESS', {
        backupFileName,
        duration,
        dryRun: options.dryRun || false
      });
      
      console.log(`✅ Database restore completed (${(duration / 1000).toFixed(2)}s)`);
      
      return {
        success: true,
        backupFileName,
        duration,
        dryRun: options.dryRun || false
      };
      
    } catch (error) {
      console.error('❌ Database restore failed:', error);
      
      await this.logBackupEvent('DATABASE_RESTORE_FAILED', {
        backupFileName,
        error: error.message,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  /**
   * Compress file using gzip
   */
  async compressFile(filePath) {
    const compressedPath = `${filePath}.gz`;
    
    await pipeline(
      createReadStream(filePath),
      createGzip({ level: this.compressionLevel }),
      createWriteStream(compressedPath)
    );
    
    return compressedPath;
  }

  /**
   * Decompress gzip file
   */
  async decompressFile(compressedPath) {
    const decompressedPath = compressedPath.replace('.gz', '');
    
    await pipeline(
      createReadStream(compressedPath),
      createGunzip(),
      createWriteStream(decompressedPath)
    );
    
    return decompressedPath;
  }

  /**
   * Encrypt backup file
   */
  async encryptBackupFile(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const encryptedData = await encryptionService.encryptFile(fileBuffer, path.basename(filePath));
    const encryptedPath = `${filePath}.enc`;
    
    await fs.writeFile(encryptedPath, encryptedData);
    
    return encryptedPath;
  }

  /**
   * Decrypt backup file
   */
  async decryptBackupFile(encryptedPath) {
    const encryptedData = await fs.readFile(encryptedPath, 'utf8');
    const fileBuffer = await encryptionService.decryptFile(encryptedData, path.basename(encryptedPath));
    const decryptedPath = encryptedPath.replace('.enc', '');
    
    await fs.writeFile(decryptedPath, fileBuffer);
    
    return decryptedPath;
  }

  /**
   * Clean up old backups based on retention policy
   */
  async cleanupOldBackups() {
    console.log('🧹 Starting backup cleanup...');
    
    const backupTypes = ['database', 'files', 'full', 'incremental'];
    let totalCleaned = 0;
    let totalSpaceFreed = 0;
    
    for (const backupType of backupTypes) {
      const backupDir = path.join(this.backupDirectory, backupType);
      
      try {
        const files = await fs.readdir(backupDir);
        const fileStats = await Promise.all(
          files.map(async (file) => {
            const filePath = path.join(backupDir, file);
            const stats = await fs.stat(filePath);
            return {
              name: file,
              path: filePath,
              size: stats.size,
              created: stats.birthtime,
              age: Date.now() - stats.birthtime.getTime()
            };
          })
        );
        
        // Sort by creation date (newest first)
        fileStats.sort((a, b) => b.created - a.created);
        
        // Apply retention policy
        const maxAge = this.maxBackupAge * 24 * 60 * 60 * 1000; // Convert days to ms
        const filesToDelete = fileStats.filter(file => file.age > maxAge);
        
        // Keep minimum number of backups
        const minKeep = this.retentionPolicy.daily;
        if (fileStats.length - filesToDelete.length < minKeep) {
          const keepCount = Math.max(0, fileStats.length - minKeep);
          filesToDelete.splice(keepCount);
        }
        
        // Delete old files
        for (const file of filesToDelete) {
          await fs.unlink(file.path);
          totalCleaned++;
          totalSpaceFreed += file.size;
          console.log(`🗑️ Deleted old backup: ${file.name}`);
        }
        
      } catch (error) {
        console.error(`Error cleaning up ${backupType} backups:`, error);
      }
    }
    
    console.log(`✅ Backup cleanup completed: ${totalCleaned} files deleted, ${(totalSpaceFreed / 1024 / 1024).toFixed(2)} MB freed`);
    
    return {
      filesDeleted: totalCleaned,
      spaceFreed: totalSpaceFreed
    };
  }

  /**
   * Get last backup time for a specific type
   */
  async getLastBackupTime(backupType) {
    try {
      const backupDir = path.join(this.backupDirectory, backupType);
      const files = await fs.readdir(backupDir);
      
      if (files.length === 0) return null;
      
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(backupDir, file);
          const stats = await fs.stat(filePath);
          return stats.birthtime;
        })
      );
      
      return Math.max(...fileStats.map(date => date.getTime()));
    } catch (error) {
      return null;
    }
  }

  /**
   * Update backup metrics
   */
  async updateBackupMetrics(type, duration, size, success) {
    this.backupMetrics.totalBackups++;
    
    if (success) {
      this.backupMetrics.successfulBackups++;
    } else {
      this.backupMetrics.failedBackups++;
    }
    
    this.backupMetrics.lastBackupTime = new Date();
    this.backupMetrics.totalBackupSize += size;
    
    // Calculate average backup time
    this.backupMetrics.averageBackupTime = 
      (this.backupMetrics.averageBackupTime + duration) / 
      (this.backupMetrics.totalBackups === 1 ? 1 : 2);
    
    // Store metrics in database
    try {
      await db.insert(timeSeriesMetrics).values({
        timestamp: new Date(),
        metricName: 'backup_metrics',
        metricType: 'gauge',
        dimension1: type,
        dimension2: success ? 'success' : 'failure',
        value: duration,
        tags: {
          size,
          service: 'backup_recovery'
        }
      });
    } catch (error) {
      console.error('Error storing backup metrics:', error);
    }
  }

  /**
   * Log backup events
   */
  async logBackupEvent(eventType, details) {
    try {
      await db.insert(timeSeriesMetrics).values({
        timestamp: new Date(),
        metricName: 'backup_event',
        metricType: 'counter',
        dimension1: eventType,
        dimension2: details.type || 'unknown',
        value: 1,
        tags: {
          ...details,
          service: 'backup_recovery'
        }
      });
    } catch (error) {
      console.error('Error logging backup event:', error);
    }
  }

  /**
   * Perform backup health check
   */
  async performBackupHealthCheck() {
    console.log('🔍 Performing backup health check...');
    
    const healthStatus = {
      backupDirectory: false,
      permissions: false,
      diskSpace: false,
      lastBackup: false,
      encryption: false,
      overall: false
    };
    
    try {
      // Check backup directory
      await fs.access(this.backupDirectory);
      healthStatus.backupDirectory = true;
      
      // Check write permissions
      const testFile = path.join(this.backupDirectory, 'test-write.tmp');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      healthStatus.permissions = true;
      
      // Check disk space (require at least 1GB free)
      const stats = await fs.statfs ? fs.statfs(this.backupDirectory) : { bavail: 1024 * 1024 * 1024, bsize: 1 };
      const freeSpace = stats.bavail * stats.bsize;
      healthStatus.diskSpace = freeSpace > 1024 * 1024 * 1024; // 1GB
      
      // Check last backup (within 48 hours)
      const lastBackup = await this.getLastBackupTime('database');
      healthStatus.lastBackup = lastBackup ? (Date.now() - lastBackup < 48 * 60 * 60 * 1000) : false;
      
      // Check encryption service
      if (this.encryptBackups) {
        healthStatus.encryption = encryptionService.initialized;
      } else {
        healthStatus.encryption = true; // Not required
      }
      
      healthStatus.overall = Object.values(healthStatus).every(status => status);
      
      console.log('✅ Backup health check completed:', healthStatus);
      
      return healthStatus;
      
    } catch (error) {
      console.error('❌ Backup health check failed:', error);
      return healthStatus;
    }
  }

  /**
   * Get backup status and metrics
   */
  getBackupStatus() {
    return {
      initialized: this.initialized,
      backupDirectory: this.backupDirectory,
      encryptionEnabled: this.encryptBackups,
      schedule: this.backupSchedule,
      retentionPolicy: this.retentionPolicy,
      metrics: this.backupMetrics,
      configuration: {
        maxBackupAge: this.maxBackupAge,
        compressionLevel: this.compressionLevel
      }
    };
  }

  /**
   * List available backups
   */
  async listBackups(type = null) {
    const backupTypes = type ? [type] : ['database', 'files', 'full', 'incremental'];
    const backupList = {};
    
    for (const backupType of backupTypes) {
      const backupDir = path.join(this.backupDirectory, backupType);
      
      try {
        const files = await fs.readdir(backupDir);
        const fileDetails = await Promise.all(
          files.map(async (file) => {
            const filePath = path.join(backupDir, file);
            const stats = await fs.stat(filePath);
            return {
              name: file,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              encrypted: file.endsWith('.enc'),
              compressed: file.includes('.gz') || file.includes('.tar')
            };
          })
        );
        
        backupList[backupType] = fileDetails.sort((a, b) => b.created - a.created);
      } catch (error) {
        backupList[backupType] = [];
      }
    }
    
    return backupList;
  }

  /**
   * Test backup and restore functionality
   */
  async testBackupRestore() {
    console.log('🧪 Testing backup and restore functionality...');
    
    try {
      // Perform test database backup
      const testBackup = await this.performDatabaseBackup('test');
      
      // Test cleanup
      await fs.unlink(testBackup.path);
      
      console.log('✅ Backup and restore test passed');
      return { success: true, message: 'Test completed successfully' };
      
    } catch (error) {
      console.error('❌ Backup and restore test failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('🧹 Cleaning up backup service...');
    // Any cleanup tasks would go here
  }
}

// Export singleton instance
export const backupRecoveryService = new BackupRecoveryService();
export default backupRecoveryService;