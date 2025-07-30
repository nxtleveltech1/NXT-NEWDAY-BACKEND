import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { parseEmail, validateEmailStructure, extractAttachments, parseEmailPriceList } from '../email-parser.js';
import { simpleParser } from 'mailparser';

// Mock mailparser
jest.mock('mailparser', () => ({
  simpleParser: jest.fn()
}));

describe('Email Parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseEmail', () => {
    test('should parse email with price list in body', async () => {
      const mockParsedEmail = {
        subject: 'Price List Update - January 2024',
        from: {
          text: 'supplier@example.com',
          value: [{ address: 'supplier@example.com', name: 'Supplier Inc' }]
        },
        text: `
          Dear Customer,
          
          Please find our updated price list below:
          
          SKU: PROD001
          Description: Product 1
          Price: $10.99 USD
          MOQ: 10 units
          
          SKU: PROD002
          Description: Product 2
          Price: $25.50 USD
          MOQ: 5 units
          
          Best regards,
          Supplier Team
        `,
        html: null,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const buffer = Buffer.from('mock email data');
      const result = await parseEmail(buffer);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        sku: 'PROD001',
        description: 'Product 1',
        unitPrice: 10.99,
        currency: 'USD',
        minimumOrderQuantity: 10,
        unitOfMeasure: 'units'
      });
      expect(result.metadata.source).toBe('supplier@example.com');
    });

    test('should parse email with HTML table price list', async () => {
      const mockParsedEmail = {
        subject: 'Price List',
        from: { text: 'supplier@example.com' },
        text: 'See HTML version',
        html: `
          <html>
            <body>
              <h2>Price List</h2>
              <table>
                <tr>
                  <th>SKU</th>
                  <th>Description</th>
                  <th>Unit Price</th>
                  <th>Currency</th>
                </tr>
                <tr>
                  <td>PROD001</td>
                  <td>Product 1</td>
                  <td>10.99</td>
                  <td>USD</td>
                </tr>
                <tr>
                  <td>PROD002</td>
                  <td>Product 2</td>
                  <td>25.50</td>
                  <td>EUR</td>
                </tr>
              </table>
            </body>
          </html>
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[1].currency).toBe('EUR');
    });

    test('should handle email with CSV attachment', async () => {
      const csvContent = `SKU,Description,Unit Price,Currency
PROD001,Product 1,10.99,USD
PROD002,Product 2,25.50,USD`;

      const mockParsedEmail = {
        subject: 'Price List Attached',
        from: { text: 'supplier@example.com' },
        text: 'Please find the price list attached.',
        attachments: [{
          filename: 'price_list.csv',
          contentType: 'text/csv',
          content: Buffer.from(csvContent)
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].filename).toBe('price_list.csv');
      expect(result.attachments[0].parsed).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    test('should handle email with Excel attachment', async () => {
      const mockParsedEmail = {
        subject: 'Price List Excel',
        from: { text: 'supplier@example.com' },
        text: 'Price list in Excel format',
        attachments: [{
          filename: 'prices.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: Buffer.from('mock excel data')
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].type).toBe('EXCEL');
      expect(result.requiresProcessing).toBe(true);
    });

    test('should handle multiple attachments', async () => {
      const mockParsedEmail = {
        subject: 'Multiple Price Lists',
        from: { text: 'supplier@example.com' },
        text: 'Various price lists attached',
        attachments: [
          {
            filename: 'electronics.csv',
            contentType: 'text/csv',
            content: Buffer.from('SKU,Price\nELEC001,99.99')
          },
          {
            filename: 'furniture.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('mock pdf')
          },
          {
            filename: 'logo.png',
            contentType: 'image/png',
            content: Buffer.from('mock image')
          }
        ]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.attachments).toHaveLength(2); // Only processable files
      expect(result.attachments[0].filename).toBe('electronics.csv');
      expect(result.attachments[1].filename).toBe('furniture.pdf');
      expect(result.ignoredAttachments).toHaveLength(1);
    });

    test('should extract price list from structured text', async () => {
      const mockParsedEmail = {
        subject: 'Price Update',
        from: { text: 'supplier@example.com' },
        text: `
          Product Catalog
          ==============
          
          Item #1
          - Code: PROD001
          - Name: Premium Widget
          - Cost: 10.99
          - Currency: USD
          - Min Order: 10
          
          Item #2
          - Code: PROD002
          - Name: Standard Widget
          - Cost: 5.99
          - Currency: USD
          - Min Order: 25
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].description).toBe('Premium Widget');
      expect(result.data[1].minimumOrderQuantity).toBe(25);
    });

    test('should handle malformed email', async () => {
      simpleParser.mockRejectedValue(new Error('Invalid email format'));

      const result = await parseEmail(Buffer.from('malformed'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse email');
    });

    test('should handle email with no price data', async () => {
      const mockParsedEmail = {
        subject: 'General Inquiry',
        from: { text: 'customer@example.com' },
        text: 'Can you send me your price list?',
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(false);
      expect(result.error).toBe('No price list data found in email');
    });

    test('should handle forwarded emails', async () => {
      const mockParsedEmail = {
        subject: 'Fwd: Price List',
        from: { text: 'middleman@example.com' },
        text: `
          ---------- Forwarded message ---------
          From: supplier@example.com
          Date: Mon, Jan 1, 2024
          Subject: Price List
          
          SKU: PROD001
          Price: $10.99
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.metadata.originalSender).toBe('supplier@example.com');
    });

    test('should extract tier pricing from email', async () => {
      const mockParsedEmail = {
        subject: 'Volume Pricing',
        from: { text: 'supplier@example.com' },
        text: `
          SKU: PROD001
          Base Price: $10.99
          
          Volume Discounts:
          - 100+ units: $9.99
          - 500+ units: $8.99
          - 1000+ units: $7.99
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].tierPricing).toHaveLength(3);
      expect(result.data[0].tierPricing[0]).toEqual({
        minQuantity: 100,
        unitPrice: 9.99
      });
    });
  });

  describe('validateEmailStructure', () => {
    test('should validate email with valid price data', async () => {
      const mockParsedEmail = {
        subject: 'Price List',
        from: { text: 'supplier@example.com' },
        text: 'SKU: PROD001\nPrice: $10.99',
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await validateEmailStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.hasPriceData).toBe(true);
      expect(result.source).toBe('body');
    });

    test('should detect price data in attachments', async () => {
      const mockParsedEmail = {
        subject: 'Price List',
        from: { text: 'supplier@example.com' },
        text: 'See attached',
        attachments: [{
          filename: 'prices.csv',
          contentType: 'text/csv'
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await validateEmailStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.hasPriceData).toBe(true);
      expect(result.source).toBe('attachment');
      expect(result.attachmentTypes).toContain('CSV');
    });

    test('should warn about non-price attachments', async () => {
      const mockParsedEmail = {
        subject: 'Contract',
        from: { text: 'supplier@example.com' },
        text: 'Please review',
        attachments: [{
          filename: 'contract.pdf',
          contentType: 'application/pdf'
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await validateEmailStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('PDF attachment may require manual review');
    });
  });

  describe('extractAttachments', () => {
    test('should extract and categorize attachments', async () => {
      const mockParsedEmail = {
        attachments: [
          {
            filename: 'prices.csv',
            contentType: 'text/csv',
            content: Buffer.from('csv data'),
            size: 1024
          },
          {
            filename: 'catalog.xlsx',
            contentType: 'application/vnd.ms-excel',
            content: Buffer.from('excel data'),
            size: 2048
          },
          {
            filename: 'terms.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('pdf data'),
            size: 4096
          }
        ]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const attachments = await extractAttachments(Buffer.from('mock'));

      expect(attachments.processable).toHaveLength(3);
      expect(attachments.processable[0].type).toBe('CSV');
      expect(attachments.processable[1].type).toBe('EXCEL');
      expect(attachments.processable[2].type).toBe('PDF');
      expect(attachments.totalSize).toBe(7168);
    });

    test('should filter non-processable attachments', async () => {
      const mockParsedEmail = {
        attachments: [
          {
            filename: 'logo.png',
            contentType: 'image/png',
            content: Buffer.from('image')
          },
          {
            filename: 'signature.jpg',
            contentType: 'image/jpeg',
            content: Buffer.from('image')
          },
          {
            filename: 'prices.csv',
            contentType: 'text/csv',
            content: Buffer.from('csv')
          }
        ]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const attachments = await extractAttachments(Buffer.from('mock'));

      expect(attachments.processable).toHaveLength(1);
      expect(attachments.ignored).toHaveLength(2);
      expect(attachments.processable[0].filename).toBe('prices.csv');
    });

    test('should handle attachments with size limits', async () => {
      const largeContent = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const mockParsedEmail = {
        attachments: [
          {
            filename: 'huge.csv',
            contentType: 'text/csv',
            content: largeContent,
            size: largeContent.length
          }
        ]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const attachments = await extractAttachments(Buffer.from('mock'), {
        maxSize: 10 * 1024 * 1024 // 10MB limit
      });

      expect(attachments.processable).toHaveLength(0);
      expect(attachments.errors).toHaveLength(1);
      expect(attachments.errors[0]).toContain('exceeds size limit');
    });
  });

  describe('parseEmailPriceList', () => {
    test('should parse price list with custom patterns', async () => {
      const mockParsedEmail = {
        subject: 'Pricing',
        from: { text: 'supplier@example.com' },
        text: `
          Product ID: ABC123 | Product: Widget A | Price: 10.99 | MOQ: 10
          Product ID: DEF456 | Product: Widget B | Price: 25.50 | MOQ: 5
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmailPriceList(Buffer.from('mock'), {
        patterns: {
          sku: /Product ID:\s*(\w+)/,
          description: /Product:\s*([^|]+)/,
          price: /Price:\s*([\d.]+)/,
          moq: /MOQ:\s*(\d+)/
        }
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].sku).toBe('ABC123');
      expect(result.data[0].description).toBe('Widget A');
    });

    test('should handle emails with signatures and disclaimers', async () => {
      const mockParsedEmail = {
        subject: 'Price List',
        from: { text: 'supplier@example.com' },
        text: `
          Hi,
          
          Here's our price list:
          
          SKU: PROD001
          Price: $10.99
          
          Best regards,
          John Doe
          Sales Manager
          
          --
          This email is confidential...
          Legal disclaimer text...
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmailPriceList(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].sku).toBe('PROD001');
      // Should not include signature/disclaimer in parsed data
    });
  });

  describe('Email format edge cases', () => {
    test('should handle emails with inline images', async () => {
      const mockParsedEmail = {
        subject: 'Price List with Images',
        from: { text: 'supplier@example.com' },
        html: `
          <img src="cid:logo">
          <table>
            <tr><td>SKU</td><td>Price</td></tr>
            <tr><td>PROD001</td><td>10.99</td></tr>
          </table>
        `,
        attachments: [{
          filename: 'logo.png',
          contentType: 'image/png',
          cid: 'logo',
          content: Buffer.from('image')
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.attachments).toHaveLength(0); // Inline images not counted
    });

    test('should handle encrypted attachments', async () => {
      const mockParsedEmail = {
        subject: 'Encrypted Price List',
        from: { text: 'supplier@example.com' },
        text: 'Password: 12345',
        attachments: [{
          filename: 'prices.zip',
          contentType: 'application/zip',
          content: Buffer.from('encrypted zip')
        }]
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.requiresManualProcessing).toBe(true);
      expect(result.warnings).toContain('Encrypted/compressed attachment detected');
    });

    test('should handle reply chains', async () => {
      const mockParsedEmail = {
        subject: 'Re: Re: Price Request',
        from: { text: 'supplier@example.com' },
        text: `
          Sure, here are the prices:
          
          SKU: PROD001
          Price: $10.99
          
          On Mon, Jan 1, 2024 at 10:00 AM customer@example.com wrote:
          > Can you send prices for PROD001?
          > 
          > On Sun, Dec 31, 2023 at 5:00 PM supplier@example.com wrote:
          >> What products do you need pricing for?
        `,
        attachments: []
      };

      simpleParser.mockResolvedValue(mockParsedEmail);

      const result = await parseEmail(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.metadata.isReply).toBe(true);
    });
  });
});