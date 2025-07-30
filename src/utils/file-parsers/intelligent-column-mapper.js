import FuzzySet from 'fuzzyset';
import natural from 'natural';
import { levenshteinDistance } from './utils/string-distance.js';

// Enhanced column mappings with synonyms and variations
const INTELLIGENT_MAPPINGS = {
  sku: {
    primary: ['sku', 'product_code', 'item_code'],
    variations: ['part_number', 'product_id', 'item_id', 'item_#', 'item_no', 'code', 'part_#', 'catalog_#', 'ref', 'reference', 'article', 'material', 'stock_code', 'inventory_code'],
    patterns: [/^[A-Z0-9]{2,}[-_]?[A-Z0-9]+$/i, /^\d{6,}$/],
    validators: [(value) => value && value.trim().length >= 3]
  },
  
  description: {
    primary: ['description', 'product_description', 'item_description'],
    variations: ['name', 'product_name', 'item_name', 'details', 'product', 'item', 'designation', 'title', 'label', 'text', 'specification', 'product_details'],
    patterns: [/^[A-Za-z\s]{5,}$/],
    validators: [(value) => value && value.trim().length >= 5]
  },
  
  unitPrice: {
    primary: ['unit_price', 'price', 'cost'],
    variations: ['unit_cost', 'list_price', 'price_per_unit', 'rate', 'amount', 'value', 'price/unit', 'unit_rate', 'selling_price', 'retail_price', 'wholesale_price', 'net_price', 'base_price'],
    patterns: [/^\$?[\d,]+\.?\d*$/, /^[\d,]+\.?\d*\s*(USD|EUR|GBP)?$/i],
    validators: [(value) => {
      const num = parseFloat(String(value).replace(/[$,]/g, ''));
      return !isNaN(num) && num > 0;
    }]
  },
  
  currency: {
    primary: ['currency', 'currency_code', 'curr'],
    variations: ['ccy', 'cur', 'money', 'denomination', 'monetary_unit', 'iso_code', 'curr_code'],
    patterns: [/^[A-Z]{3}$/],
    validators: [(value) => ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'CHF', 'SEK', 'NOK', 'ZAR'].includes(value?.toUpperCase())]
  },
  
  minimumOrderQuantity: {
    primary: ['moq', 'min_order_qty', 'minimum_order_quantity'],
    variations: ['min_qty', 'minimum', 'min_quantity', 'min._qty', 'minimum_qty', 'min_order', 'minimum_quantity', 'order_minimum', 'qty_minimum', 'min_purchase'],
    patterns: [/^\d+$/],
    validators: [(value) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 0;
    }]
  },
  
  unitOfMeasure: {
    primary: ['uom', 'unit_of_measure', 'unit'],
    variations: ['units', 'measure', 'ea', 'per', 'package', 'packaging', 'pack_size', 'qty_per', 'sales_unit', 'base_unit', 'measurement_unit'],
    patterns: [/^[A-Z]{1,5}$/i],
    validators: [(value) => {
      const validUnits = ['EA', 'PC', 'BOX', 'CTN', 'PLT', 'KG', 'LB', 'G', 'OZ', 'L', 'ML', 'GAL', 'M', 'FT', 'IN', 'CM', 'ROLL', 'PACK', 'SET', 'PAIR', 'DOZ'];
      return validUnits.includes(value?.toUpperCase());
    }]
  }
};

// Machine learning cache for successful mappings
class MappingLearner {
  constructor() {
    this.successfulMappings = new Map();
    this.columnPatterns = new Map();
    this.confidence = new Map();
  }
  
  learn(sourceColumn, targetField, success = true) {
    const key = `${sourceColumn.toLowerCase()}_${targetField}`;
    const current = this.successfulMappings.get(key) || { count: 0, success: 0 };
    
    current.count++;
    if (success) current.success++;
    
    this.successfulMappings.set(key, current);
    this.updateConfidence(sourceColumn, targetField);
  }
  
  updateConfidence(sourceColumn, targetField) {
    const key = `${sourceColumn.toLowerCase()}_${targetField}`;
    const stats = this.successfulMappings.get(key);
    
    if (stats && stats.count > 0) {
      const confidence = stats.success / stats.count;
      this.confidence.set(key, confidence);
    }
  }
  
  getConfidence(sourceColumn, targetField) {
    const key = `${sourceColumn.toLowerCase()}_${targetField}`;
    return this.confidence.get(key) || 0;
  }
  
  suggestMapping(sourceColumn) {
    const suggestions = [];
    const columnLower = sourceColumn.toLowerCase();
    
    for (const [field, _] of Object.entries(INTELLIGENT_MAPPINGS)) {
      const confidence = this.getConfidence(sourceColumn, field);
      if (confidence > 0) {
        suggestions.push({ field, confidence });
      }
    }
    
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }
}

// Singleton learner instance
const learner = new MappingLearner();

// Intelligent column mapper class
export class IntelligentColumnMapper {
  constructor(options = {}) {
    this.fuzzyThreshold = options.fuzzyThreshold || 0.7;
    this.useML = options.useML !== false;
    this.usePatterns = options.usePatterns !== false;
    this.customMappings = options.customMappings || {};
    this.language = options.language || 'english';
    
    // Initialize fuzzy matchers
    this.fuzzyMatchers = {};
    for (const [field, config] of Object.entries(INTELLIGENT_MAPPINGS)) {
      const allTerms = [...config.primary, ...config.variations];
      this.fuzzyMatchers[field] = FuzzySet(allTerms);
    }
    
    // Initialize NLP components
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
  }
  
  // Map headers to fields intelligently
  mapHeaders(headers, options = {}) {
    const mapping = {};
    const confidence = {};
    const suggestions = {};
    
    headers.forEach((header, index) => {
      const result = this.mapSingleHeader(header, options);
      
      if (result.field) {
        // Check for conflicts
        if (mapping[result.field] !== undefined) {
          // Keep the one with higher confidence
          if (result.confidence > confidence[result.field]) {
            mapping[result.field] = index;
            confidence[result.field] = result.confidence;
          }
        } else {
          mapping[result.field] = index;
          confidence[result.field] = result.confidence;
        }
      }
      
      // Store suggestions for unmapped headers
      if (result.suggestions.length > 0) {
        suggestions[header] = result.suggestions;
      }
    });
    
    return {
      mapping,
      confidence,
      suggestions,
      unmappedHeaders: headers.filter((h, i) => 
        !Object.values(mapping).includes(i)
      )
    };
  }
  
  // Map a single header to a field
  mapSingleHeader(header, options = {}) {
    const normalizedHeader = this.normalizeHeader(header);
    
    // Try exact match first
    const exactMatch = this.findExactMatch(normalizedHeader);
    if (exactMatch) {
      return {
        field: exactMatch,
        confidence: 1.0,
        method: 'exact',
        suggestions: []
      };
    }
    
    // Try ML suggestions if available
    if (this.useML) {
      const mlSuggestions = learner.suggestMapping(header);
      if (mlSuggestions.length > 0 && mlSuggestions[0].confidence > 0.8) {
        return {
          field: mlSuggestions[0].field,
          confidence: mlSuggestions[0].confidence,
          method: 'ml',
          suggestions: mlSuggestions.slice(1)
        };
      }
    }
    
    // Try fuzzy matching
    const fuzzyMatch = this.findFuzzyMatch(normalizedHeader);
    if (fuzzyMatch && fuzzyMatch.confidence >= this.fuzzyThreshold) {
      return {
        field: fuzzyMatch.field,
        confidence: fuzzyMatch.confidence,
        method: 'fuzzy',
        suggestions: fuzzyMatch.alternatives
      };
    }
    
    // Try pattern matching
    if (this.usePatterns) {
      const patternMatch = this.findPatternMatch(header);
      if (patternMatch) {
        return {
          field: patternMatch.field,
          confidence: patternMatch.confidence,
          method: 'pattern',
          suggestions: []
        };
      }
    }
    
    // Try NLP-based matching
    const nlpMatch = this.findNLPMatch(normalizedHeader);
    if (nlpMatch) {
      return {
        field: nlpMatch.field,
        confidence: nlpMatch.confidence,
        method: 'nlp',
        suggestions: nlpMatch.alternatives
      };
    }
    
    // Return suggestions only
    const allSuggestions = this.getAllSuggestions(normalizedHeader);
    return {
      field: null,
      confidence: 0,
      method: 'none',
      suggestions: allSuggestions
    };
  }
  
  // Normalize header for comparison
  normalizeHeader(header) {
    return header
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
  
  // Find exact match
  findExactMatch(normalizedHeader) {
    for (const [field, config] of Object.entries(INTELLIGENT_MAPPINGS)) {
      const allTerms = [...config.primary, ...config.variations];
      
      if (allTerms.some(term => 
        this.normalizeHeader(term) === normalizedHeader
      )) {
        return field;
      }
    }
    
    // Check custom mappings
    if (this.customMappings[normalizedHeader]) {
      return this.customMappings[normalizedHeader];
    }
    
    return null;
  }
  
  // Find fuzzy match
  findFuzzyMatch(normalizedHeader) {
    let bestMatch = null;
    let bestConfidence = 0;
    const alternatives = [];
    
    for (const [field, fuzzySet] of Object.entries(this.fuzzyMatchers)) {
      const results = fuzzySet.get(normalizedHeader);
      
      if (results && results.length > 0) {
        const [confidence, matchedTerm] = results[0];
        
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = field;
        }
        
        if (confidence > 0.5) {
          alternatives.push({
            field,
            confidence,
            matchedTerm
          });
        }
      }
    }
    
    return bestMatch ? {
      field: bestMatch,
      confidence: bestConfidence,
      alternatives: alternatives.filter(a => a.field !== bestMatch)
    } : null;
  }
  
  // Find pattern match
  findPatternMatch(header) {
    // First, check if the header itself matches any patterns
    for (const [field, config] of Object.entries(INTELLIGENT_MAPPINGS)) {
      if (config.patterns && config.patterns.length > 0) {
        for (const pattern of config.patterns) {
          if (pattern.test(header)) {
            return {
              field,
              confidence: 0.7,
              matchedPattern: pattern.toString()
            };
          }
        }
      }
    }
    
    return null;
  }
  
  // Find match using NLP techniques
  findNLPMatch(normalizedHeader) {
    const tokens = this.tokenizer.tokenize(normalizedHeader);
    const stems = tokens.map(token => this.stemmer.stem(token));
    
    let bestMatch = null;
    let bestScore = 0;
    const alternatives = [];
    
    for (const [field, config] of Object.entries(INTELLIGENT_MAPPINGS)) {
      const allTerms = [...config.primary, ...config.variations];
      
      for (const term of allTerms) {
        const termTokens = this.tokenizer.tokenize(this.normalizeHeader(term));
        const termStems = termTokens.map(token => this.stemmer.stem(token));
        
        // Calculate similarity score
        const score = this.calculateStemSimilarity(stems, termStems);
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = field;
        }
        
        if (score > 0.5) {
          alternatives.push({
            field,
            confidence: score,
            matchedTerm: term
          });
        }
      }
    }
    
    return bestMatch && bestScore > 0.6 ? {
      field: bestMatch,
      confidence: bestScore,
      alternatives: alternatives.filter(a => a.field !== bestMatch)
    } : null;
  }
  
  // Calculate stem similarity
  calculateStemSimilarity(stems1, stems2) {
    const set1 = new Set(stems1);
    const set2 = new Set(stems2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    if (union.size === 0) return 0;
    
    // Jaccard similarity
    const jaccard = intersection.size / union.size;
    
    // Boost score if stems are in the same order
    let orderBonus = 0;
    if (stems1.length === stems2.length) {
      const matches = stems1.filter((stem, i) => stem === stems2[i]).length;
      orderBonus = matches / stems1.length * 0.2;
    }
    
    return Math.min(1, jaccard + orderBonus);
  }
  
  // Get all suggestions for unmapped header
  getAllSuggestions(normalizedHeader) {
    const suggestions = [];
    
    // Get fuzzy suggestions
    for (const [field, fuzzySet] of Object.entries(this.fuzzyMatchers)) {
      const results = fuzzySet.get(normalizedHeader);
      
      if (results && results.length > 0) {
        results.forEach(([confidence, matchedTerm]) => {
          if (confidence > 0.3) {
            suggestions.push({
              field,
              confidence,
              method: 'fuzzy',
              matchedTerm
            });
          }
        });
      }
    }
    
    // Get ML suggestions
    if (this.useML) {
      const mlSuggestions = learner.suggestMapping(normalizedHeader);
      mlSuggestions.forEach(suggestion => {
        suggestions.push({
          ...suggestion,
          method: 'ml'
        });
      });
    }
    
    // Sort by confidence
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
  
  // Validate mapped data
  validateMapping(data, mapping) {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      statistics: {}
    };
    
    // Check required fields
    const requiredFields = ['sku', 'unitPrice'];
    for (const field of requiredFields) {
      if (mapping[field] === undefined) {
        results.valid = false;
        results.errors.push({
          field,
          message: `Required field "${field}" is not mapped`
        });
      }
    }
    
    // Validate data using field validators
    if (data && data.length > 0) {
      const fieldStats = {};
      
      for (const [field, columnIndex] of Object.entries(mapping)) {
        if (columnIndex === undefined) continue;
        
        const config = INTELLIGENT_MAPPINGS[field];
        if (!config) continue;
        
        fieldStats[field] = {
          total: 0,
          valid: 0,
          invalid: 0,
          examples: []
        };
        
        // Sample validation
        const sampleSize = Math.min(100, data.length);
        for (let i = 0; i < sampleSize; i++) {
          const value = data[i][columnIndex];
          fieldStats[field].total++;
          
          // Check validators
          const isValid = config.validators.every(validator => 
            validator(value)
          );
          
          if (isValid) {
            fieldStats[field].valid++;
            if (fieldStats[field].examples.length < 3) {
              fieldStats[field].examples.push(value);
            }
          } else {
            fieldStats[field].invalid++;
            
            if (field === 'sku' || field === 'unitPrice') {
              results.warnings.push({
                field,
                row: i + 1,
                value,
                message: `Invalid ${field} value`
              });
            }
          }
        }
        
        // Calculate validation rate
        fieldStats[field].validationRate = 
          fieldStats[field].valid / fieldStats[field].total;
        
        // Warn if validation rate is low
        if (fieldStats[field].validationRate < 0.8) {
          results.warnings.push({
            field,
            validationRate: fieldStats[field].validationRate,
            message: `Low validation rate for ${field}: ${(fieldStats[field].validationRate * 100).toFixed(1)}%`
          });
        }
      }
      
      results.statistics = fieldStats;
    }
    
    return results;
  }
  
  // Apply mapping to data
  applyMapping(data, mapping) {
    return data.map((row, index) => {
      const item = {};
      
      for (const [field, columnIndex] of Object.entries(mapping)) {
        if (columnIndex !== undefined && row[columnIndex] !== undefined) {
          const value = row[columnIndex];
          const config = INTELLIGENT_MAPPINGS[field];
          
          // Apply field-specific transformations
          switch (field) {
            case 'sku':
              item.sku = String(value).trim();
              break;
              
            case 'description':
              item.description = String(value).trim();
              break;
              
            case 'unitPrice':
              const priceStr = String(value).replace(/[$,]/g, '');
              item.unitPrice = parseFloat(priceStr) || 0;
              break;
              
            case 'currency':
              item.currency = String(value).toUpperCase().trim() || 'USD';
              break;
              
            case 'minimumOrderQuantity':
              item.minimumOrderQuantity = parseInt(value) || 1;
              break;
              
            case 'unitOfMeasure':
              item.unitOfMeasure = String(value).toUpperCase().trim() || 'EA';
              break;
              
            default:
              item[field] = value;
          }
        }
      }
      
      // Set defaults for missing fields
      if (!item.currency) item.currency = 'USD';
      if (!item.minimumOrderQuantity) item.minimumOrderQuantity = 1;
      if (!item.unitOfMeasure) item.unitOfMeasure = 'EA';
      
      return item;
    });
  }
  
  // Learn from user feedback
  learnFromFeedback(header, field, isCorrect) {
    if (this.useML) {
      learner.learn(header, field, isCorrect);
    }
  }
  
  // Export learned mappings
  exportLearnings() {
    return {
      mappings: Array.from(learner.successfulMappings.entries()),
      confidence: Array.from(learner.confidence.entries()),
      timestamp: new Date().toISOString()
    };
  }
  
  // Import learned mappings
  importLearnings(data) {
    if (data.mappings) {
      data.mappings.forEach(([key, value]) => {
        learner.successfulMappings.set(key, value);
      });
    }
    
    if (data.confidence) {
      data.confidence.forEach(([key, value]) => {
        learner.confidence.set(key, value);
      });
    }
  }
}

// Export singleton instance and utilities
export const columnMapper = new IntelligentColumnMapper();

export function createColumnMapper(options) {
  return new IntelligentColumnMapper(options);
}

// Helper function for string distance
export { levenshteinDistance };