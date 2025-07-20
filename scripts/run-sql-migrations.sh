#!/bin/bash

# Load environment variables
source ../.env

# Extract database connection details from DATABASE_URL
# Format: postgresql://user:password@host:port/database
if [[ $DATABASE_URL =~ postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
else
    echo "❌ Invalid DATABASE_URL format"
    exit 1
fi

echo "🚀 Running SQL migrations..."
echo "📊 Database: $DB_NAME on $DB_HOST:$DB_PORT"

# Migration files in order
MIGRATIONS=(
    "0000_medical_maddog.sql"
    "0001_unified_supplier_module.sql"
    "0002_customer_purchase_history.sql"
    "0004_invoicing_system.sql"
    "0005_supplier_purchase_orders.sql"
    "0006_warehouses.sql"
    "0007_supplier_receipts.sql"
    "0003_performance_optimization_indexes.sql"
)

# Run each migration
for migration in "${MIGRATIONS[@]}"; do
    echo "Running migration: $migration"
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "../src/db/migrations/$migration"
    
    if [ $? -eq 0 ]; then
        echo "✅ $migration completed"
    else
        echo "❌ $migration failed"
        exit 1
    fi
done

echo "✅ All migrations completed successfully!"