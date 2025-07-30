# AI-Enhanced Document Parsers

Intelligent document parsing system for supplier price lists with machine learning capabilities.

## Features

### 🧠 Intelligent Parsing
- **AI-powered column mapping** - Automatically detects and maps columns using fuzzy matching
- **Learning system** - Improves accuracy over time by learning from successful parsings
- **Pattern recognition** - Identifies price list structures in various formats
- **Multi-format support** - PDF, Word (.doc/.docx), Email (.eml/.msg), Excel, CSV

### 📄 PDF Parser
- **OCR support** - Extracts text from scanned PDFs using Tesseract.js
- **Table detection** - Multiple pattern-based table extraction methods
- **Tier pricing** - Automatically detects and parses volume-based pricing
- **Metadata extraction** - Supplier info, dates, currency, etc.

### 📝 Word Parser
- **Native table extraction** - Parses tables from DOCX/DOC files
- **Format preservation** - Handles various Word formatting styles
- **Intelligent headers** - Automatic header detection and mapping
- **XML parsing** - Direct DOCX structure analysis

### 📧 Email Parser
- **Attachment processing** - Automatically extracts and parses attachments
- **Inline table detection** - Finds price tables in email body
- **Multi-format** - Supports .eml and .msg formats
- **Smart classification** - AI determines if email contains price lists

### 🎯 Column Mapping
- **Fuzzy matching** - Matches variations like "SKU", "Item #", "Product Code"
- **Learning system** - Remembers successful mappings for future use
- **Confidence scoring** - Provides confidence levels for mappings
- **Custom patterns** - Extensible pattern definitions

## Installation

```bash
npm install pdf-parse tesseract.js mammoth mailparser @kenjiuno/msgreader natural fuzzyset xml2js adm-zip
```

## Usage

### Basic Usage

```javascript
import { parseIntelligentDocument } from './ai-parsers';

// Parse any document with automatic detection
const result = await parseIntelligentDocument(fileBuffer, 'pricelist.pdf', {
  enableOCR: true,
  enableLearning: true
});

if (result.success) {
  console.log(`Parsed ${result.parsedCount} items`);
  console.log('Items:', result.data);
}
```

### Parse Specific File Types

```javascript
import { parseIntelligentPDF, parseIntelligentWord, parseIntelligentEmail } from './ai-parsers';

// PDF with OCR
const pdfResult = await parseIntelligentPDF(pdfBuffer, {
  enableOCR: true,
  ocrLanguage: 'eng',
  confidenceThreshold: 0.7
});

// Word document
const wordResult = await parseIntelligentWord(wordBuffer, '.docx', {
  extractTables: true
});

// Email with attachments
const emailResult = await parseIntelligentEmail(emailBuffer, '.eml', {
  processAttachments: true
});
```

### Batch Processing

```javascript
const orchestrator = new IntelligentParserOrchestrator({
  enableLearning: true,
  concurrentParsing: true
});

const files = [
  { buffer: file1Buffer, filename: 'supplier1.pdf' },
  { buffer: file2Buffer, filename: 'catalog.docx' },
  { buffer: file3Buffer, filename: 'quote.eml' }
];

const results = await orchestrator.parseMultiple(files);
```

## Configuration Options

### Common Options
- `enableLearning` - Enable AI learning from successful parsings
- `learnedMappingsPath` - Path to store learned column mappings
- `confidenceThreshold` - Minimum confidence for column mapping (0-1)

### PDF Options
- `enableOCR` - Enable OCR for scanned documents
- `ocrLanguage` - OCR language (default: 'eng')
- `extractionMethod` - 'text' or 'ocr'
- `tableDetection` - 'pattern' or 'position'

### Word Options
- `extractTables` - Extract tables from document
- `preserveFormatting` - Maintain original formatting
- `extractText` - Extract plain text content

### Email Options
- `processAttachments` - Parse email attachments
- `extractInlineTables` - Extract tables from email body

## Output Format

```javascript
{
  success: true,
  data: [
    {
      sku: "PROD-001",
      description: "Widget A",
      unitPrice: 10.50,
      currency: "USD",
      minimumOrderQuantity: 1,
      unitOfMeasure: "EA",
      tierPricing: [
        { minQuantity: 10, price: 9.50 },
        { minQuantity: 50, price: 8.75 }
      ]
    }
  ],
  errors: [],
  parsedCount: 25,
  metadata: {
    filename: "pricelist.pdf",
    fileType: "pdf",
    fileSize: 125000,
    parsedIn: 1250,
    supplierName: "ABC Supplier",
    effectiveDate: "2024-01-01",
    extractionMethod: "text",
    confidence: 0.95,
    tablesDetected: 2
  }
}
```

## AI Learning System

The parser includes a learning system that:

1. **Stores successful mappings** - Remembers column header variations
2. **Tracks parsing patterns** - Identifies successful extraction strategies
3. **Improves accuracy** - Gets better with more documents processed
4. **Shares knowledge** - Mappings work across all file types

### View Statistics

```javascript
const stats = orchestrator.getStatistics();
console.log(stats);
// {
//   totalParsings: 150,
//   successfulParsings: 142,
//   failedParsings: 8,
//   successRate: 94.67,
//   learnedMappings: 47,
//   fileTypeBreakdown: { pdf: 80, word: 40, email: 30 }
// }
```

## Error Handling

The parser provides detailed error information:

```javascript
{
  success: false,
  error: "Main error message",
  errors: [
    {
      row: 15,
      error: "Invalid price format",
      data: "Raw row data",
      table: 1  // For multi-table documents
    }
  ],
  parsedCount: 0
}
```

## Performance

- **Concurrent parsing** - Process multiple files in parallel
- **Efficient memory usage** - Streaming for large files
- **Caching** - Learned mappings cached for speed
- **Optimized patterns** - Fast regex matching

## Extending the Parser

### Add Custom Column Patterns

```javascript
parser.columnMapper.fuzzyMatchers.customField = FuzzySet([
  'custom name',
  'alternate name',
  'another variation'
]);
```

### Train Custom Mappings

```javascript
parser.columnMapper.learnMapping('Vendor SKU', 'sku');
parser.columnMapper.learnMapping('List Price', 'price');
await parser.columnMapper.saveMappings('./custom-mappings.json');
```

## Best Practices

1. **Enable learning** - The parser improves with use
2. **Review errors** - Check error details for data quality issues
3. **Validate results** - Verify extracted data accuracy
4. **Use appropriate options** - Enable OCR only when needed
5. **Batch similar files** - Process similar documents together
6. **Monitor confidence** - Low confidence may need manual review

## Troubleshooting

### Low extraction rates
- Enable OCR for scanned documents
- Check confidence thresholds
- Review error logs for patterns

### Incorrect mappings
- Train custom mappings for your data
- Adjust confidence threshold
- Check column pattern definitions

### Performance issues
- Disable OCR for text-based PDFs
- Use batch processing
- Adjust concurrent parsing limits