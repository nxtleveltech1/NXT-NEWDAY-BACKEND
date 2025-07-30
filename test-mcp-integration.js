#!/usr/bin/env node

/**
 * MCP Integration Test Script
 * Tests all MCP (Model Context Protocol) server connections and functionality
 * 
 * Usage: node test-mcp-integration.js
 */

import { mcpIntegrationService } from './src/services/mcp-integration.service.js';

async function testMCPIntegration() {
  console.log('🧪 MCP Integration Test Suite');
  console.log('=============================\n');

  try {
    // Initialize MCP connections
    console.log('🔌 Initializing MCP connections...');
    await mcpIntegrationService.initializeConnections();
    console.log('✅ MCP connections initialized successfully\n');

    // Test 1: Get integration status
    console.log('📊 Test 1: Integration Status');
    console.log('-----------------------------');
    const status = mcpIntegrationService.getIntegrationStatus();
    console.log(`Connected servers: ${Object.keys(status.servers).length}`);
    
    Object.entries(status.servers).forEach(([name, server]) => {
      console.log(`  ${name}: ${server.status} (${server.capabilities.length} capabilities)`);
    });
    console.log('');

    // Test 2: Claude Flow MCP
    console.log('🤖 Test 2: Claude Flow MCP');
    console.log('--------------------------');
    
    const swarms = await mcpIntegrationService.executeMCPRequest('claude-flow', 'swarms');
    console.log(`Active swarms: ${swarms.data.active_swarms}, Total agents: ${swarms.data.total_agents}`);
    
    const agents = await mcpIntegrationService.executeMCPRequest('claude-flow', 'agents');
    console.log(`Available agents: ${agents.data.available_agents.join(', ')}`);
    
    const performance = await mcpIntegrationService.executeMCPRequest('claude-flow', 'performance');
    console.log(`Performance speedup: ${performance.data.speedup}, Memory usage: ${performance.data.memory_usage}`);
    console.log('');

    // Test 3: Ruv Swarm MCP
    console.log('🐝 Test 3: Ruv Swarm MCP');
    console.log('-----------------------');
    
    const swarmInit = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'swarm-init', {
      topology: 'hierarchical',
      maxAgents: 6,
      strategy: 'adaptive'
    });
    console.log(`Swarm created: ${swarmInit.data.swarm_id} (${swarmInit.data.status})`);
    
    const agentSpawn = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'agent-spawn', {
      type: 'coordinator',
      name: 'test-coordinator',
      capabilities: ['task_orchestration', 'team_management']
    });
    console.log(`Agent spawned: ${agentSpawn.data.agent_id} (${agentSpawn.data.status})`);
    
    const taskOrchestrate = await mcpIntegrationService.executeMCPRequest('ruv-swarm', 'task-orchestrate', {
      task: 'Test task orchestration for MCP integration',
      strategy: 'adaptive',
      priority: 'medium'
    });
    console.log(`Task orchestrated: ${taskOrchestrate.data.task_id} (${taskOrchestrate.data.status})`);
    console.log('');

    // Test 4: MySQL MCP
    console.log('🗄️ Test 4: MySQL MCP');
    console.log('--------------------');
    
    const mysqlHealth = await mcpIntegrationService.executeMCPRequest('mysql-mcp', 'health');
    console.log(`MySQL health: ${mysqlHealth.data.healthy ? '✅ Healthy' : '❌ Unhealthy'} (Database: ${mysqlHealth.data.database})`);
    
    const mysqlStats = await mcpIntegrationService.executeMCPRequest('mysql-mcp', 'stats');
    console.log(`MySQL stats: Active connections: ${mysqlStats.data.active_connections}, Idle: ${mysqlStats.data.idle_connections}`);
    
    const queryResult = await mcpIntegrationService.executeMCPRequest('mysql-mcp', 'query', {
      sql: 'SELECT DATABASE() as current_db, VERSION() as mysql_version, NOW() as current_time',
      values: []
    });
    if (queryResult.success && queryResult.data.length > 0) {
      const result = queryResult.data[0];
      console.log(`Query test: DB: ${result.current_db}, Version: ${result.mysql_version}`);
    }
    console.log('');

    // Test 5: Health check for all servers
    console.log('🔍 Test 5: Health Check All Servers');
    console.log('----------------------------------');
    const healthResults = await mcpIntegrationService.healthCheck();
    
    Object.entries(healthResults).forEach(([server, health]) => {
      const status = health.healthy ? '✅ Healthy' : '❌ Unhealthy';
      const responseTime = health.responseTime ? `(${health.responseTime}ms)` : '';
      console.log(`  ${server}: ${status} ${responseTime}`);
    });
    console.log('');

    // Test 6: Performance Metrics
    console.log('📊 Test 6: Performance Metrics');
    console.log('------------------------------');
    const finalStatus = mcpIntegrationService.getIntegrationStatus();
    const metrics = finalStatus.metrics;
    console.log(`Total requests: ${metrics.totalRequests}`);
    console.log(`Successful requests: ${metrics.successfulRequests}`);
    console.log(`Failed requests: ${metrics.failedRequests}`);
    console.log(`Average response time: ${metrics.averageResponseTime}ms`);
    console.log('');

    console.log('🎉 All MCP integration tests completed successfully!');
    console.log('✨ MCP services are ready for use in the NXT platform');
    
    // Cleanup
    await mcpIntegrationService.shutdown();
    process.exit(0);

  } catch (error) {
    console.error('❌ MCP Integration Test Failed:', error.message);
    console.error('🔧 Check MCP server configurations and connections');
    process.exit(1);
  }
}

// Handle cleanup on process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Test interrupted, cleaning up...');
  try {
    await mcpIntegrationService.shutdown();
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Test terminated, cleaning up...');
  try {
    await mcpIntegrationService.shutdown();
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
  process.exit(1);
});

// Run the test suite
testMCPIntegration();