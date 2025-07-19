# File Parsers for Price List Upload

## Overview

This module provides comprehensive file parsing capabilities for supplier price list uploads, supporting multiple file formats with robust validation, error handling, and performance optimization.

## Supported File Formats

### CSV (.csv)
- **Standard format** with comma-separated values
- **Flexible column mapping** supports various header names
- **Tier pricing support** through QTY_X/PRICE_X columns
- **Custom delimiters** (comma, semicolon, tab)
- **Performance optimized** for large files

### Excel (.xlsx, .xls)
- **Multi-sheet support** with sheet selection
- **Column width optimization** in generated templates
- **Formula handling** for calculated fields
- **Instructions sheet** included in templates
- **Batch processing** for large workbooks

### JSON (.json)
- **Multiple format support**:
  - Array format: `[{item1}, {item2}]`
  - Object format: `{metadata: {...}, items: [...]}`
  - Nested format: `{supplier: {...}, priceList: {...}}`
- **Metadata extraction** from structured objects
- **Tier pricing arrays** with flexible field names
- **Schema validation** and format detection

### XML (.xml)
- **Flexible element names** (item, product, article)
- **Attribute and element support** for data fields
- **Namespace handling** for complex XML structures
- **Tier pricing elements** with nested structures
- **Well-formed XML validation**

### PDF (.pdf)
- **Table extraction** from structured PDFs
- **Text-based PDF support** (not scanned images)
- **Pattern matching** for table data
- **Metadata extraction** from document headers
- **Tier pricing parsing** from text sections
- **Analysis tools** to determine PDF type

## Key Features

### 🚀 Performance Optimization
- **Streaming processing** for files >10MB
- **Chunked parsing** for files >1MB with 1000+ items
- **Memory management** with automatic garbage collection
- **Progress reporting** with detailed metrics
- **Concurrent processing** support

### 🔍 Enhanced Validation
- **Business rule validation** with configurable strictness
- **Currency support** (USD, EUR, GBP, ZAR)
- **SKU format validation** with reserved prefix checking
- **Tier pricing logic** validation and optimization suggestions
- **Performance warnings** for large uploads

### 📊 Error Reporting
- **User-friendly messages** with actionable guidance
- **Detailed error categorization** (format, validation, business)
- **Fix suggestions** specific to each error type
- **Multiple export formats** (JSON, CSV, HTML)
- **Progress tracking** and status updates

### 🔄 Upload Queue Management
- **Concurrent upload processing** with configurable limits
- **Priority-based queuing** (low, normal, high, urgent, critical)
- **Conflict detection** and resolution strategies
- **Retry logic** with exponential backoff
- **Real-time progress monitoring**

## Usage Examples

### Basic File Parsing

```javascript
import { parsePriceListFile } from './file-parsers/index.js';

const file = {
  filename: 'price-list.csv',
  mimeType: 'text/csv',
  buffer: fileBuffer
};

const result = await parsePriceListFile(file);

if (result.success) {
  console.log(`Parsed ${result.parsedCount} items`);
  console.log('Data:', result.data);
} else {
  console.error('Parsing failed:', result.error);
}
```

### Enhanced Validation

```javascript
import { validatePriceListData } from './file-parsers/index.js';

const validation = validatePriceListData(priceList, items, {
  strictMode: true,
  validateBusinessRules: true,
  performanceCheck: true
});

console.log('Validation result:', validation.valid);
console.log('Errors:', validation.errors);
console.log('Warnings:', validation.warnings);
console.log('Recommendations:', validation.recommendations);
```

### Upload Queue Processing

```javascript
import { getUploadQueue } from './upload-queue.js';

const uploadQueue = getUploadQueue();

const uploadRequest = {
  supplierId: 123,
  userId: 456,
  file: fileBuffer,
  filename: 'price-list.csv',
  priority: 'high',
  conflictResolution: 'queue'
};

const result = await uploadQueue.enqueue(uploadRequest);
console.log('Upload queued:', result.uploadId);

// Monitor progress
uploadQueue.on('upload:progress', (progress) => {
  console.log(`Progress: ${progress.progress}%`);
});
```

### Performance Optimization

```javascript
import { withPerformanceOptimization } from './file-parsers/performance-optimizer.js';

// Wrap parser with performance optimization
const optimizedParser = withPerformanceOptimization(originalParser, 'csv');

const result = await optimizedParser(fileBuffer, {
  optimize: true,
  onProgress: (progress) => {
    console.log(`Processing: ${progress.items} items`);
  }
});

if (result.performanceMetrics) {
  console.log('Performance:', result.performanceMetrics);
}
```

### Error Reporting

```javascript
import { generateErrorReport } from './file-parsers/error-reporter.js';

const errorReport = generateErrorReport(parseResult, validationResult, {
  includeFixSuggestions: true,
  formatForUser: true
});

console.log('Status:', errorReport.status);
console.log('Message:', errorReport.userFriendlyMessage);
console.log('Steps:', errorReport.actionableSteps);

// Export as HTML
import { exportErrorReportAsHTML } from './file-parsers/error-reporter.js';
const htmlReport = exportErrorReportAsHTML(errorReport);
```

## Configuration

### Business Rules

```javascript
import { BUSINESS_RULES } from './file-parsers/validation.js';

// Currency support
BUSINESS_RULES.currencies.supported; // ['USD', 'EUR', 'GBP', 'ZAR']

// Pricing limits
BUSINESS_RULES.pricing.minUnitPrice; // 0.01
BUSINESS_RULES.pricing.maxUnitPrice; // 999999.99

// SKU validation
BUSINESS_RULES.sku.minLength; // 3
BUSINESS_RULES.sku.maxLength; // 50
BUSINESS_RULES.sku.pattern; // /^[A-Z0-9-_]+$/i

// Performance limits
BUSINESS_RULES.performance.maxItemsPerUpload; // 10000
BUSINESS_RULES.performance.warningThreshold; // 1000
```

### Performance Configuration

```javascript
import { PERFORMANCE_CONFIG } from './file-parsers/performance-optimizer.js';

// Chunk sizes for different formats
PERFORMANCE_CONFIG.parsing.csvChunkSize; // 1000
PERFORMANCE_CONFIG.parsing.excelChunkSize; // 500

// Memory management
PERFORMANCE_CONFIG.memory.maxMemoryUsage; // 256MB
PERFORMANCE_CONFIG.memory.gcThreshold; // 128MB

// Processing limits
PERFORMANCE_CONFIG.processing.maxItemsInMemory; // 5000
PERFORMANCE_CONFIG.processing.batchSize; // 100
```

## File Format Templates

### Generate Templates

```javascript
import { generatePriceListTemplate } from './file-parsers/index.js';

// Generate CSV template
const csvTemplate = generatePriceListTemplate('CSV');

// Generate Excel template (returns Buffer)
const excelTemplate = generatePriceListTemplate('EXCEL');

// Generate JSON template
const jsonTemplate = generatePriceListTemplate('JSON');

// Generate XML template
const xmlTemplate = generatePriceListTemplate('XML');
```

### CSV Template Format

```csv
SKU,Description,Unit_Price,Currency,Minimum_Order_Quantity,Unit_Of_Measure,QTY_10,PRICE_10,QTY_50,PRICE_50,QTY_100,PRICE_100
PROD-001,Widget A,10.50,USD,1,EA,10,9.50,50,8.75,100,8.00
PROD-002,Widget B,25.00,USD,5,BOX,10,23.00,50,21.00,100,19.50
PROD-003,Widget C,5.75,USD,1,EA,,,,,,
```

### JSON Template Format

```json
{
  "metadata": {
    "supplierName": "Sample Supplier Co.",
    "currency": "USD",
    "effectiveDate": "2024-01-15"
  },
  "items": [
    {
      "sku": "PROD-001",
      "description": "Widget A",
      "unitPrice": 10.50,
      "currency": "USD",
      "minimumOrderQuantity": 1,
      "unitOfMeasure": "EA",
      "tierPricing": [
        { "minQuantity": 10, "price": 9.50 },
        { "minQuantity": 50, "price": 8.75 }
      ]
    }
  ]
}
```

## Testing

### Run All Tests

```bash
npm test src/utils/file-parsers
```

### Run Specific Test Suites

```bash
# CSV parser tests
npm test src/utils/file-parsers/__tests__/csv-parser.test.js

# Validation tests
npm test src/utils/file-parsers/__tests__/validation.test.js

# Integration tests
npm test src/utils/file-parsers/__tests__/integration.test.js

# PDF parser tests
npm test src/utils/file-parsers/__tests__/pdf-parser.test.js
```

### Performance Testing

```bash
# Run performance benchmarks
npm run test:performance
```

## Error Handling

### Error Categories

1. **FORMAT** - File format or structure issues
2. **VALIDATION** - Data validation failures
3. **BUSINESS_RULE** - Business logic violations
4. **PERFORMANCE** - Performance-related warnings
5. **SYSTEM** - System or processing errors

### Error Severity Levels

1. **CRITICAL** - Prevents all processing
2. **ERROR** - Prevents successful completion
3. **WARNING** - Allows processing with caution
4. **INFO** - Informational messages
5. **BUSINESS_SUGGESTION** - Optimization suggestions

## Performance Metrics

The parsers provide detailed performance metrics:

```javascript
{
  totalProcessingTime: 1500,        // milliseconds
  itemsPerSecond: "133.33",         // processing rate
  averageChunkTime: 250,            // ms per chunk
  peakMemoryUsage: 134217728,       // bytes
  memoryEfficiency: "134",          // bytes per item
  totalChunks: 6,                   // number of chunks processed
  cacheHitRate: "25.5"              // validation cache hit rate
}
```

## Dependencies

### Required Dependencies
- `csv-parse` - CSV parsing
- `xlsx` - Excel file handling
- `fast-xml-parser` - XML parsing and building

### Optional Dependencies
- `pdf-parse` - PDF text extraction (for production PDF support)

### Development Dependencies
- `@jest/globals` - Testing framework
- `jest` - Test runner

## Migration from Legacy System

The parsers are designed to be compatible with the legacy price-list-processor.mjs:

1. **Same validation rules** for SKU, pricing, and currencies
2. **Compatible data structures** for seamless migration
3. **Enhanced error handling** with more detailed feedback
4. **Performance improvements** for large file processing
5. **Additional format support** beyond CSV

## Security Considerations

- **File size limits** prevent DoS attacks
- **Memory usage monitoring** prevents resource exhaustion
- **Input validation** prevents injection attacks
- **Error message sanitization** prevents information disclosure
- **Upload timeout limits** prevent hanging processes

## Contributing

When adding new parsers or features:

1. Follow the existing parser interface pattern
2. Add comprehensive tests including edge cases
3. Update this README with new features
4. Include performance benchmarks for large files
5. Add error handling and user-friendly messages

## License

This file parser module is part of the NXT NEW DAY project and follows the project's licensing terms.