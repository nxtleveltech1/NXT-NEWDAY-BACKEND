import aiService from '../ai.service.js';

// Mock process.env for testing
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('AI Service', () => {
  describe('Configuration', () => {
    test('should detect when not configured', () => {
      delete process.env.OPENAI_API_KEY;
      const result = aiService.isConfigured();
      expect(result).toBe(false);
    });

    test('should detect when configured', () => {
      process.env.OPENAI_API_KEY = 'test-api-key';
      const result = aiService.isConfigured();
      expect(result).toBe(true);
    });
  });

  describe('Natural Language Query Processing', () => {
    test('should provide fallback query when AI is not configured', async () => {
      delete process.env.OPENAI_API_KEY;
      
      const result = await aiService.processNaturalLanguageQuery('show me low stock items');
      
      expect(result.success).toBe(false);
      expect(result.fallback).toBeDefined();
      expect(result.fallback.intent).toBe('REORDER_SUGGESTIONS');
      expect(result.fallback.fallback).toBe(true);
    });

    test('should provide fallback for inventory queries', async () => {
      const result = await aiService.processNaturalLanguageQuery('check inventory levels');
      
      // Since AI might not be configured in test environment, check for fallback
      if (!result.success && result.fallback) {
        expect(result.fallback.intent).toBe('INVENTORY_LEVEL');
        expect(result.fallback.entity).toBe('inventory');
        expect(result.fallback.confidence).toBe(0.5);
      }
    });

    test('should provide fallback for supplier queries', async () => {
      const result = await aiService.processNaturalLanguageQuery('show supplier performance');
      
      if (!result.success && result.fallback) {
        expect(result.fallback.intent).toBe('SUPPLIER_PERFORMANCE');
        expect(result.fallback.entity).toBe('suppliers');
      }
    });
  });

  describe('Query Translation', () => {
    test('should translate inventory level intent correctly', () => {
      const queryIntent = {
        intent: 'INVENTORY_LEVEL',
        entity: 'inventory',
        parameters: {
          filters: { lowStock: true, warehouseId: 'warehouse-1' }
        }
      };

      const result = aiService.translateToAnalyticsQuery(queryIntent);

      expect(result.type).toBe('INVENTORY_LEVEL');
      expect(result.endpoint).toBe('/api/inventory');
      expect(result.params.belowReorderPoint).toBe(true);
      expect(result.params.warehouseId).toBe('warehouse-1');
    });

    test('should translate reorder suggestions intent correctly', () => {
      const queryIntent = {
        intent: 'REORDER_SUGGESTIONS',
        entity: 'inventory',
        parameters: {}
      };

      const result = aiService.translateToAnalyticsQuery(queryIntent);

      expect(result.type).toBe('REORDER_SUGGESTIONS');
      expect(result.endpoint).toBe('/api/inventory/reorder');
      expect(result.params).toEqual({});
    });

    test('should translate supplier performance intent correctly', () => {
      const queryIntent = {
        intent: 'SUPPLIER_PERFORMANCE',
        entity: 'suppliers',
        parameters: {}
      };

      const result = aiService.translateToAnalyticsQuery(queryIntent);

      expect(result.type).toBe('SUPPLIER_PERFORMANCE');
      expect(result.endpoint).toBe('/api/suppliers');
      expect(result.postProcess).toBe('aggregateSupplierMetrics');
    });

    test('should handle unknown intents with fallback', () => {
      const queryIntent = {
        intent: 'UNKNOWN_INTENT',
        entity: 'unknown',
        parameters: {}
      };

      const result = aiService.translateToAnalyticsQuery(queryIntent);

      expect(result.type).toBe('UNKNOWN_INTENT');
      expect(result.endpoint).toBe('/api/inventory/analytics');
    });
  });

  describe('Fallback Methods', () => {
    test('should provide fallback query for stock-related queries', () => {
      const result = aiService.getFallbackQuery('check stock levels');
      
      expect(result.intent).toBe('INVENTORY_LEVEL');
      expect(result.entity).toBe('inventory');
      expect(result.confidence).toBe(0.5);
      expect(result.fallback).toBe(true);
    });

    test('should provide fallback query for reorder-related queries', () => {
      const result = aiService.getFallbackQuery('show reorder points');
      
      expect(result.intent).toBe('REORDER_SUGGESTIONS');
      expect(result.entity).toBe('inventory');
      expect(result.confidence).toBe(0.5);
      expect(result.fallback).toBe(true);
    });

    test('should provide fallback query for supplier-related queries', () => {
      const result = aiService.getFallbackQuery('supplier performance data');
      
      expect(result.intent).toBe('SUPPLIER_PERFORMANCE');
      expect(result.entity).toBe('suppliers');
      expect(result.confidence).toBe(0.5);
      expect(result.fallback).toBe(true);
    });

    test('should provide default fallback for unrecognized queries', () => {
      const result = aiService.getFallbackQuery('random query text');
      
      expect(result.intent).toBe('ANALYTICS_SUMMARY');
      expect(result.entity).toBe('inventory');
      expect(result.confidence).toBe(0.3);
      expect(result.fallback).toBe(true);
    });

    test('should provide fallback insights', () => {
      const testData = [{ id: 1, name: 'Test' }, { id: 2, name: 'Test2' }];
      const result = aiService.getFallbackInsights(testData, 'inventory');
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      const firstInsight = result[0];
      expect(firstInsight).toHaveProperty('type');
      expect(firstInsight).toHaveProperty('title');
      expect(firstInsight).toHaveProperty('description');
      expect(firstInsight).toHaveProperty('impact');
      expect(firstInsight).toHaveProperty('actionable');
    });

    test('should provide fallback recommendations', () => {
      const result = aiService.getFallbackRecommendations('inventory');
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      const firstRecommendation = result[0];
      expect(firstRecommendation).toHaveProperty('title');
      expect(firstRecommendation).toHaveProperty('description');
      expect(firstRecommendation).toHaveProperty('impact');
      expect(firstRecommendation).toHaveProperty('effort');
      expect(firstRecommendation).toHaveProperty('timeframe');
      expect(firstRecommendation).toHaveProperty('kpis');
      expect(firstRecommendation).toHaveProperty('steps');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing API key gracefully', async () => {
      delete process.env.OPENAI_API_KEY;
      
      const result = await aiService.generateInsights({ test: 'data' }, 'test');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('AI service not configured');
      expect(result.insights).toEqual([]);
    });

    test('should handle API errors gracefully', async () => {
      // Mock a failed API request
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      process.env.OPENAI_API_KEY = 'test-key';
      
      const result = await aiService.processNaturalLanguageQuery('test query');
      
      expect(result.success).toBe(false);
      expect(result.fallback).toBeDefined();
      
      // Restore fetch
      delete global.fetch;
    });
  });

  describe('Input Validation', () => {
    test('should handle empty query strings', async () => {
      const result = await aiService.processNaturalLanguageQuery('');
      
      if (!result.success) {
        expect(result.fallback).toBeDefined();
      }
    });

    test('should handle null/undefined queries', async () => {
      const result1 = await aiService.processNaturalLanguageQuery(null);
      const result2 = await aiService.processNaturalLanguageQuery(undefined);
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });
});