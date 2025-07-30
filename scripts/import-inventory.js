import { db } from '../src/db/index.js';
import { inventory, inventoryMovements, products, warehouses } from '../src/db/schema.js';
import { testConnection, closePool } from '../src/config/database.js';
import { eq } from 'drizzle-orm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const JSONStream = require('JSONStream');
import fs from 'fs';
import { Writable } from 'stream';
import { upsertInventory } from '../src/db/inventory-queries.js';

async function clearDatabase() {
  console.log('Clearing existing inventory data...');
  await db.delete(inventoryMovements);
  await db.delete(inventory);
  await db.delete(products);
  console.log('Database cleared.');
}

async function processProduct(product, warehouseId) {
  try {
    // Create a new product with a generated UUID
    const newProduct = await db.insert(products).values({
      externalId: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.categories.map(c => c.name).join(', '),
      unitPrice: product.price,
      costPrice: product.price, // Assuming cost price is the same as unit price for now
      isActive: product.status === 'publish',
    }).returning();

    const transformedInventory = {
      productId: newProduct[0].id,
      warehouseId: warehouseId,
      quantityOnHand: product.stock_quantity || 0,
    };

    await upsertInventory(transformedInventory);
    console.log(`Processed product: ${product.name}`);
  } catch (error) {
    console.error(`Failed to process product: ${product.name} (ID: ${product.id})`);
    console.error(error);
    // Optionally, you can write the failed product to a separate file for later review
    // fs.appendFileSync('failed-products.log', JSON.stringify(product) + '\n');
  }
}

async function main() {
  try {
    console.log('Starting inventory import...');
    await testConnection();
    await clearDatabase();

    // Get the default warehouse ID
    const warehouse = await db.select().from(warehouses).where(eq(warehouses.code, 'DEFAULT')).limit(1);
    if (!warehouse[0]) {
      throw new Error('Default warehouse not found. Please run the setup-defaults.js script.');
    }
    const warehouseId = warehouse[0].id;

    const filePath = './backups/woocommerce-products-2025-07-13.json';
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const jsonStream = stream.pipe(JSONStream.parse('*'));

    const writableStream = new Writable({
      objectMode: true,
      async write(product, encoding, callback) {
        try {
          await processProduct(product, warehouseId);
          callback();
        } catch (error) {
          callback(error);
        }
      }
    });

    await new Promise((resolve, reject) => {
      jsonStream.pipe(writableStream);
      writableStream.on('finish', resolve);
      writableStream.on('error', reject);
    });

    console.log('Inventory import completed successfully.');
  } catch (error) {
    console.error('Failed to import inventory:', error);
  } finally {
    await closePool();
  }
}

main();