// AI-Enhanced Parser Suite
// Export all intelligent parsers for supplier price list processing

export { IntelligentPDFParser, parseIntelligentPDF } from './intelligent-pdf-parser.js';
export { IntelligentWordParser, parseIntelligentWord } from './intelligent-word-parser.js';
export { IntelligentEmailParser, parseIntelligentEmail } from './intelligent-email-parser.js';
export { 
  IntelligentParserOrchestrator, 
  parseIntelligentDocument 
} from './intelligent-parser-orchestrator.js';

// Quick usage examples:
/*
// Parse any document intelligently
import { parseIntelligentDocument } from './ai-parsers';

const result = await parseIntelligentDocument(fileBuffer, 'pricelist.pdf', {
  enableOCR: true,
  enableLearning: true
});

// Parse specific file types
import { parseIntelligentPDF, parseIntelligentWord, parseIntelligentEmail } from './ai-parsers';

// PDF with OCR
const pdfResult = await parseIntelligentPDF(pdfBuffer, {
  enableOCR: true,
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
*/