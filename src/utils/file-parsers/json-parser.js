// JSON parser for price list files

// Expected JSON structure variations
const JSON_FORMATS = {
  // Format 1: Array of items
  ARRAY_FORMAT: 'array',
  // Format 2: Object with metadata and items array
  OBJECT_FORMAT: 'object',
  // Format 3: Nested supplier/price list structure
  NESTED_FORMAT: 'nested'
};

// Parse JSON buffer and extract price list data
export async function parseJSON(fileBuffer, options = {}) {
  const { encoding = 'utf-8' } = options;
  
  try {
    const jsonString = fileBuffer.toString(encoding);
    const jsonData = JSON.parse(jsonString);
    
    // Detect JSON format
    const format = detectJSONFormat(jsonData);
    
    let items = [];
    let metadata = {};
    
    switch (format) {
      case JSON_FORMATS.ARRAY_FORMAT:
        items = parseArrayFormat(jsonData);
        break;
        
      case JSON_FORMATS.OBJECT_FORMAT:
        const objectResult = parseObjectFormat(jsonData);
        items = objectResult.items;
        metadata = objectResult.metadata;
        break;
        
      case JSON_FORMATS.NESTED_FORMAT:
        const nestedResult = parseNestedFormat(jsonData);
        items = nestedResult.items;
        metadata = nestedResult.metadata;
        break;
        
      default:
        throw new Error('Unrecognized JSON format');
    }
    
    // Validate and standardize items
    const { validItems, errors } = validateAndStandardizeItems(items);
    
    return {
      success: errors.length === 0 || validItems.length > 0,
      data: validItems,
      errors,
      parsedCount: validItems.length,
      totalRows: items.length,
      metadata,
      format
    };
  } catch (error) {
    return {
      success: false,
      error: 'JSON parsing failed: ' + error.message,
      errors: [],
      parsedCount: 0
    };
  }
}

// Detect JSON format type
function detectJSONFormat(data) {
  if (Array.isArray(data)) {
    return JSON_FORMATS.ARRAY_FORMAT;
  }
  
  if (typeof data === 'object' && data !== null) {
    // Check for object format with items array
    if (data.items && Array.isArray(data.items)) {
      return JSON_FORMATS.OBJECT_FORMAT;
    }
    
    // Check for nested format with price lists
    if (data.priceLists && Array.isArray(data.priceLists)) {
      return JSON_FORMATS.NESTED_FORMAT;
    }
    
    // Check for supplier/priceList structure
    if (data.supplier || data.priceList) {
      return JSON_FORMATS.NESTED_FORMAT;
    }
  }
  
  return null;
}

// Parse array format: [{ sku: "...", price: ... }, ...]
function parseArrayFormat(data) {
  return data.map((item, index) => ({
    ...standardizeItemFields(item),
    _originalIndex: index
  }));
}

// Parse object format: { metadata: {...}, items: [...] }
function parseObjectFormat(data) {
  const metadata = {};
  const items = [];
  
  // Extract metadata
  if (data.metadata) {
    metadata.supplierName = data.metadata.supplierName || data.metadata.supplier;
    metadata.currency = data.metadata.currency || data.metadata.defaultCurrency;
    metadata.effectiveDate = data.metadata.effectiveDate || data.metadata.validFrom;
  }
  
  // Extract items
  if (data.items && Array.isArray(data.items)) {
    data.items.forEach((item, index) => {
      items.push({
        ...standardizeItemFields(item),
        _originalIndex: index
      });
    });
  }
  
  // Also check for alternative names
  const itemArrayNames = ['products', 'priceListItems', 'prices', 'articles'];
  for (const name of itemArrayNames) {
    if (data[name] && Array.isArray(data[name])) {
      data[name].forEach((item, index) => {
        items.push({
          ...standardizeItemFields(item),
          _originalIndex: index
        });
      });
      break;
    }
  }
  
  return { items, metadata };
}

// Parse nested format with supplier/price list structure
function parseNestedFormat(data) {
  const metadata = {};
  const items = [];
  
  // Extract from priceLists array
  if (data.priceLists && Array.isArray(data.priceLists)) {
    // Use the first price list
    const priceList = data.priceLists[0];
    if (priceList) {
      metadata.name = priceList.name;
      metadata.effectiveDate = priceList.effectiveDate;
      metadata.currency = priceList.currency;
      
      if (priceList.items && Array.isArray(priceList.items)) {
        priceList.items.forEach((item, index) => {
          items.push({
            ...standardizeItemFields(item),
            _originalIndex: index
          });
        });
      }
    }
  }
  
  // Extract from supplier structure
  if (data.supplier) {
    metadata.supplierName = data.supplier.name || data.supplier.companyName;
    metadata.supplierCode = data.supplier.code || data.supplier.supplierCode;
  }
  
  // Extract from priceList structure
  if (data.priceList) {
    metadata.name = data.priceList.name;
    metadata.effectiveDate = data.priceList.effectiveDate;
    
    if (data.priceList.items && Array.isArray(data.priceList.items)) {
      data.priceList.items.forEach((item, index) => {
        items.push({
          ...standardizeItemFields(item),
          _originalIndex: index
        });
      });
    }
  }
  
  return { items, metadata };
}

// Standardize item field names
function standardizeItemFields(item) {
  return {
    sku: item.sku || item.productCode || item.itemCode || item.partNumber || item.id || '',
    description: item.description || item.productDescription || item.name || item.productName || '',
    unitPrice: parseFloat(item.unitPrice || item.price || item.cost || item.listPrice || 0),
    currency: item.currency || item.currencyCode || 'USD',
    minimumOrderQuantity: parseInt(item.minimumOrderQuantity || item.moq || item.minQty || 1),
    unitOfMeasure: item.unitOfMeasure || item.uom || item.unit || 'EA',
    tierPricing: parseTierPricing(item)
  };
}

// Parse tier pricing from various formats
function parseTierPricing(item) {
  const tierPricing = [];
  
  // Format 1: tierPricing array
  if (item.tierPricing && Array.isArray(item.tierPricing)) {
    return item.tierPricing.map(tier => ({
      minQuantity: parseInt(tier.minQuantity || tier.quantity || tier.qty || 0),
      price: parseFloat(tier.price || tier.unitPrice || 0)
    })).filter(tier => tier.minQuantity > 0 && tier.price > 0);
  }
  
  // Format 2: volumePricing array
  if (item.volumePricing && Array.isArray(item.volumePricing)) {
    return item.volumePricing.map(tier => ({
      minQuantity: parseInt(tier.fromQuantity || tier.minQuantity || 0),
      price: parseFloat(tier.price || tier.unitPrice || 0)
    })).filter(tier => tier.minQuantity > 0 && tier.price > 0);
  }
  
  // Format 3: Separate price tier fields
  const tierFields = ['price10', 'price25', 'price50', 'price100'];
  const qtyFields = ['qty10', 'qty25', 'qty50', 'qty100'];
  
  tierFields.forEach((field, index) => {
    if (item[field] && item[qtyFields[index]]) {
      tierPricing.push({
        minQuantity: parseInt(item[qtyFields[index]]),
        price: parseFloat(item[field])
      });
    }
  });
  
  // Format 4: Dynamic tier fields (e.g., tier_10_qty, tier_10_price)
  const tierPattern = /tier_(\d+)_qty/;
  Object.keys(item).forEach(key => {
    const match = key.match(tierPattern);
    if (match) {
      const tierNum = match[1];
      const priceKey = `tier_${tierNum}_price`;
      if (item[priceKey]) {
        tierPricing.push({
          minQuantity: parseInt(item[key]),
          price: parseFloat(item[priceKey])
        });
      }
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
    
    // Validate tier pricing
    if (item.tierPricing && item.tierPricing.length > 0) {
      const tierErrors = [];
      item.tierPricing = item.tierPricing.filter((tier, tierIndex) => {
        if (!tier.minQuantity || tier.minQuantity <= 0) {
          tierErrors.push(`Tier ${tierIndex + 1}: Invalid quantity`);
          return false;
        }
        if (!tier.price || tier.price <= 0) {
          tierErrors.push(`Tier ${tierIndex + 1}: Invalid price`);
          return false;
        }
        return true;
      });
      
      if (tierErrors.length > 0) {
        errors.push({
          row: rowNumber,
          error: 'Tier pricing errors: ' + tierErrors.join(', '),
          data: item
        });
      }
    }
    
    validItems.push(item);
  });
  
  return { validItems, errors };
}

// Validate JSON structure before parsing
export async function validateJSONStructure(fileBuffer, options = {}) {
  try {
    const jsonString = fileBuffer.toString('utf-8');
    const jsonData = JSON.parse(jsonString);
    
    const format = detectJSONFormat(jsonData);
    
    if (!format) {
      return {
        valid: false,
        error: 'Unrecognized JSON format. Expected array of items or object with items property.'
      };
    }
    
    const validation = {
      valid: true,
      format,
      warnings: []
    };
    
    // Check for data based on format
    let itemCount = 0;
    switch (format) {
      case JSON_FORMATS.ARRAY_FORMAT:
        itemCount = jsonData.length;
        break;
      case JSON_FORMATS.OBJECT_FORMAT:
        itemCount = (jsonData.items || jsonData.products || jsonData.priceListItems || []).length;
        break;
      case JSON_FORMATS.NESTED_FORMAT:
        if (jsonData.priceLists && jsonData.priceLists[0]) {
          itemCount = (jsonData.priceLists[0].items || []).length;
        } else if (jsonData.priceList) {
          itemCount = (jsonData.priceList.items || []).length;
        }
        break;
    }
    
    if (itemCount === 0) {
      validation.valid = false;
      validation.error = 'No items found in JSON data';
    }
    
    validation.itemCount = itemCount;
    
    return validation;
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid JSON: ' + error.message
    };
  }
}

// Generate JSON template
export function generateJSONTemplate() {
  const template = {
    metadata: {
      supplierName: 'Sample Supplier Co.',
      currency: 'USD',
      effectiveDate: new Date().toISOString().split('T')[0]
    },
    items: [
      {
        sku: 'PROD-001',
        description: 'Widget A',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: [
          { minQuantity: 10, price: 9.50 },
          { minQuantity: 50, price: 8.75 },
          { minQuantity: 100, price: 8.00 }
        ]
      },
      {
        sku: 'PROD-002',
        description: 'Widget B',
        unitPrice: 25.00,
        currency: 'USD',
        minimumOrderQuantity: 5,
        unitOfMeasure: 'BOX',
        tierPricing: [
          { minQuantity: 10, price: 23.00 },
          { minQuantity: 50, price: 21.00 },
          { minQuantity: 100, price: 19.50 }
        ]
      },
      {
        sku: 'PROD-003',
        description: 'Widget C',
        unitPrice: 5.75,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA'
      }
    ]
  };
  
  return JSON.stringify(template, null, 2);
}