# Supplier Module API Endpoints

This document describes the API endpoints implemented for the unified supplier module as specified in story 1.3.

## Base URL
All endpoints are prefixed with `/api/suppliers` and require authentication.

## Rate Limiting
- General endpoints: 1000 requests per 15 minutes per IP
- Upload endpoints: 10 uploads per 15 minutes per IP

## Authentication
All endpoints require a valid JWT token passed in the `Authorization` header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### Supplier Management (CRUD)

#### GET /api/suppliers
Get all suppliers with filtering and pagination.

**Query Parameters:**
- `page` (integer, optional): Page number (default: 1)
- `limit` (integer, optional): Items per page (1-100, default: 10)
- `search` (string, optional): Search by company name, supplier code, or email
- `isActive` (boolean, optional): Filter by active status
- `sortBy` (string, optional): Sort field (`companyName`, `supplierCode`, `createdAt`, `updatedAt`)
- `sortOrder` (string, optional): Sort order (`asc`, `desc`)

**Response:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  },
  "timestamp": "2025-07-19T09:00:00.000Z"
}
```

#### GET /api/suppliers/search
Advanced supplier search with multiple criteria.

**Query Parameters:**
- `q` (string): Search query
- `category` (string, optional): Category filter
- `location` (string, optional): Location filter
- `paymentTermsMin` (integer, optional): Minimum payment terms
- `paymentTermsMax` (integer, optional): Maximum payment terms

#### GET /api/suppliers/:id
Get supplier by ID.

**Path Parameters:**
- `id` (UUID): Supplier ID

#### POST /api/suppliers
Create new supplier.

**Request Body:**
```json
{
  "companyName": "Supplier Name",
  "email": "supplier@example.com",
  "supplierCode": "SUP001",
  "contactPerson": "John Doe",
  "phone": "+1234567890",
  "address": "123 Main St",
  "paymentTerms": 30,
  "isActive": true
}
```

#### PUT /api/suppliers/:id
Update supplier.

**Path Parameters:**
- `id` (UUID): Supplier ID

**Request Body:** Same as POST (all fields optional)

#### DELETE /api/suppliers/:id
Deactivate supplier (soft delete).

**Path Parameters:**
- `id` (UUID): Supplier ID

### Price List Management

#### POST /api/suppliers/:id/price-lists
Upload price list for supplier (multipart upload).

**Path Parameters:**
- `id` (UUID): Supplier ID

**Request:** 
- Content-Type: `multipart/form-data`
- Form field: `file` (CSV, Excel, JSON, XML, PDF)

**Supported File Formats:**
- CSV (.csv)
- Excel (.xlsx, .xls)
- JSON (.json)
- XML (.xml)
- PDF (.pdf)

**Response:**
```json
{
  "success": true,
  "uploadId": "upload-id-123",
  "message": "Price list upload queued for processing",
  "estimatedProcessingTime": "2-5 minutes",
  "statusEndpoint": "/api/suppliers/:id/price-lists/upload/:uploadId/status",
  "timestamp": "2025-07-19T09:00:00.000Z"
}
```

#### GET /api/suppliers/:id/price-lists/upload/:uploadId/status
Get upload status.

**Path Parameters:**
- `id` (UUID): Supplier ID
- `uploadId` (string): Upload ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "upload-id-123",
    "status": "processing",
    "progress": 50,
    "createdAt": "2025-07-19T09:00:00.000Z",
    "startedAt": "2025-07-19T09:01:00.000Z"
  },
  "timestamp": "2025-07-19T09:02:00.000Z"
}
```

#### POST /api/suppliers/:id/price-lists/:listId/activate
Activate price list.

**Path Parameters:**
- `id` (UUID): Supplier ID
- `listId` (UUID): Price list ID

### Price Query Endpoints

#### GET /api/suppliers/:id/prices
Get current prices for supplier products.

**Path Parameters:**
- `id` (UUID): Supplier ID

**Query Parameters:**
- `sku` (string, optional): Specific SKU to get price for
- `quantity` (integer, optional): Quantity for tiered pricing (default: 1)
- `category` (string, optional): Category filter

**Response for specific SKU:**
```json
{
  "success": true,
  "data": {
    "sku": "PROD001",
    "unitPrice": 29.99,
    "currency": "USD",
    "quantity": 10,
    "totalPrice": 299.90,
    "minimumOrderQuantity": 1,
    "priceListId": "price-list-id",
    "supplierId": "supplier-id"
  },
  "timestamp": "2025-07-19T09:00:00.000Z"
}
```

**Response for all prices:**
```json
{
  "success": true,
  "data": {
    "...supplier": "...",
    "priceLists": [...]
  },
  "timestamp": "2025-07-19T09:00:00.000Z"
}
```

### Supplier Analytics Endpoints

#### GET /api/suppliers/:id/analytics
Get supplier analytics and performance metrics.

**Path Parameters:**
- `id` (UUID): Supplier ID

**Query Parameters:**
- `dateFrom` (ISO8601, optional): Start date for analysis
- `dateTo` (ISO8601, optional): End date for analysis
- `includeDetails` (boolean, optional): Include detailed data

**Response:**
```json
{
  "success": true,
  "data": {
    "supplierId": "supplier-id",
    "supplierInfo": {...},
    "performanceMetrics": {
      "totalProducts": 50,
      "totalInventoryValue": 150000.00,
      "averageLeadTime": 7.5,
      "reorderItemsCount": 5,
      "priceListsTotal": 3,
      "activePriceLists": 1
    },
    "inventorySummary": {...},
    "reorderAlerts": [...]
  },
  "metadata": {
    "dateFrom": "2025-01-01",
    "dateTo": "2025-07-19",
    "includeDetails": false,
    "generatedAt": "2025-07-19T09:00:00.000Z"
  }
}
```

#### GET /api/suppliers/analytics/overview
Get supplier analytics overview for all suppliers.

**Query Parameters:**
- `limit` (integer, optional): Number of top suppliers (1-100, default: 10)
- `sortBy` (string, optional): Sort criteria (`performance`, `inventory_value`, `lead_time`)

### Additional Supplier Endpoints

#### GET /api/suppliers/:id/inventory
Get supplier inventory levels and product information.

#### POST /api/suppliers/:id/purchase-receipt
Record purchase receipt from supplier.

**Request Body:**
```json
{
  "referenceNumber": "PO-12345",
  "items": [
    {
      "productId": "product-uuid",
      "warehouseId": "warehouse-uuid",
      "quantity": 100,
      "unitCost": 25.00
    }
  ],
  "notes": "Optional notes"
}
```

#### GET /api/suppliers/:id/lead-times
Get supplier lead time analysis.

**Query Parameters:**
- `productId` (UUID, optional): Filter by product
- `dateFrom` (ISO8601, optional): Start date
- `dateTo` (ISO8601, optional): End date

#### GET /api/suppliers/:id/reorder-suggestions
Get reorder suggestions for supplier products.

## Legacy Endpoints (Backward Compatibility)

The following legacy endpoints are maintained for backward compatibility but new implementations should use the supplier-scoped routes:

- `GET /api/price-lists`
- `GET /api/price-lists/:id`
- `GET /api/price-lists/template/:format`
- `PUT /api/price-lists/:id/approve`
- `PUT /api/price-lists/:id/activate`

## Error Responses

All endpoints follow a consistent error response format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information",
  "timestamp": "2025-07-19T09:00:00.000Z"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `202` - Accepted (for async operations)
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## File Upload Requirements

### Supported Formats
- **CSV**: Standard comma-delimited with headers
- **Excel**: .xlsx/.xls with multiple sheets support
- **JSON**: Nested structure with items array
- **XML**: Structured with item elements
- **PDF**: Table extraction (basic support)

### File Size Limits
- Maximum file size: 10MB per upload
- Maximum concurrent uploads: 5 per supplier

### Upload Process
1. File validation (format, size, structure)
2. Queue for background processing
3. Parse and standardize data
4. Business rule validation
5. Database insertion with conflict resolution
6. Price list activation workflow

## Business Rules

### Price List Upload
- Only one active price list per supplier at a time
- Price lists must be approved before activation
- Concurrent uploads are queued and processed sequentially
- Duplicate SKUs within the same upload are rejected
- Currency must be consistent within a price list
- Tiered pricing supports multiple quantity breaks

### Supplier Management
- Email addresses must be unique across suppliers
- Supplier codes are optional but must be unique if provided
- Deactivation is soft delete (sets isActive = false)
- Active suppliers can have multiple price lists but only one active

### Error Handling
- Validation errors include field-specific details
- Upload errors provide line-by-line feedback
- Retry mechanisms for transient failures
- Comprehensive logging for debugging

## Integration Notes

### WebSocket Support
Real-time updates for upload progress and inventory changes are available via WebSocket connection at `/api/realtime/inventory`.

### Caching
- Analytics data cached for 5 minutes
- Price list data cached for 3 minutes
- Supplier list cached for 1 minute

### Performance
- All list endpoints support pagination
- Complex analytics queries include performance tracking
- Bulk operations use database transactions
- Background processing for large file uploads