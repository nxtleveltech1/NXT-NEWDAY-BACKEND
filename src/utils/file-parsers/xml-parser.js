import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// XML parsing options
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  parseTrueNumberOnly: true
};

// Parse XML buffer and extract price list data
export async function parseXML(fileBuffer, options = {}) {
  const { encoding = 'utf-8' } = options;
  
  try {
    const xmlString = fileBuffer.toString(encoding);
    const parser = new XMLParser(parserOptions);
    const xmlData = parser.parse(xmlString);
    
    // Find the root element containing price list data
    const root = findPriceListRoot(xmlData);
    if (!root) {
      throw new Error('No price list data found in XML');
    }
    
    // Extract items based on structure
    const { items, metadata } = extractItemsFromXML(root);
    
    // Validate and standardize items
    const { validItems, errors } = validateAndStandardizeItems(items);
    
    return {
      success: errors.length === 0 || validItems.length > 0,
      data: validItems,
      errors,
      parsedCount: validItems.length,
      totalRows: items.length,
      metadata
    };
  } catch (error) {
    return {
      success: false,
      error: 'XML parsing failed: ' + error.message,
      errors: [],
      parsedCount: 0
    };
  }
}

// Find the root element containing price list data
function findPriceListRoot(xmlData) {
  // Common root element names
  const rootNames = [
    'PriceList', 'priceList', 'price-list',
    'Catalog', 'catalog',
    'Products', 'products',
    'Items', 'items',
    'Articles', 'articles'
  ];
  
  // Check direct root
  for (const name of rootNames) {
    if (xmlData[name]) {
      return xmlData[name];
    }
  }
  
  // Check one level deep (common with XML declarations)
  const keys = Object.keys(xmlData);
  if (keys.length === 1) {
    const firstKey = keys[0];
    for (const name of rootNames) {
      if (xmlData[firstKey][name]) {
        return xmlData[firstKey][name];
      }
    }
    // Return the first key's value if it might contain items
    return xmlData[firstKey];
  }
  
  return null;
}

// Extract items from XML structure
function extractItemsFromXML(root) {
  const items = [];
  const metadata = {};
  
  // Extract metadata from attributes or child elements
  if (root['@_currency']) metadata.currency = root['@_currency'];
  if (root['@_effectiveDate']) metadata.effectiveDate = root['@_effectiveDate'];
  if (root['@_supplierName']) metadata.supplierName = root['@_supplierName'];
  
  // Check for metadata elements
  if (root.metadata || root.Metadata) {
    const meta = root.metadata || root.Metadata;
    if (meta.currency) metadata.currency = meta.currency;
    if (meta.effectiveDate) metadata.effectiveDate = meta.effectiveDate;
    if (meta.supplierName) metadata.supplierName = meta.supplierName;
  }
  
  // Find items array
  let itemsArray = [];
  const itemNames = [
    'item', 'Item', 'items', 'Items',
    'product', 'Product', 'products', 'Products',
    'article', 'Article', 'articles', 'Articles',
    'priceListItem', 'PriceListItem'
  ];
  
  for (const name of itemNames) {
    if (root[name]) {
      itemsArray = Array.isArray(root[name]) ? root[name] : [root[name]];
      break;
    }
  }
  
  // If no items found, check if root itself is an array
  if (itemsArray.length === 0 && Array.isArray(root)) {
    itemsArray = root;
  }
  
  // Parse each item
  itemsArray.forEach((item, index) => {
    items.push({
      ...parseXMLItem(item),
      _originalIndex: index
    });
  });
  
  return { items, metadata };
}

// Parse individual XML item
function parseXMLItem(item) {
  const result = {
    sku: '',
    description: '',
    unitPrice: 0,
    currency: 'USD',
    minimumOrderQuantity: 1,
    unitOfMeasure: 'EA',
    tierPricing: []
  };
  
  // Handle different XML structures
  
  // Attributes
  if (item['@_sku']) result.sku = item['@_sku'];
  if (item['@_price']) result.unitPrice = parseFloat(item['@_price']);
  if (item['@_currency']) result.currency = item['@_currency'];
  
  // Child elements
  const skuFields = ['sku', 'SKU', 'productCode', 'ProductCode', 'itemCode', 'ItemCode', 'partNumber', 'PartNumber'];
  for (const field of skuFields) {
    if (item[field]) {
      result.sku = String(item[field]);
      break;
    }
  }
  
  const descFields = ['description', 'Description', 'name', 'Name', 'productName', 'ProductName'];
  for (const field of descFields) {
    if (item[field]) {
      result.description = String(item[field]);
      break;
    }
  }
  
  const priceFields = ['unitPrice', 'UnitPrice', 'price', 'Price', 'cost', 'Cost', 'listPrice', 'ListPrice'];
  for (const field of priceFields) {
    if (item[field]) {
      result.unitPrice = parseFloat(item[field]);
      break;
    }
  }
  
  const currencyFields = ['currency', 'Currency', 'currencyCode', 'CurrencyCode'];
  for (const field of currencyFields) {
    if (item[field]) {
      result.currency = String(item[field]);
      break;
    }
  }
  
  const moqFields = ['minimumOrderQuantity', 'MinimumOrderQuantity', 'moq', 'MOQ', 'minQty', 'MinQty'];
  for (const field of moqFields) {
    if (item[field]) {
      result.minimumOrderQuantity = parseInt(item[field]);
      break;
    }
  }
  
  const uomFields = ['unitOfMeasure', 'UnitOfMeasure', 'uom', 'UOM', 'unit', 'Unit'];
  for (const field of uomFields) {
    if (item[field]) {
      result.unitOfMeasure = String(item[field]);
      break;
    }
  }
  
  // Parse tier pricing
  const tierPricingFields = ['tierPricing', 'TierPricing', 'volumePricing', 'VolumePricing', 'priceTiers', 'PriceTiers'];
  for (const field of tierPricingFields) {
    if (item[field]) {
      const tiers = Array.isArray(item[field]) ? item[field] : [item[field]];
      result.tierPricing = parseTierPricingXML(tiers);
      break;
    }
  }
  
  // Check for inline tier elements
  const tierPattern = /^(tier|Tier|priceTier|PriceTier)(\d+)$/;
  Object.keys(item).forEach(key => {
    const match = key.match(tierPattern);
    if (match && item[key]) {
      const tier = item[key];
      if (tier.quantity && tier.price) {
        result.tierPricing.push({
          minQuantity: parseInt(tier.quantity),
          price: parseFloat(tier.price)
        });
      }
    }
  });
  
  return result;
}

// Parse tier pricing from XML
function parseTierPricingXML(tiers) {
  const tierPricing = [];
  
  tiers.forEach(tier => {
    let minQuantity = 0;
    let price = 0;
    
    // Check attributes
    if (tier['@_quantity']) minQuantity = parseInt(tier['@_quantity']);
    if (tier['@_price']) price = parseFloat(tier['@_price']);
    
    // Check child elements
    const qtyFields = ['quantity', 'Quantity', 'minQuantity', 'MinQuantity', 'qty', 'Qty'];
    for (const field of qtyFields) {
      if (tier[field]) {
        minQuantity = parseInt(tier[field]);
        break;
      }
    }
    
    const priceFields = ['price', 'Price', 'unitPrice', 'UnitPrice'];
    for (const field of priceFields) {
      if (tier[field]) {
        price = parseFloat(tier[field]);
        break;
      }
    }
    
    if (minQuantity > 0 && price > 0) {
      tierPricing.push({ minQuantity, price });
    }
  });
  
  return tierPricing.sort((a, b) => a.minQuantity - b.minQuantity);
}

// Validate and standardize items
function validateAndStandardizeItems(items) {
  const validItems = [];
  const errors = [];
  
  items.forEach((item, index) => {
    const rowNumber = item._originalIndex !== undefined ? item._originalIndex + 1 : index + 1;
    
    // Remove internal fields
    delete item._originalIndex;
    
    // Validate required fields
    if (!item.sku) {
      errors.push({
        row: rowNumber,
        error: 'SKU is required',
        data: item
      });
      return;
    }
    
    if (isNaN(item.unitPrice) || item.unitPrice <= 0) {
      errors.push({
        row: rowNumber,
        error: 'Invalid unit price',
        data: item
      });
      return;
    }
    
    validItems.push(item);
  });
  
  return { validItems, errors };
}

// Validate XML structure before parsing
export async function validateXMLStructure(fileBuffer, options = {}) {
  try {
    const xmlString = fileBuffer.toString('utf-8');
    const parser = new XMLParser(parserOptions);
    
    // Check if XML is valid
    let xmlData;
    try {
      xmlData = parser.parse(xmlString);
    } catch (parseError) {
      return {
        valid: false,
        error: 'Invalid XML: ' + parseError.message
      };
    }
    
    // Find price list root
    const root = findPriceListRoot(xmlData);
    if (!root) {
      return {
        valid: false,
        error: 'No price list data found in XML. Expected root element like PriceList, Catalog, or Products.'
      };
    }
    
    // Extract items to check structure
    const { items } = extractItemsFromXML(root);
    
    const validation = {
      valid: true,
      itemCount: items.length,
      warnings: []
    };
    
    if (items.length === 0) {
      validation.valid = false;
      validation.error = 'No items found in XML data';
    }
    
    // Check for at least one valid item
    const hasValidItem = items.some(item => item.sku && item.unitPrice > 0);
    if (!hasValidItem) {
      validation.valid = false;
      validation.error = 'No valid items found. Items must have SKU and unit price.';
    }
    
    return validation;
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate XML structure: ' + error.message
    };
  }
}

// Generate XML template
export function generateXMLTemplate() {
  const template = {
    PriceList: {
      '@_currency': 'USD',
      '@_effectiveDate': new Date().toISOString().split('T')[0],
      '@_supplierName': 'Sample Supplier Co.',
      Item: [
        {
          SKU: 'PROD-001',
          Description: 'Widget A',
          UnitPrice: 10.50,
          Currency: 'USD',
          MinimumOrderQuantity: 1,
          UnitOfMeasure: 'EA',
          TierPricing: [
            { Quantity: 10, Price: 9.50 },
            { Quantity: 50, Price: 8.75 },
            { Quantity: 100, Price: 8.00 }
          ]
        },
        {
          SKU: 'PROD-002',
          Description: 'Widget B',
          UnitPrice: 25.00,
          Currency: 'USD',
          MinimumOrderQuantity: 5,
          UnitOfMeasure: 'BOX',
          TierPricing: [
            { Quantity: 10, Price: 23.00 },
            { Quantity: 50, Price: 21.00 },
            { Quantity: 100, Price: 19.50 }
          ]
        },
        {
          SKU: 'PROD-003',
          Description: 'Widget C',
          UnitPrice: 5.75,
          Currency: 'USD',
          MinimumOrderQuantity: 1,
          UnitOfMeasure: 'EA'
        }
      ]
    }
  };
  
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    indentBy: '  '
  });
  
  const xmlString = builder.build(template);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlString;
}