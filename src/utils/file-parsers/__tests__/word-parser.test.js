import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { parseWord, validateWordStructure, extractTablesFromWord } from '../word-parser.js';
import mammoth from 'mammoth';

// Mock mammoth library
jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
  convertToHtml: jest.fn()
}));

describe('Word Parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseWord', () => {
    test('should parse Word document with table data', async () => {
      const mockHtml = `
        <html>
          <body>
            <table>
              <tr>
                <td>SKU</td>
                <td>Description</td>
                <td>Unit Price</td>
                <td>Currency</td>
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
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const buffer = Buffer.from('mock word data');
      const result = await parseWord(buffer);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        sku: 'PROD001',
        description: 'Product 1',
        unitPrice: 10.99,
        currency: 'USD'
      });
    });

    test('should handle multiple tables in document', async () => {
      const mockHtml = `
        <html>
          <body>
            <h1>Price List</h1>
            <table>
              <tr>
                <td>SKU</td>
                <td>Description</td>
                <td>Unit Price</td>
              </tr>
              <tr>
                <td>PROD001</td>
                <td>Product 1</td>
                <td>10.99</td>
              </tr>
            </table>
            <h2>Tier Pricing</h2>
            <table>
              <tr>
                <td>SKU</td>
                <td>Min Quantity</td>
                <td>Price</td>
              </tr>
              <tr>
                <td>PROD001</td>
                <td>100</td>
                <td>9.99</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].tierPricing).toHaveLength(1);
      expect(result.data[0].tierPricing[0]).toEqual({
        minQuantity: 100,
        unitPrice: 9.99
      });
    });

    test('should handle text-based price lists', async () => {
      const mockText = `
        PRICE LIST

        SKU: PROD001
        Description: Product 1
        Price: $10.99
        Currency: USD
        Min Order: 10 units

        SKU: PROD002
        Description: Product 2
        Price: €25.50
        Currency: EUR
        Min Order: 5 units
      `;

      mammoth.extractRawText.mockResolvedValue({ 
        value: mockText,
        messages: []
      });
      mammoth.convertToHtml.mockResolvedValue({ 
        value: '<html><body></body></html>',
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].sku).toBe('PROD001');
      expect(result.data[0].unitPrice).toBe(10.99);
    });

    test('should handle corrupted Word file', async () => {
      mammoth.convertToHtml.mockRejectedValue(new Error('Invalid file format'));

      const result = await parseWord(Buffer.from('corrupted'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse Word document');
    });

    test('should handle empty Word document', async () => {
      mammoth.convertToHtml.mockResolvedValue({ 
        value: '<html><body></body></html>',
        messages: []
      });
      mammoth.extractRawText.mockResolvedValue({ 
        value: '',
        messages: []
      });

      const result = await parseWord(Buffer.from('empty'));

      expect(result.success).toBe(false);
      expect(result.error).toBe('No data found in Word document');
    });

    test('should handle complex table structures', async () => {
      const mockHtml = `
        <table>
          <tr>
            <td rowspan="2">SKU</td>
            <td colspan="3">Pricing</td>
          </tr>
          <tr>
            <td>Unit Price</td>
            <td>Currency</td>
            <td>MOQ</td>
          </tr>
          <tr>
            <td>PROD001</td>
            <td>10.99</td>
            <td>USD</td>
            <td>10</td>
          </tr>
        </table>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0]).toMatchObject({
        sku: 'PROD001',
        unitPrice: 10.99,
        currency: 'USD',
        minimumOrderQuantity: 10
      });
    });

    test('should extract product information from paragraphs', async () => {
      const mockHtml = `
        <html>
          <body>
            <p><strong>Product Code:</strong> PROD001</p>
            <p><strong>Description:</strong> High-quality product</p>
            <p><strong>Price:</strong> $10.99 USD</p>
            <p><strong>Minimum Order:</strong> 10 units</p>
            <hr/>
            <p><strong>Product Code:</strong> PROD002</p>
            <p><strong>Description:</strong> Premium product</p>
            <p><strong>Price:</strong> $25.50 USD</p>
          </body>
        </html>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].description).toBe('High-quality product');
    });

    test('should handle various currency formats', async () => {
      const mockText = `
        SKU: PROD001 | Price: $10.99
        SKU: PROD002 | Price: €25.50
        SKU: PROD003 | Price: £15.00
        SKU: PROD004 | Price: ¥1000
        SKU: PROD005 | Price: 50.00 CAD
      `;

      mammoth.extractRawText.mockResolvedValue({ 
        value: mockText,
        messages: []
      });
      mammoth.convertToHtml.mockResolvedValue({ 
        value: '<html><body></body></html>',
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(5);
      expect(result.data[0].currency).toBe('USD');
      expect(result.data[1].currency).toBe('EUR');
      expect(result.data[2].currency).toBe('GBP');
      expect(result.data[3].currency).toBe('JPY');
      expect(result.data[4].currency).toBe('CAD');
    });

    test('should handle nested tables', async () => {
      const mockHtml = `
        <table>
          <tr>
            <td>Category: Electronics</td>
          </tr>
          <tr>
            <td>
              <table>
                <tr>
                  <td>SKU</td>
                  <td>Description</td>
                  <td>Price</td>
                </tr>
                <tr>
                  <td>ELEC001</td>
                  <td>Laptop</td>
                  <td>999.99</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].sku).toBe('ELEC001');
      expect(result.data[0].category).toBe('Electronics');
    });
  });

  describe('validateWordStructure', () => {
    test('should validate correct Word structure with tables', async () => {
      const mockHtml = `
        <table>
          <tr>
            <td>SKU</td>
            <td>Description</td>
            <td>Unit Price</td>
          </tr>
          <tr>
            <td>PROD001</td>
            <td>Product 1</td>
            <td>10.99</td>
          </tr>
        </table>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await validateWordStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.structure.tables).toBe(1);
      expect(result.structure.requiredColumns).toContain('SKU');
    });

    test('should detect missing required columns', async () => {
      const mockHtml = `
        <table>
          <tr>
            <td>Description</td>
            <td>Currency</td>
          </tr>
          <tr>
            <td>Product 1</td>
            <td>USD</td>
          </tr>
        </table>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await validateWordStructure(Buffer.from('mock'));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required column: SKU');
      expect(result.errors).toContain('Missing required column: Unit Price');
    });

    test('should validate text-based format', async () => {
      const mockText = `
        SKU: PROD001
        Description: Product 1
        Price: $10.99
      `;

      mammoth.extractRawText.mockResolvedValue({ 
        value: mockText,
        messages: []
      });
      mammoth.convertToHtml.mockResolvedValue({ 
        value: '<html><body><p>Text content</p></body></html>',
        messages: []
      });

      const result = await validateWordStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.structure.format).toBe('text-based');
      expect(result.structure.hasRequiredFields).toBe(true);
    });
  });

  describe('extractTablesFromWord', () => {
    test('should extract all tables from document', async () => {
      const mockHtml = `
        <html>
          <body>
            <h1>Products</h1>
            <table id="products">
              <tr><td>SKU</td><td>Name</td></tr>
              <tr><td>P001</td><td>Product 1</td></tr>
            </table>
            <h2>Pricing</h2>
            <table id="pricing">
              <tr><td>SKU</td><td>Price</td></tr>
              <tr><td>P001</td><td>10.99</td></tr>
            </table>
          </body>
        </html>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const tables = await extractTablesFromWord(Buffer.from('mock'));

      expect(tables).toHaveLength(2);
      expect(tables[0].headers).toEqual(['SKU', 'Name']);
      expect(tables[1].headers).toEqual(['SKU', 'Price']);
    });

    test('should handle tables with merged cells', async () => {
      const mockHtml = `
        <table>
          <tr>
            <td colspan="2">Price List</td>
          </tr>
          <tr>
            <td>SKU</td>
            <td>Price</td>
          </tr>
          <tr>
            <td>PROD001</td>
            <td>10.99</td>
          </tr>
        </table>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const tables = await extractTablesFromWord(Buffer.from('mock'));

      expect(tables).toHaveLength(1);
      expect(tables[0].rows).toHaveLength(1); // Only data rows
      expect(tables[0].rows[0]).toEqual(['PROD001', '10.99']);
    });
  });

  describe('Word format edge cases', () => {
    test('should handle documents with images', async () => {
      const mockHtml = `
        <html>
          <body>
            <img src="data:image/png;base64,..." alt="Logo"/>
            <table>
              <tr><td>SKU</td><td>Price</td></tr>
              <tr><td>PROD001</td><td>10.99</td></tr>
            </table>
          </body>
        </html>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: [{ type: 'warning', message: 'Image ignored' }]
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Image ignored');
      expect(result.data).toHaveLength(1);
    });

    test('should handle documents with footnotes and endnotes', async () => {
      const mockHtml = `
        <html>
          <body>
            <table>
              <tr><td>SKU</td><td>Price<sup>1</sup></td></tr>
              <tr><td>PROD001</td><td>10.99</td></tr>
            </table>
            <p><sup>1</sup> Prices in USD</p>
          </body>
        </html>
      `;

      mammoth.convertToHtml.mockResolvedValue({ 
        value: mockHtml,
        messages: []
      });

      const result = await parseWord(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].notes).toContain('Prices in USD');
    });

    test('should handle password-protected documents', async () => {
      mammoth.convertToHtml.mockRejectedValue(new Error('Document is password protected'));

      const result = await parseWord(Buffer.from('protected'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Document is password protected');
    });
  });
});