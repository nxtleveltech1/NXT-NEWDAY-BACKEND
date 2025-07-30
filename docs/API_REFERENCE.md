# NXT NEW DAY API Reference

## Overview

This document provides comprehensive API documentation for the NXT NEW DAY platform, covering all available endpoints for inventory management, customer operations, supplier management, and analytics.

## Base URL

```
Development: http://localhost:4000/api
Production: https://your-domain.com/api
```

## Authentication

All API endpoints require authentication via JWT tokens provided by Stack Auth.

```bash
# Include token in headers
Authorization: Bearer <your-jwt-token>
```

## Response Format

All API responses follow a consistent format:

```json
{
  "success": true,
  "data": {}, // Response data
  "pagination": {}, // For paginated responses
  "error": null // Error details if success=false
}
```

## Error Handling

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "quantity",
      "message": "Must be a positive number"
    }
  }
}
```

## Rate Limiting

- **Default**: 100 requests per minute per IP
- **Authenticated**: 1000 requests per minute per user
- **Analytics**: 10 requests per minute per user

## Inventory Management API

### Get Inventory List

```http
GET /api/inventory
```

**Query Parameters:**
- `page` (integer, default: 1) - Page number
- `limit` (integer, default: 10, max: 100) - Items per page
- `search` (string) - Search products by name or SKU
- `warehouseId` (UUID) - Filter by warehouse
- `stockStatus` (string) - Filter by stock status
- `belowReorderPoint` (boolean) - Show items below reorder point
- `sortBy` (string) - Sort field (createdAt, quantityOnHand, etc.)
- `sortOrder` (string) - Sort direction (asc, desc)

**Example Request:**
```bash
curl -X GET "http://localhost:4000/api/inventory?page=1&limit=20&stockStatus=low_stock" \
  -H "Authorization: Bearer <token>"
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "productId": "uuid-here",
      "warehouseId": "warehouse-uuid",
      "quantityOnHand": 25,
      "quantityAvailable": 20,
      "quantityReserved": 5,
      "stockStatus": "low_stock",
      "reorderPoint": 30,
      "productSku": "PROD-001",
      "productName": "Sample Product",
      "lastMovement": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### Get Single Inventory Record

```http
GET /api/inventory/:id
```

**Path Parameters:**
- `id` (integer) - Inventory record ID

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "productId": "uuid-here",
    "warehouseId": "warehouse-uuid",
    "locationId": "location-uuid",
    "quantityOnHand": 25,
    "quantityAvailable": 20,
    "quantityReserved": 5,
    "quantityInTransit": 0,
    "lastStockCheck": "2024-01-15T08:00:00Z",
    "lastMovement": "2024-01-15T10:30:00Z",
    "stockStatus": "low_stock",
    "reorderPoint": 30,
    "reorderQuantity": 100,
    "maxStockLevel": 500,
    "minStockLevel": 10,
    "averageCost": 15.25,
    "lastPurchaseCost": 16.00,
    "productSku": "PROD-001",
    "productName": "Sample Product",
    "productDescription": "Product description here",
    "productCategory": "Electronics"
  }
}
```

### Record Inventory Movement

```http
POST /api/inventory/movements
```

**Request Body:**
```json
{
  "inventoryId": 1,
  "productId": "product-uuid",
  "warehouseId": "warehouse-uuid",
  "movementType": "sale",
  "quantity": -5,
  "unitCost": 25.00,
  "referenceType": "order",
  "referenceId": "order-uuid",
  "referenceNumber": "ORD-001",
  "performedBy": "user-uuid",
  "notes": "Customer order fulfillment",
  "batchNumber": "BATCH-001",
  "serialNumbers": ["SN001", "SN002"],
  "expiryDate": "2025-12-31"
}
```

**Movement Types:**
- `purchase` - Inbound from supplier
- `sale` - Outbound to customer
- `transfer` - Between locations
- `adjustment_in` - Positive adjustment
- `adjustment_out` - Negative adjustment
- `return` - Customer/supplier return
- `damage` - Damaged goods
- `expiry` - Expired goods

**Example Response:**
```json
{
  "success": true,
  "data": {
    "movement": {
      "id": "movement-uuid",
      "inventoryId": 1,
      "movementType": "sale",
      "quantity": -5,
      "quantityAfter": 20,
      "createdAt": "2024-01-15T11:00:00Z"
    },
    "inventory": {
      "id": 1,
      "quantityOnHand": 20,
      "quantityAvailable": 15,
      "stockStatus": "low_stock"
    }
  }
}
```

### Adjust Stock Levels

```http
PUT /api/inventory/:id/adjust
```

**Path Parameters:**
- `id` (integer) - Inventory record ID

**Request Body:**
```json
{
  "newQuantity": 50,
  "reason": "Physical count adjustment",
  "performedBy": "user-uuid",
  "notes": "Annual inventory count results"
}
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "quantityOnHand": 50,
    "quantityAvailable": 50,
    "stockStatus": "in_stock",
    "lastMovement": "2024-01-15T12:00:00Z"
  }
}
```

### Get Movement History

```http
GET /api/inventory/movements
```

**Query Parameters:**
- `page` (integer) - Page number
- `limit` (integer) - Items per page
- `inventoryId` (integer) - Filter by inventory record
- `productId` (UUID) - Filter by product
- `warehouseId` (UUID) - Filter by warehouse
- `movementType` (string) - Filter by movement type
- `dateFrom` (string) - Start date (ISO format)
- `dateTo` (string) - End date (ISO format)

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "movement-uuid",
      "inventoryId": 1,
      "productId": "product-uuid",
      "movementType": "sale",
      "quantity": -5,
      "unitCost": 25.00,
      "totalCost": 125.00,
      "referenceType": "order",
      "referenceNumber": "ORD-001",
      "performedBy": "user-uuid",
      "notes": "Customer order",
      "quantityAfter": 20,
      "productSku": "PROD-001",
      "productName": "Sample Product",
      "createdAt": "2024-01-15T11:00:00Z"
    }
  ]
}
```

## Analytics API

### Get Basic Inventory Analytics

```http
GET /api/inventory/analytics
```

**Query Parameters:**
- `warehouseId` (UUID) - Filter by warehouse
- `categoryFilter` (string) - Filter by category

**Example Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalItems": 1250,
      "totalValue": 125000.50,
      "totalOnHand": 15000,
      "totalReserved": 500,
      "totalAvailable": 14500,
      "itemsBelowReorder": 45,
      "itemsOutOfStock": 12
    },
    "categoryBreakdown": [
      {
        "category": "Electronics",
        "itemCount": 500,
        "totalValue": 75000.00,
        "totalQuantity": 8000
      }
    ],
    "stockStatusBreakdown": [
      {
        "stockStatus": "in_stock",
        "count": 1000,
        "totalValue": 100000.00
      },
      {
        "stockStatus": "low_stock",
        "count": 45,
        "totalValue": 15000.00
      }
    ]
  }
}
```

### Get Advanced Analytics

```http
GET /api/inventory/analytics/advanced
```

**Query Parameters:**
- `warehouseId` (UUID) - Filter by warehouse
- `categoryFilter` (string) - Filter by category
- `dateFrom` (string) - Analysis start date
- `dateTo` (string) - Analysis end date
- `analysisType` (string) - Type of analysis (all, turnover, aging, trends, forecast)

**Example Response:**
```json
{
  "success": true,
  "data": {
    "turnoverAnalysis": [
      {
        "productId": "product-uuid",
        "productSku": "PROD-001",
        "productName": "Sample Product",
        "currentStock": 25,
        "totalSold": 150,
        "turnoverRatio": 6.0,
        "daysOfInventory": 60.8,
        "monthsSinceLastSale": 0.5
      }
    ],
    "agingAnalysis": {
      "details": [
        {
          "productId": "product-uuid",
          "productSku": "PROD-001",
          "agingCategory": "Fresh (0-30 days)",
          "daysSinceLastReceived": 15,
          "riskLevel": "Low"
        }
      ],
      "summary": [
        {
          "agingCategory": "Fresh (0-30 days)",
          "itemCount": 800,
          "totalValue": 80000.00
        }
      ]
    },
    "trendAnalysis": {
      "dailyTrends": [
        {
          "date": "2024-01-15",
          "inboundMovements": 25,
          "outboundMovements": 45,
          "netMovement": -20
        }
      ]
    }
  }
}
```

### Get Reorder Suggestions

```http
GET /api/inventory/reorder
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "productId": "product-uuid",
      "productSku": "PROD-001",
      "productName": "Sample Product",
      "quantityOnHand": 15,
      "quantityAvailable": 10,
      "reorderPoint": 30,
      "reorderQuantity": 100,
      "supplierName": "Acme Supplier",
      "urgency": "high"
    }
  ]
}
```

## Customer Management API

### Get Customers

```http
GET /api/customers
```

**Query Parameters:**
- `page` (integer) - Page number
- `limit` (integer) - Items per page
- `search` (string) - Search by name, email, or code

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "customer-uuid",
      "customerCode": "CUST-001",
      "companyName": "Acme Corp",
      "email": "contact@acme.com",
      "phone": "+1-555-0123",
      "address": {
        "street": "123 Main St",
        "city": "Anytown",
        "state": "CA",
        "zipCode": "12345"
      },
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Customer

```http
POST /api/customers
```

**Request Body:**
```json
{
  "customerCode": "CUST-002",
  "companyName": "New Company",
  "email": "contact@newcompany.com",
  "phone": "+1-555-0124",
  "address": {
    "street": "456 Oak Ave",
    "city": "Somewhere",
    "state": "NY",
    "zipCode": "67890"
  },
  "metadata": {
    "industry": "Manufacturing",
    "contactPerson": "John Smith"
  }
}
```

## Supplier Management API

### Get Suppliers

```http
GET /api/suppliers
```

**Query Parameters:**
- `page` (integer) - Page number
- `limit` (integer) - Items per page
- `search` (string) - Search by name, email, or code
- `supplierType` (string) - Filter by type
- `isActive` (boolean) - Filter by active status

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "supplier-uuid",
      "supplierCode": "SUPP-001",
      "companyName": "ABC Supplier",
      "email": "sales@abcsupplier.com",
      "supplierType": "manufacturer",
      "performanceRating": 4.5,
      "leadTimeDays": 14,
      "isActive": true,
      "isApproved": true
    }
  ]
}
```

### Create Supplier

```http
POST /api/suppliers
```

**Request Body:**
```json
{
  "supplierCode": "SUPP-002",
  "companyName": "New Supplier",
  "email": "contact@newsupplier.com",
  "phone": "+1-555-0125",
  "supplierType": "distributor",
  "industry": "Electronics",
  "paymentTerms": {
    "net": 30,
    "discountPercent": 2,
    "discountDays": 10
  },
  "leadTimeDays": 7
}
```

## Price List Management API

### Get Price Lists

```http
GET /api/price-lists
```

**Query Parameters:**
- `supplierId` (UUID) - Filter by supplier
- `status` (string) - Filter by status (draft, active, expired)

### Upload Price List

```http
POST /api/suppliers/:supplierId/price-lists
```

**Request:** Multipart form data with file upload

**Form Fields:**
- `file` - Price list file (CSV, Excel, PDF, XML)
- `name` - Price list name
- `effectiveDate` - Effective date (ISO format)
- `expiryDate` - Expiry date (optional)

**Example Response:**
```json
{
  "success": true,
  "data": {
    "id": "pricelist-uuid",
    "supplierId": "supplier-uuid",
    "name": "Q1 2024 Price List",
    "status": "processing",
    "uploadFormat": "CSV",
    "itemCount": 0,
    "validationStatus": "pending"
  }
}
```

## Real-time WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:4000/ws/inventory');

ws.onopen = () => {
  // Send authentication
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-jwt-token'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

### Event Types

#### Inventory Change
```json
{
  "type": "inventory_change",
  "data": {
    "id": 1,
    "productId": "product-uuid",
    "oldQuantity": 30,
    "newQuantity": 25,
    "stockStatus": "low_stock",
    "changeReason": "movement_sale"
  }
}
```

#### Stock Alert
```json
{
  "type": "stock_alert",
  "data": {
    "inventoryId": 1,
    "productSku": "PROD-001",
    "productName": "Sample Product",
    "alertType": "low_stock",
    "priority": "high",
    "message": "LOW STOCK: Sample Product (PROD-001) - 5 remaining"
  }
}
```

#### Movement Notification
```json
{
  "type": "movement_recorded",
  "data": {
    "id": "movement-uuid",
    "inventoryId": 1,
    "movementType": "sale",
    "quantity": -5,
    "performedBy": "user-uuid"
  }
}
```

## Error Codes

### Authentication Errors
- `AUTH_REQUIRED` - Authentication token required
- `AUTH_INVALID` - Invalid or expired token
- `AUTH_INSUFFICIENT` - Insufficient permissions

### Validation Errors
- `VALIDATION_ERROR` - Request validation failed
- `MISSING_REQUIRED_FIELD` - Required field missing
- `INVALID_FORMAT` - Invalid data format
- `INVALID_RANGE` - Value out of allowed range

### Business Logic Errors
- `INSUFFICIENT_STOCK` - Not enough available stock
- `INVENTORY_NOT_FOUND` - Inventory record not found
- `PRODUCT_NOT_FOUND` - Product not found
- `WAREHOUSE_NOT_FOUND` - Warehouse not found
- `DUPLICATE_ENTRY` - Duplicate record exists

### System Errors
- `INTERNAL_ERROR` - Internal server error
- `DATABASE_ERROR` - Database operation failed
- `EXTERNAL_SERVICE_ERROR` - External service unavailable

## SDK Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

class InventoryAPI {
  constructor(baseURL, token) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getInventory(params = {}) {
    const response = await this.client.get('/inventory', { params });
    return response.data;
  }

  async recordMovement(movement) {
    const response = await this.client.post('/inventory/movements', movement);
    return response.data;
  }

  async getAnalytics(params = {}) {
    const response = await this.client.get('/inventory/analytics', { params });
    return response.data;
  }
}

// Usage
const api = new InventoryAPI('http://localhost:4000/api', 'your-token');
const inventory = await api.getInventory({ page: 1, limit: 20 });
```

### Python

```python
import requests

class InventoryAPI:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    
    def get_inventory(self, **params):
        response = requests.get(
            f'{self.base_url}/inventory',
            headers=self.headers,
            params=params
        )
        return response.json()
    
    def record_movement(self, movement):
        response = requests.post(
            f'{self.base_url}/inventory/movements',
            headers=self.headers,
            json=movement
        )
        return response.json()

# Usage
api = InventoryAPI('http://localhost:4000/api', 'your-token')
inventory = api.get_inventory(page=1, limit=20)
```

## Testing

### Example Test Cases

```bash
# Test inventory list
curl -X GET "http://localhost:4000/api/inventory" \
  -H "Authorization: Bearer <token>"

# Test movement recording
curl -X POST "http://localhost:4000/api/inventory/movements" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "inventoryId": 1,
    "movementType": "sale",
    "quantity": -5,
    "performedBy": "user-uuid"
  }'

# Test analytics
curl -X GET "http://localhost:4000/api/inventory/analytics" \
  -H "Authorization: Bearer <token>"
```

## Changelog

### Version 1.0.0 (Current)
- Initial API implementation
- Inventory management endpoints
- Real-time WebSocket integration
- Analytics and reporting
- Customer and supplier management
- Price list functionality

For additional API details and updates, refer to the project documentation and changelog.