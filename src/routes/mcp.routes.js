import express from 'express';
import { mcpIntegrationService } from '../services/mcp-integration.service.js';

const router = express.Router();

/**
 * Initialize MCP connections
 * POST /api/mcp/init
 */
router.post('/init', async (req, res) => {
  try {
    await mcpIntegrationService.initializeConnections();
    
    res.json({
      success: true,
      message: 'MCP connections initialized successfully',
      status: mcpIntegrationService.getIntegrationStatus(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to initialize MCP connections',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get MCP integration status
 * GET /api/mcp/status
 */
router.get('/status', (req, res) => {
  try {
    const status = mcpIntegrationService.getIntegrationStatus();
    
    res.json({
      success: true,
      message: 'MCP integration status retrieved',
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get MCP status',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Health check for all MCP connections
 * GET /api/mcp/health
 */
router.get('/health', async (req, res) => {
  try {
    const healthResults = await mcpIntegrationService.healthCheck();
    
    const allHealthy = Object.values(healthResults).every(result => result.healthy);
    
    res.status(allHealthy ? 200 : 503).json({
      success: allHealthy,
      message: allHealthy ? 'All MCP connections healthy' : 'Some MCP connections unhealthy',
      data: healthResults,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'MCP health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Execute MCP request
 * POST /api/mcp/execute
 * Body: { server: string, endpoint: string, params: object }
 */
router.post('/execute', async (req, res) => {
  try {
    const { server, endpoint, params = {} } = req.body;
    
    if (!server || !endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Server and endpoint are required',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await mcpIntegrationService.executeMCPRequest(server, endpoint, params);
    
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'MCP request execution failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Claude Flow specific endpoints
 */

// Get swarm information
router.get('/claude-flow/swarms', async (req, res) => {
  try {
    const result = await mcpIntegrationService.executeMCPRequest('claude-flow', 'swarms');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get agent information  
router.get('/claude-flow/agents', async (req, res) => {
  try {
    const result = await mcpIntegrationService.executeMCPRequest('claude-flow', 'agents');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get performance metrics
router.get('/claude-flow/performance', async (req, res) => {
  try {
    const result = await mcpIntegrationService.executeMCPRequest('claude-flow', 'performance');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Ruv Swarm specific endpoints
 */

// Initialize swarm
router.post('/ruv-swarm/init', async (req, res) => {
  try {
    const { topology = 'hierarchical', maxAgents = 6, strategy = 'adaptive' } = req.body;
    
    const result = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'swarm-init', {
      topology,
      maxAgents,
      strategy
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Spawn agent
router.post('/ruv-swarm/spawn', async (req, res) => {
  try {
    const { type, name, capabilities = [] } = req.body;
    
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Agent type is required',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'agent-spawn', {
      type,
      name,
      capabilities
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Orchestrate task
router.post('/ruv-swarm/orchestrate', async (req, res) => {
  try {
    const { task, strategy = 'adaptive', priority = 'medium', maxAgents = 3 } = req.body;
    
    if (!task) {
      return res.status(400).json({
        success: false,
        message: 'Task description is required',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'task-orchestrate', {
      task,
      strategy,
      priority,
      maxAgents
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * PostgreSQL/NILEDB MCP specific endpoints
 */

// Execute PostgreSQL query through MCP
router.post('/postgresql/query', async (req, res) => {
  try {
    const { sql, values = [] } = req.body;
    
    if (!sql) {
      return res.status(400).json({
        success: false,
        message: 'SQL query is required',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await mcpIntegrationService.executeMCPRequest('niledb-mcp', 'query', {
      sql,
      values
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get PostgreSQL health through MCP
router.get('/postgresql/health', async (req, res) => {
  try {
    const result = await mcpIntegrationService.executeMCPRequest('niledb-mcp', 'health');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get PostgreSQL stats through MCP
router.get('/postgresql/stats', async (req, res) => {
  try {
    const result = await mcpIntegrationService.executeMCPRequest('niledb-mcp', 'stats');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Advanced MCP Operations
 */

// Batch execute multiple MCP requests
router.post('/batch', async (req, res) => {
  try {
    const { requests } = req.body;
    
    if (!Array.isArray(requests)) {
      return res.status(400).json({
        success: false,
        message: 'Requests must be an array',
        timestamp: new Date().toISOString()
      });
    }
    
    const results = await Promise.allSettled(
      requests.map(({ server, endpoint, params }) =>
        mcpIntegrationService.executeMCPRequest(server, endpoint, params)
      )
    );
    
    const responses = results.map((result, index) => ({
      index,
      status: result.status,
      value: result.status === 'fulfilled' ? result.value : null,
      reason: result.status === 'rejected' ? result.reason : null
    }));
    
    res.json({
      success: true,
      message: 'Batch MCP requests completed',
      data: responses,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;