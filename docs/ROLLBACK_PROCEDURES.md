# Database Rollback Procedures

## Overview
This document outlines the rollback procedures for the NXT NEW DAY database migrations.

## Backup Procedures

### Creating a Backup
```javascript
import { backupDatabase } from './src/db/rollback.js';

// Create a named backup
const backupPath = await backupDatabase('pre-deployment');
```

### Automatic Backup Locations
Backups are stored in: `BACKEND/src/db/backups/[name]-[timestamp]/`

Each backup includes:
- JSON export of all table data
- `manifest.json` with metadata
- Record counts for validation

## Rollback Procedures

### 1. Full Schema Rollback
To completely remove all database tables:

```javascript
import { rollbackMigration } from './src/db/rollback.js';

// Rollback the initial migration
await rollbackMigration('0000_medical_maddog');
```

This will drop all tables in the correct order to avoid foreign key violations.

### 2. Data Rollback (Restore from Backup)
To restore data from a previous backup:

```javascript
import { restoreFromBackup } from './src/db/rollback.js';

// Restore from specific backup
await restoreFromBackup('./src/db/backups/pre-deployment-2024-01-19T10-30-00');
```

### 3. Partial Rollback
For specific table rollbacks, use direct SQL:

```sql
-- Example: Rollback only price lists
DELETE FROM price_list_items;
DELETE FROM price_lists;
```

## Testing Rollback Procedures

Run the built-in test:
```bash
node -e "import('./src/db/rollback.js').then(m => m.testRollback())"
```

This test will:
1. Create a backup
2. Insert test data
3. Restore from backup
4. Verify the rollback worked

## Emergency Procedures

### If Migration Fails
1. Note the error message
2. Run: `npm run db:rollback`
3. Fix the schema issue
4. Re-run migrations

### If Data Corruption Occurs
1. Stop all application access
2. Create immediate backup: `backupDatabase('emergency')`
3. Analyze the corruption
4. Restore from last known good backup

### Command Line Scripts
Add to package.json for quick access:
```json
{
  "scripts": {
    "db:backup": "node -e \"import('./src/db/rollback.js').then(m => m.backupDatabase('manual'))\"",
    "db:rollback": "node -e \"import('./src/db/rollback.js').then(m => m.rollbackMigration('0000_medical_maddog'))\"",
    "db:test-rollback": "node -e \"import('./src/db/rollback.js').then(m => m.testRollback())\""
  }
}
```

## Best Practices

1. **Always backup before major changes**
   ```bash
   npm run db:backup
   ```

2. **Test rollback procedures regularly**
   ```bash
   npm run db:test-rollback
   ```

3. **Document the reason for rollback**
   - Keep a log of why rollbacks were performed
   - Note any data loss or issues encountered

4. **Verify after rollback**
   - Check table structure
   - Validate data integrity
   - Test application functionality

## Recovery Time Objectives

- Backup creation: ~30 seconds for 10,000 records
- Full rollback: ~1 minute
- Data restore: ~2 minutes for 10,000 records

## Contact for Issues

If rollback procedures fail:
1. Check error logs in console
2. Verify database connection
3. Ensure sufficient permissions
4. Contact DevOps team if issues persist