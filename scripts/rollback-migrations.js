import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const rollbackMigrations = async (steps = 1) => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined in environment variables');
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {}, // Suppress notices
  });

  try {
    console.log(`🔄 Rolling back ${steps} migration(s)...`);

    // Check if migrations table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'drizzle_migrations'
      );
    `;

    if (!tableExists[0].exists) {
      console.log('ℹ️  No migrations table found. Nothing to rollback.');
      return;
    }

    // Get last N applied migrations
    const appliedMigrations = await sql`
      SELECT id, hash, created_at 
      FROM drizzle_migrations 
      ORDER BY created_at DESC 
      LIMIT ${steps};
    `;

    if (appliedMigrations.length === 0) {
      console.log('ℹ️  No migrations to rollback.');
      return;
    }

    console.log('\n🎯 Migrations to rollback:');
    appliedMigrations.forEach((m, i) => {
      console.log(`   ${i + 1}. Migration ${m.id} (applied at ${m.created_at})`);
    });

    // Read user confirmation
    console.log('\n⚠️  WARNING: This operation cannot be undone!');
    console.log('⚠️  Make sure you have a backup before proceeding.');
    console.log('\nPress Ctrl+C to cancel or wait 5 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // For each migration, we need to manually reverse it
    // This is a simplified version - in production, you'd want proper down migrations
    console.log('\n🔨 Rolling back migrations...');

    for (const migration of appliedMigrations) {
      console.log(`\n↩️  Rolling back migration ${migration.id}...`);
      
      // Remove from migrations table
      await sql`
        DELETE FROM drizzle_migrations 
        WHERE id = ${migration.id};
      `;
      
      console.log(`✅ Removed migration ${migration.id} from tracking`);
    }

    console.log('\n⚠️  IMPORTANT: This script only removes migration tracking.');
    console.log('⚠️  Database schema changes were NOT reversed.');
    console.log('⚠️  You need to manually drop/alter tables if needed.');
    
    // Show current state
    const remainingMigrations = await sql`
      SELECT COUNT(*) as count 
      FROM drizzle_migrations;
    `;
    
    console.log(`\n📊 Remaining migrations: ${remainingMigrations[0].count}`);

  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
const steps = args[0] ? parseInt(args[0], 10) : 1;

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  if (isNaN(steps) || steps < 1) {
    console.error('Usage: node rollback-migrations.js [steps]');
    console.error('Example: node rollback-migrations.js 2');
    process.exit(1);
  }

  rollbackMigrations(steps)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default rollbackMigrations;