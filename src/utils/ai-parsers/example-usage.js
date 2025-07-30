// Example usage of AI-Enhanced Parsers
// Demonstrates how to use the intelligent document parsing system

import { parseIntelligentDocument } from './index.js';
import { readFileSync } from 'fs';

// Example 1: Parse any document with automatic detection
async function parseAnyDocument() {
  try {
    // Read file
    const fileBuffer = readFileSync('./samples/supplier-pricelist.pdf');
    
    // Parse with AI enhancements
    const result = await parseIntelligentDocument(fileBuffer, 'supplier-pricelist.pdf', {
      enableOCR: true,           // Enable OCR for scanned PDFs
      enableLearning: true,      // Enable AI learning from successful parsings
      confidenceThreshold: 0.7,  // Minimum confidence for column mapping
    });

    if (result.success) {
      console.log(`Successfully parsed ${result.parsedCount} items`);
      console.log('Sample item:', result.data[0]);
      console.log('Metadata:', result.metadata);
      
      // Check if tier pricing was detected
      const itemsWithTiers = result.data.filter(item => item.tierPricing?.length > 0);
      console.log(`Items with tier pricing: ${itemsWithTiers.length}`);
    } else {
      console.error('Parsing failed:', result.error);
      console.error('Errors:', result.errors);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 2: Parse email with attachments
async function parseEmailWithAttachments() {
  try {
    const emailBuffer = readFileSync('./samples/price-quote-email.eml');
    
    const result = await parseIntelligentDocument(emailBuffer, 'price-quote-email.eml', {
      processAttachments: true,
      extractInlineTables: true,
    });

    if (result.success) {
      console.log('Email metadata:', result.metadata);
      console.log(`Attachments processed: ${result.attachmentsProcessed}`);
      console.log(`Total items extracted: ${result.parsedCount}`);
      
      // Group items by source
      const itemsBySource = {};
      result.data.forEach(item => {
        const source = item.source || 'inline';
        itemsBySource[source] = (itemsBySource[source] || 0) + 1;
      });
      console.log('Items by source:', itemsBySource);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 3: Parse Word document with complex tables
async function parseWordDocument() {
  try {
    const wordBuffer = readFileSync('./samples/product-catalog.docx');
    
    const result = await parseIntelligentDocument(wordBuffer, 'product-catalog.docx', {
      extractTables: true,
      preserveFormatting: false,
    });

    if (result.success) {
      console.log(`Tables found: ${result.tablesFound}`);
      console.log(`Price tables identified: ${result.priceTablesIdentified}`);
      console.log(`Items extracted: ${result.parsedCount}`);
      
      // Show column mapping confidence
      if (result.columnMappings) {
        console.log('Column mapping confidence:', result.mappingConfidence);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 4: Batch processing multiple files
async function batchProcessFiles() {
  try {
    const files = [
      { buffer: readFileSync('./samples/supplier1.pdf'), filename: 'supplier1.pdf' },
      { buffer: readFileSync('./samples/supplier2.docx'), filename: 'supplier2.docx' },
      { buffer: readFileSync('./samples/quote.eml'), filename: 'quote.eml' },
    ];

    const orchestrator = new IntelligentParserOrchestrator({
      enableLearning: true,
      concurrentParsing: true,
    });

    await orchestrator.initialize();
    const results = await orchestrator.parseMultiple(files);

    // Summarize results
    results.forEach((result, index) => {
      console.log(`\nFile ${index + 1}: ${files[index].filename}`);
      console.log(`Success: ${result.success}`);
      console.log(`Items parsed: ${result.parsedCount}`);
      console.log(`Parser used: ${result.metadata?.parser}`);
      console.log(`Time taken: ${result.metadata?.parsedIn}ms`);
    });

    // Show learning statistics
    const stats = orchestrator.getStatistics();
    console.log('\nLearning Statistics:', stats);

    await orchestrator.cleanup();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 5: Using specific parsers directly
async function useSpecificParsers() {
  // PDF with OCR
  const pdfResult = await parseIntelligentPDF(pdfBuffer, {
    enableOCR: true,
    ocrLanguage: 'eng',
    confidenceThreshold: 0.8,
  });

  // Word document
  const wordResult = await parseIntelligentWord(wordBuffer, '.docx', {
    extractTables: true,
    learnedMappingsPath: './custom-mappings.json',
  });

  // Email
  const emailResult = await parseIntelligentEmail(emailBuffer, '.eml', {
    processAttachments: true,
    extractInlineTables: true,
  });
}

// Example 6: Custom column mapping and learning
async function customColumnMapping() {
  const parser = new IntelligentPDFParser({
    learnedMappingsPath: './my-custom-mappings.json',
  });

  // Train the parser with known mappings
  parser.columnMapper.learnMapping('Product Code', 'sku');
  parser.columnMapper.learnMapping('Unit Cost', 'price');
  parser.columnMapper.learnMapping('Min Order', 'quantity');

  // Parse document
  const result = await parser.parse(fileBuffer);
  
  // Save learned mappings for future use
  await parser.columnMapper.saveMappings('./my-custom-mappings.json');
}

// Run examples
console.log('AI-Enhanced Parser Examples');
console.log('===========================\n');

// Uncomment to run examples:
// await parseAnyDocument();
// await parseEmailWithAttachments();
// await parseWordDocument();
// await batchProcessFiles();
// await customColumnMapping();