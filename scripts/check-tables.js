import dotenv from 'dotenv';
import { db, sql } from '../src/config/database.js';

dotenv.config();

async function checkTables() {
  try {
    // Get all tables
    const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📊 Database Tables Found:');
    console.log('========================');
    
    if (result.rows.length === 0) {
      console.log('❌ No tables found! Migrations may not have been run.');
    } else {
      result.rows.forEach(row => {
        console.log(`✅ ${row.table_name}`);
      });
      console.log(`\nTotal tables: ${result.rows.length}`);
    }
    
    // Check if drizzle migration table exists
    const migrationCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      )
    `);
    
    if (migrationCheck.rows[0]?.exists) {
      // Get migration status
      const migrations = await db.execute(sql`
        SELECT hash, created_at 
        FROM __drizzle_migrations 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log('\n📝 Recent Migrations:');
      console.log('====================');
      migrations.rows.forEach(m => {
        console.log(`- ${m.hash} (${new Date(m.created_at).toLocaleString()})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
  }
  
  process.exit(0);
}

checkTables();