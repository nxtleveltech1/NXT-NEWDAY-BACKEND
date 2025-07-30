import { simpleParser } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import { parseCSV } from './csv-parser.js';
import { parseExcel } from './excel-parser.js';
import { parsePDF } from './pdf-parser.js';
import { parseWord } from './word-parser.js';
import { parseJSON } from './json-parser.js';
import { parseXML } from './xml-parser.js';

// Supported email formats
const EMAIL_FORMATS = {
  '.eml': 'eml',
  '.msg': 'msg',
  '.mhtml': 'mhtml',
  '.emlx': 'emlx'
};

// Parse email file and extract price list data
export async function parseEmail(fileBuffer, options = {}) {
  const {
    filename = 'email.eml',
    processAttachments = true,
    extractFromBody = true,
    intelligentDetection = true
  } = options;

  try {
    // Detect email format
    const format = detectEmailFormat(filename, fileBuffer);
    
    let emailData;
    
    switch (format) {
      case 'msg':
        emailData = await parseMsgEmail(fileBuffer);
        break;
      case 'eml':
      case 'emlx':
      case 'mhtml':
      default:
        emailData = await parseEmlEmail(fileBuffer);
        break;
    }

    const results = {
      success: true,
      data: [],
      errors: [],
      parsedCount: 0,
      metadata: {
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        date: emailData.date,
        attachmentCount: emailData.attachments.length
      },
      attachments: [],
      bodyData: []
    };

    // Process attachments
    if (processAttachments && emailData.attachments.length > 0) {
      for (const attachment of emailData.attachments) {
        const attachmentResult = await processAttachment(attachment, options);
        if (attachmentResult.success) {
          results.data.push(...attachmentResult.data);
          results.attachments.push({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            parsedCount: attachmentResult.parsedCount
          });
        } else {
          results.errors.push({
            attachment: attachment.filename,
            error: attachmentResult.error
          });
        }
      }
    }

    // Extract price data from email body
    if (extractFromBody) {
      const bodyResult = await extractPriceDataFromBody(
        emailData.textContent || emailData.htmlContent, 
        options
      );
      if (bodyResult.items.length > 0) {
        results.data.push(...bodyResult.items);
        results.bodyData = bodyResult.items;
      }
      if (bodyResult.errors.length > 0) {
        results.errors.push(...bodyResult.errors);
      }
    }

    // Intelligent detection for supplier information
    if (intelligentDetection) {
      const supplierInfo = extractSupplierInfo(emailData);
      results.metadata = { ...results.metadata, ...supplierInfo };
    }

    results.parsedCount = results.data.length;
    results.success = results.parsedCount > 0 || results.errors.length === 0;

    return results;
  } catch (error) {
    return {
      success: false,
      error: 'Email parsing failed: ' + error.message,
      errors: [{
        error: error.message,
        type: 'parsing_error'
      }],
      parsedCount: 0
    };
  }
}

// Parse EML format email
async function parseEmlEmail(fileBuffer) {
  const parsed = await simpleParser(fileBuffer);
  
  return {
    from: parsed.from?.text,
    to: Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to?.text,
    subject: parsed.subject,
    date: parsed.date,
    textContent: parsed.text,
    htmlContent: parsed.html,
    attachments: (parsed.attachments || []).map(att => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      content: att.content
    }))
  };
}

// Parse MSG format email (Outlook)
async function parseMsgEmail(fileBuffer) {
  const msgReader = new MsgReader(fileBuffer);
  const fileData = msgReader.getFileData();
  
  return {
    from: fileData.senderEmail || fileData.senderName,
    to: fileData.recipients?.map(r => r.email || r.name).join(', '),
    subject: fileData.subject,
    date: fileData.messageDeliveryTime || fileData.clientSubmitTime,
    textContent: fileData.body,
    htmlContent: fileData.bodyHTML,
    attachments: (fileData.attachments || []).map(att => ({
      filename: att.fileName,
      contentType: att.mimeType || 'application/octet-stream',
      size: att.contentLength,
      content: att.content
    }))
  };
}

// Process email attachment
async function processAttachment(attachment, options) {
  const { filename, content } = attachment;
  
  if (!filename || !content) {
    return {
      success: false,
      error: 'Invalid attachment'
    };
  }

  const extension = filename.toLowerCase().split('.').pop();
  
  try {
    switch (extension) {
      case 'csv':
        return await parseCSV(content, options);
      
      case 'xlsx':
      case 'xls':
        return await parseExcel(content, options);
      
      case 'json':
        return await parseJSON(content, options);
      
      case 'xml':
        return await parseXML(content, options);
      
      case 'pdf':
        return await parsePDF(content, options);
      
      case 'docx':
      case 'doc':
        return await parseWord(content, options);
      
      default:
        return {
          success: false,
          error: `Unsupported attachment format: ${extension}`
        };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to process attachment ${filename}: ${error.message}`
    };
  }
}

// Extract price data from email body
async function extractPriceDataFromBody(content, options = {}) {
  const items = [];
  const errors = [];
  
  if (!content) {
    return { items, errors };
  }

  // Remove HTML tags if present
  const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  // Split into lines
  const lines = plainText.split(/[\r\n]+/).map(line => line.trim()).filter(line => line);
  
  // Patterns for common price list formats in emails
  const patterns = {
    // Pattern: SKU: ABC123 Price: $10.50 MOQ: 10
    inline: /(?:SKU|Item|Product)\s*[:#]?\s*([A-Z0-9\-]+).*?(?:Price|Cost)\s*[:#]?\s*\$?([\d,]+\.?\d*).*?(?:MOQ|Min[.\s]*Qty)?\s*[:#]?\s*(\d+)?/i,
    
    // Pattern: ABC123 | Widget A | $10.50 | 10 units
    tabular: /^([A-Z0-9\-]+)\s*[|\t]\s*(.+?)\s*[|\t]\s*\$?([\d,]+\.?\d*)\s*[|\t]?\s*(\d+)?\s*(?:units?|pcs?|ea)?$/i,
    
    // Pattern: Widget A (ABC123): $10.50 per unit
    descriptive: /(.+?)\s*\(([A-Z0-9\-]+)\)\s*:\s*\$?([\d,]+\.?\d*)\s*(?:per|\/)\s*(\w+)/i,
    
    // Pattern for bulk listings
    bulk: /^([A-Z0-9\-]+)\s+\$?([\d,]+\.?\d*)$/
  };

  let inPriceSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect price list sections
    if (/price\s*list|product\s*pricing|catalog|quotation/i.test(line)) {
      inPriceSection = true;
      continue;
    }
    
    // Skip signature and footer sections
    if (/regards|sincerely|thank\s*you|unsubscribe|confidential/i.test(line)) {
      inPriceSection = false;
      continue;
    }
    
    if (!inPriceSection && !options.parseFullEmail) {
      continue;
    }
    
    // Try each pattern
    let matched = false;
    
    // Inline pattern
    let match = line.match(patterns.inline);
    if (match) {
      const [, sku, price, moq] = match;
      items.push({
        sku: sku.trim(),
        description: '',
        unitPrice: parseFloat(price.replace(/,/g, '')),
        currency: 'USD',
        minimumOrderQuantity: moq ? parseInt(moq) : 1,
        unitOfMeasure: 'EA'
      });
      matched = true;
    }
    
    // Tabular pattern
    if (!matched) {
      match = line.match(patterns.tabular);
      if (match) {
        const [, sku, description, price, qty] = match;
        items.push({
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(price.replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: qty ? parseInt(qty) : 1,
          unitOfMeasure: 'EA'
        });
        matched = true;
      }
    }
    
    // Descriptive pattern
    if (!matched) {
      match = line.match(patterns.descriptive);
      if (match) {
        const [, description, sku, price, unit] = match;
        items.push({
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(price.replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: 1,
          unitOfMeasure: unit?.toUpperCase() || 'EA'
        });
        matched = true;
      }
    }
    
    // Bulk pattern (requires description from context)
    if (!matched && inPriceSection) {
      match = line.match(patterns.bulk);
      if (match) {
        const [, sku, price] = match;
        // Look for description in previous or next line
        const prevLine = i > 0 ? lines[i - 1] : '';
        const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
        
        let description = '';
        if (prevLine && !patterns.bulk.test(prevLine)) {
          description = prevLine;
        } else if (nextLine && !patterns.bulk.test(nextLine)) {
          description = nextLine;
        }
        
        items.push({
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(price.replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: 1,
          unitOfMeasure: 'EA'
        });
        matched = true;
      }
    }
  }
  
  // Look for HTML tables if no text data found
  if (items.length === 0 && content.includes('<table')) {
    const tableResult = parseHtmlTables(content);
    items.push(...tableResult.items);
    errors.push(...tableResult.errors);
  }
  
  return { items, errors };
}

// Parse HTML tables from email body
function parseHtmlTables(htmlContent) {
  const items = [];
  const errors = [];
  
  // Extract tables
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tables = htmlContent.match(tableRegex) || [];
  
  for (const table of tables) {
    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = table.match(rowRegex) || [];
    
    if (rows.length < 2) continue; // Need at least header and one data row
    
    // Extract headers from first row
    const headerCells = rows[0].match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
    const headers = headerCells.map(cell => 
      cell.replace(/<[^>]*>/g, '').trim().toLowerCase()
    );
    
    // Find column indices
    const skuIndex = headers.findIndex(h => /sku|item|product|code/.test(h));
    const priceIndex = headers.findIndex(h => /price|cost/.test(h));
    
    if (skuIndex === -1 || priceIndex === -1) continue;
    
    const descIndex = headers.findIndex(h => /desc|name/.test(h));
    const qtyIndex = headers.findIndex(h => /qty|quantity|moq/.test(h));
    
    // Parse data rows
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
      const values = cells.map(cell => cell.replace(/<[^>]*>/g, '').trim());
      
      if (values.length <= Math.max(skuIndex, priceIndex)) continue;
      
      const sku = values[skuIndex];
      const priceText = values[priceIndex];
      const priceMatch = priceText.match(/[\d,]+\.?\d*/);
      
      if (sku && priceMatch) {
        items.push({
          sku: sku,
          description: descIndex !== -1 ? values[descIndex] : '',
          unitPrice: parseFloat(priceMatch[0].replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: qtyIndex !== -1 && values[qtyIndex] ? 
            parseInt(values[qtyIndex]) || 1 : 1,
          unitOfMeasure: 'EA'
        });
      }
    }
  }
  
  return { items, errors };
}

// Extract supplier information from email
function extractSupplierInfo(emailData) {
  const info = {};
  
  // Extract from sender
  if (emailData.from) {
    info.supplierEmail = emailData.from;
    
    // Try to extract company name from email domain
    const domainMatch = emailData.from.match(/@([^.]+)/);
    if (domainMatch) {
      info.supplierDomain = domainMatch[1];
    }
  }
  
  // Extract from subject
  if (emailData.subject) {
    // Common patterns in price list emails
    const subjectPatterns = [
      /price\s*list.*?from\s+(.+?)(?:\s|$)/i,
      /(.+?)\s*price\s*list/i,
      /quotation\s*from\s+(.+?)(?:\s|$)/i,
      /(.+?)\s*product\s*catalog/i
    ];
    
    for (const pattern of subjectPatterns) {
      const match = emailData.subject.match(pattern);
      if (match) {
        info.supplierName = match[1].trim();
        break;
      }
    }
  }
  
  // Extract from body
  const content = emailData.textContent || emailData.htmlContent || '';
  const bodyPatterns = [
    /(?:company|supplier|vendor):\s*(.+?)(?:\n|<br|$)/i,
    /(?:from|regards|sincerely),?\s*(.+?)(?:\n|<br|$)/i
  ];
  
  for (const pattern of bodyPatterns) {
    const match = content.match(pattern);
    if (match && !info.supplierName) {
      info.supplierName = match[1].trim();
      break;
    }
  }
  
  return info;
}

// Detect email format from file
function detectEmailFormat(filename, buffer) {
  const extension = filename.toLowerCase().split('.').pop();
  
  if (EMAIL_FORMATS[`.${extension}`]) {
    return EMAIL_FORMATS[`.${extension}`];
  }
  
  // Try to detect from content
  const headerBytes = buffer.slice(0, 100).toString('utf-8');
  
  if (headerBytes.includes('From:') || headerBytes.includes('Subject:')) {
    return 'eml';
  }
  
  // MSG files have specific magic bytes
  const msgSignature = buffer.slice(0, 8);
  if (msgSignature.equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) {
    return 'msg';
  }
  
  return 'eml'; // Default
}

// Validate email structure
export async function validateEmailStructure(fileBuffer, options = {}) {
  try {
    const format = detectEmailFormat(options.filename || 'email.eml', fileBuffer);
    
    let emailData;
    try {
      if (format === 'msg') {
        emailData = await parseMsgEmail(fileBuffer);
      } else {
        emailData = await parseEmlEmail(fileBuffer);
      }
    } catch (error) {
      return {
        valid: false,
        error: 'Invalid email format: ' + error.message
      };
    }
    
    const validation = {
      valid: true,
      warnings: [],
      emailInfo: {
        from: emailData.from,
        subject: emailData.subject,
        date: emailData.date,
        hasAttachments: emailData.attachments.length > 0,
        attachmentCount: emailData.attachments.length,
        hasTextContent: !!emailData.textContent,
        hasHtmlContent: !!emailData.htmlContent
      }
    };
    
    // Check for price list indicators
    const content = (emailData.textContent || emailData.htmlContent || '').toLowerCase();
    const subject = (emailData.subject || '').toLowerCase();
    
    const hasPriceIndicators = /price|cost|quotation|catalog/.test(content) || 
                              /price|cost|quotation|catalog/.test(subject);
    
    if (!hasPriceIndicators && emailData.attachments.length === 0) {
      validation.warnings.push('No price-related content detected and no attachments found');
    }
    
    // Check attachments
    if (emailData.attachments.length > 0) {
      validation.emailInfo.attachments = emailData.attachments.map(att => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        isPriceListFormat: /\.(csv|xlsx?|json|xml|pdf|docx?)$/i.test(att.filename)
      }));
      
      const hasPriceListAttachment = validation.emailInfo.attachments.some(att => att.isPriceListFormat);
      if (!hasPriceListAttachment) {
        validation.warnings.push('No attachments with recognized price list formats found');
      }
    }
    
    return validation;
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate email: ' + error.message
    };
  }
}

// Generate email template
export function generateEmailTemplate() {
  return `
Email Price List Template Instructions:

1. Email Subject Line:
   "Price List - [Your Company Name] - ${new Date().toISOString().split('T')[0]}"
   or
   "[Company] Product Catalog and Pricing"

2. Email Body Format Options:

   Option A - Inline Table:
   ---
   Dear Customer,
   
   Please find our current price list below:
   
   SKU     | Description  | Price  | MOQ | UOM
   --------|--------------|--------|-----|----
   PROD-001| Widget A     | $10.50 | 1   | EA
   PROD-002| Widget B     | $25.00 | 5   | BOX
   PROD-003| Widget C     | $5.75  | 1   | EA
   
   Tier Pricing Available:
   PROD-001: 10+ units = $9.50, 50+ = $8.75
   PROD-002: 10+ units = $23.00, 50+ = $21.00
   
   Best regards,
   [Your Name]
   ---

   Option B - Structured List:
   ---
   Price List Update:
   
   • SKU: PROD-001
     Description: Widget A
     Price: $10.50 per unit
     MOQ: 1 EA
   
   • SKU: PROD-002
     Description: Widget B
     Price: $25.00 per box
     MOQ: 5 BOX
   ---

3. With Attachments:
   "Please find attached our complete price list in [CSV/Excel] format."
   
   Attach files in these formats:
   - CSV (.csv)
   - Excel (.xlsx)
   - PDF (.pdf)
   - JSON (.json)
   - Word (.docx)

4. Best Practices:
   - Use clear, consistent formatting
   - Include supplier company name
   - Specify currency (USD, EUR, etc.)
   - Add effective date
   - Keep SKUs in standard format
   - Use attachments for large lists (>20 items)

5. Email Metadata to Include:
   - From: pricing@yourcompany.com
   - Subject: Include "Price List" or "Product Catalog"
   - Date: Current date
   - Attachments: Named clearly (e.g., "PriceList_2024_01.xlsx")
`;
}