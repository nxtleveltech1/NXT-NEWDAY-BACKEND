import { db } from '../index.js';
import * as schema from '../schema.js';

// Sample data for testing migrations
export async function loadSampleData() {
  console.log('Loading sample data...');
  
  try {
    // Insert sample suppliers
    const suppliers = await db.insert(schema.suppliers).values([
      {
        supplierCode: 'SUPP-001',
        companyName: 'Acme Supplies Inc',
        email: 'contact@acmesupplies.com',
        contactDetails: {
          phone: '+1-555-0100',
          address: '123 Main St, New York, NY 10001',
          contact_person: 'John Doe'
        },
        paymentTerms: { net_days: 30, discount_percent: 2, discount_days: 10 },
        isActive: true
      },
      {
        supplierCode: 'SUPP-002',
        companyName: 'Global Parts Co',
        email: 'sales@globalparts.com',
        contactDetails: {
          phone: '+1-555-0200',
          address: '456 Oak Ave, Los Angeles, CA 90001',
          contact_person: 'Jane Smith'
        },
        paymentTerms: { net_days: 45 },
        isActive: true
      }
    ]).returning();
    
    console.log(`Created ${suppliers.length} suppliers`);
    
    // Insert sample customers
    const customers = await db.insert(schema.customers).values([
      {
        customerCode: 'CUST-001',
        companyName: 'TechCorp Industries',
        email: 'purchasing@techcorp.com',
        phone: '+1-555-1000',
        address: {
          street: '789 Tech Blvd',
          city: 'San Francisco',
          state: 'CA',
          zip: '94105',
          country: 'USA'
        },
        metadata: {
          tier: 'premium',
          credit_limit: 50000,
          payment_terms: 'net-30',
          assigned_sales_rep: 'Mike Johnson'
        },
        purchaseHistory: []
      },
      {
        customerCode: 'CUST-002',
        companyName: 'RetailMart LLC',
        email: 'orders@retailmart.com',
        phone: '+1-555-2000',
        address: {
          street: '321 Commerce St',
          city: 'Chicago',
          state: 'IL',
          zip: '60601',
          country: 'USA'
        },
        metadata: {
          tier: 'standard',
          credit_limit: 25000,
          payment_terms: 'net-15'
        },
        purchaseHistory: []
      }
    ]).returning();
    
    console.log(`Created ${customers.length} customers`);
    
    // Insert sample products
    const products = await db.insert(schema.products).values([
      {
        sku: 'PROD-001',
        name: 'Widget A',
        description: 'High-quality industrial widget',
        category: 'Widgets',
        unitPrice: '29.99',
        costPrice: '15.00',
        supplierId: suppliers[0].id,
        isActive: true,
        metadata: { weight: '0.5kg', dimensions: '10x10x5cm' }
      },
      {
        sku: 'PROD-002',
        name: 'Gadget B',
        description: 'Professional-grade gadget',
        category: 'Gadgets',
        unitPrice: '49.99',
        costPrice: '25.00',
        supplierId: suppliers[1].id,
        isActive: true,
        metadata: { weight: '1.0kg', dimensions: '20x15x10cm' }
      }
    ]).returning();
    
    console.log(`Created ${products.length} products`);
    
    // Create sample price lists
    const priceLists = await db.insert(schema.priceLists).values([
      {
        supplierId: suppliers[0].id,
        name: 'Q1 2024 Price List',
        effectiveDate: new Date('2024-01-01'),
        expiryDate: new Date('2024-03-31'),
        status: 'active',
        uploadFormat: 'CSV'
      }
    ]).returning();
    
    // Add price list items
    await db.insert(schema.priceListItems).values([
      {
        priceListId: priceLists[0].id,
        sku: 'PROD-001',
        description: 'Widget A - Bulk pricing',
        unitPrice: '27.99',
        currency: 'USD',
        minQuantity: 10,
        discountPercent: '5.00',
        tierPricing: [
          { minQty: 50, price: '25.99', discount: '10' },
          { minQty: 100, price: '23.99', discount: '15' }
        ]
      }
    ]);
    
    console.log('Sample data loaded successfully!');
    
    return {
      suppliers: suppliers.length,
      customers: customers.length,
      products: products.length,
      priceLists: priceLists.length
    };
    
  } catch (error) {
    console.error('Error loading sample data:', error);
    throw error;
  }
}