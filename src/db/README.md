# Database Schema Documentation

## Customer Schema

The Customer schema is implemented using Drizzle ORM with PostgreSQL/Neon. It includes comprehensive fields for customer management with JSONB support for flexible metadata storage.

### Table Structure

```typescript
customers {
  id: UUID (Primary Key, auto-generated)
  customer_code: VARCHAR(50) (Unique, Not Null)
  company_name: VARCHAR(255) (Not Null)
  email: VARCHAR(255) (Not Null)
  phone: VARCHAR(50) (Nullable)
  address: JSONB (Nullable)
  metadata: JSONB (Nullable) - For 4 sets of metadata
  purchase_history: JSONB (Nullable)
  created_at: TIMESTAMP (Not Null, auto-generated)
  updated_at: TIMESTAMP (Not Null, auto-generated)
}
```

### Indexes

For optimal performance, the following indexes are created:

1. **Primary Key Index**: On `id` (automatic)
2. **Unique Index**: On `customer_code` for fast lookups
3. **Regular Indexes**:
   - `email` - For email-based queries
   - `company_name` - For company name searches
   - `created_at` - For temporal queries
   - `(email, phone)` - Composite index for combined searches

### JSONB Field Structures

#### Address Structure
```json
{
  "street": "123 Main St",
  "city": "New York",
  "state": "NY",
  "zip": "10001",
  "country": "USA"
}
```

#### Metadata Structure (4 sets)
```json
{
  "set1": { /* Custom fields */ },
  "set2": { /* Custom fields */ },
  "set3": { /* Custom fields */ },
  "set4": { /* Custom fields */ }
}
```

#### Purchase History Structure
```json
{
  "orders": [
    {
      "orderId": "ORD-123",
      "date": "2024-01-01",
      "amount": 1000.00,
      "items": [
        {
          "sku": "ITEM-001",
          "quantity": 2,
          "price": 500.00
        }
      ]
    }
  ],
  "totalLifetimeValue": 5000.00,
  "lastPurchaseDate": "2024-01-01"
}
```

### Usage Examples

```javascript
import { createCustomer, getCustomerByCode, updateCustomerMetadata } from './customer-queries.js';

// Create a new customer
const newCustomer = await createCustomer({
  customerCode: 'CUST-001',
  companyName: 'Acme Corp',
  email: 'contact@acme.com',
  phone: '+1-555-0123',
  address: {
    street: '123 Business Ave',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    country: 'USA'
  },
  metadata: {
    set1: { industry: 'Technology' },
    set2: { preferredPaymentTerms: 'Net 30' }
  }
});

// Update customer metadata
await updateCustomerMetadata(customerId, {
  set3: { creditLimit: 50000 }
});
```

### Migration Commands

```bash
# Generate migration files from schema
npm run db:generate

# Run migrations
npm run db:migrate

# Push schema directly to database (development)
npm run db:push

# Open Drizzle Studio to view/edit data
npm run db:studio
```

### Performance Considerations

1. **Indexes**: All frequently queried fields have indexes
2. **JSONB**: Allows flexible storage while maintaining query performance
3. **UUID**: Provides globally unique identifiers suitable for distributed systems
4. **Timestamps**: Automatically managed for audit trails

### Query Performance Tips

1. Use the provided indexes for filtering
2. For JSONB queries, use PostgreSQL's JSON operators
3. Consider creating additional indexes on frequently accessed JSONB paths
4. Use pagination for large result sets