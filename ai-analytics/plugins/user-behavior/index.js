const moment = require('moment');
const _ = require('lodash');

class UserBehaviorPlugin {
  constructor({ name, config, eventBus, logger }) {
    this.name = name;
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
    this.sessions = new Map();
    this.userFlows = new Map();
    this.behaviorPatterns = new Map();
    this.isInitialized = false;
    
    this.metrics = {
      sessionsAnalyzed: 0,
      patternsDetected: 0,
      anomaliesFound: 0,
      insightsGenerated: 0
    };
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    try {
      this.logger.info('Initializing User Behavior Plugin');
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Initialize behavior pattern templates
      this.initializeBehaviorPatterns();
      
      // Setup periodic cleanup
      this.setupPeriodicTasks();
      
      this.isInitialized = true;
      this.logger.info('User Behavior Plugin initialized successfully');
      
      // Emit initialization event
      this.eventBus.emit('user-behavior:initialized', {
        plugin: this.name,
        config: this.config
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize User Behavior Plugin:', error);
      throw error;
    }
  }

  /**
   * Process user behavior data
   * @param {Object} data - User behavior data
   */
  async process(data) {
    try {
      if (!this.isInitialized) {
        throw new Error('Plugin not initialized');
      }

      this.logger.debug('Processing user behavior data', {
        dataType: data.type,
        userId: data.userId,
        sessionId: data.sessionId
      });

      const results = {
        sessions: [],
        flows: [],
        insights: [],
        patterns: []
      };

      // Process based on data type
      switch (data.type) {
        case 'session':
          results.sessions = await this.processSessionData(data);
          break;
        case 'event':
          results.patterns = await this.processEventData(data);
          break;
        case 'flow':
          results.flows = await this.processFlowData(data);
          break;
        case 'batch':
          // Process multiple data types
          for (const item of data.items) {
            const itemResults = await this.process(item);
            this.mergeResults(results, itemResults);
          }
          break;
        default:
          // Auto-detect data type and process
          results = await this.autoProcessData(data);
      }

      // Generate insights from processed data
      const insights = await this.generateInsights(results);
      results.insights = insights;

      // Update metrics
      this.updateMetrics(results);

      // Emit events for different result types
      this.emitResultEvents(results);

      this.logger.debug('User behavior processing completed', {
        sessions: results.sessions.length,
        flows: results.flows.length,
        insights: results.insights.length,
        patterns: results.patterns.length
      });

      return results;

    } catch (error) {
      this.logger.error('Error processing user behavior data:', error);
      throw error;
    }
  }

  /**
   * Process session data
   * @param {Object} data - Session data
   */
  async processSessionData(data) {
    const sessions = [];
    
    try {
      const sessionData = Array.isArray(data.sessions) ? data.sessions : [data];
      
      for (const session of sessionData) {
        const analysis = await this.analyzeSession(session);
        sessions.push(analysis);
        
        // Store session for flow analysis
        this.sessions.set(session.sessionId, analysis);
      }
      
      this.metrics.sessionsAnalyzed += sessions.length;
      
    } catch (error) {
      this.logger.error('Error processing session data:', error);
    }
    
    return sessions;
  }

  /**
   * Analyze individual session
   * @param {Object} session - Session data
   */
  async analyzeSession(session) {
    const analysis = {
      sessionId: session.sessionId,
      userId: session.userId,
      startTime: moment(session.startTime),
      endTime: moment(session.endTime),
      duration: 0,
      pageViews: 0,
      actions: [],
      bounced: false,
      engagement: {
        score: 0,
        level: 'low'
      },
      patterns: [],
      anomalies: []
    };

    try {
      // Calculate session duration
      if (session.endTime) {
        analysis.duration = analysis.endTime.diff(analysis.startTime, 'seconds');
      }

      // Process events/actions
      if (session.events && Array.isArray(session.events)) {
        analysis.actions = session.events;
        analysis.pageViews = session.events.filter(e => e.type === 'pageview').length;
      }

      // Determine if bounced
      analysis.bounced = analysis.pageViews <= 1 && analysis.duration < this.config.minSessionDuration;

      // Calculate engagement score
      analysis.engagement = this.calculateEngagementScore(analysis);

      // Detect patterns
      analysis.patterns = this.detectSessionPatterns(analysis);

      // Check for anomalies
      analysis.anomalies = this.detectSessionAnomalies(analysis);

      // Emit session events
      this.eventBus.emit('user-behavior:session-analyzed', analysis);

      if (analysis.anomalies.length > 0) {
        this.eventBus.emit('user-behavior:anomaly-found', {
          type: 'session',
          sessionId: session.sessionId,
          anomalies: analysis.anomalies
        });
      }

    } catch (error) {
      this.logger.error(`Error analyzing session ${session.sessionId}:`, error);
    }

    return analysis;
  }

  /**
   * Process event data for pattern detection
   * @param {Object} data - Event data
   */
  async processEventData(data) {
    const patterns = [];
    
    try {
      const events = Array.isArray(data.events) ? data.events : [data];
      
      // Group events by type and time windows
      const eventGroups = this.groupEventsByPattern(events);
      
      for (const [patternType, groupedEvents] of Object.entries(eventGroups)) {
        const patternAnalysis = this.analyzeEventPattern(patternType, groupedEvents);
        if (patternAnalysis) {
          patterns.push(patternAnalysis);
        }
      }
      
      this.metrics.patternsDetected += patterns.length;
      
    } catch (error) {
      this.logger.error('Error processing event data:', error);
    }
    
    return patterns;
  }

  /**
   * Process flow data
   * @param {Object} data - Flow data
   */
  async processFlowData(data) {
    const flows = [];
    
    try {
      const flowData = Array.isArray(data.flows) ? data.flows : [data];
      
      for (const flow of flowData) {
        const analysis = await this.analyzeUserFlow(flow);
        flows.push(analysis);
        
        // Store flow for pattern analysis
        this.userFlows.set(flow.flowId || `flow_${Date.now()}`, analysis);
      }
      
    } catch (error) {
      this.logger.error('Error processing flow data:', error);
    }
    
    return flows;
  }

  /**
   * Analyze user flow
   * @param {Object} flow - Flow data
   */
  async analyzeUserFlow(flow) {
    const analysis = {
      flowId: flow.flowId,
      userId: flow.userId,
      steps: flow.steps || [],
      completionRate: 0,
      dropoffPoints: [],
      conversionFunnel: {},
      timeToComplete: 0,
      patterns: []
    };

    try {
      if (analysis.steps.length > 0) {
        // Calculate completion rate
        const completedSteps = analysis.steps.filter(step => step.completed).length;
        analysis.completionRate = completedSteps / analysis.steps.length;

        // Identify drop-off points
        analysis.dropoffPoints = this.identifyDropoffPoints(analysis.steps);

        // Analyze conversion funnel
        analysis.conversionFunnel = this.analyzeConversionFunnel(analysis.steps);

        // Calculate time to complete
        if (flow.startTime && flow.endTime) {
          analysis.timeToComplete = moment(flow.endTime).diff(moment(flow.startTime), 'seconds');
        }

        // Detect flow patterns
        analysis.patterns = this.detectFlowPatterns(analysis);
      }

      // Emit flow events
      this.eventBus.emit('user-behavior:flow-analyzed', analysis);

      if (analysis.dropoffPoints.length > 0) {
        this.eventBus.emit('user-behavior:dropoff-detected', {
          flowId: analysis.flowId,
          dropoffPoints: analysis.dropoffPoints
        });
      }

    } catch (error) {
      this.logger.error(`Error analyzing user flow ${flow.flowId}:`, error);
    }

    return analysis;
  }

  /**
   * Generate AI insights from processed data
   * @param {Object} results - Processed results
   */
  async generateInsights(results) {
    const insights = [];

    try {
      // Session insights
      if (results.sessions && results.sessions.length > 0) {
        const sessionInsights = this.generateSessionInsights(results.sessions);
        insights.push(...sessionInsights);
      }

      // Flow insights
      if (results.flows && results.flows.length > 0) {
        const flowInsights = this.generateFlowInsights(results.flows);
        insights.push(...flowInsights);
      }

      // Pattern insights
      if (results.patterns && results.patterns.length > 0) {
        const patternInsights = this.generatePatternInsights(results.patterns);
        insights.push(...patternInsights);
      }

      // Cross-analysis insights
      const crossInsights = this.generateCrossAnalysisInsights(results);
      insights.push(...crossInsights);

      this.metrics.insightsGenerated += insights.length;

      // Emit insight events
      for (const insight of insights) {
        this.eventBus.emit('user-behavior:insight-generated', insight);
      }

    } catch (error) {
      this.logger.error('Error generating insights:', error);
    }

    return insights;
  }

  /**
   * Calculate engagement score for a session
   * @param {Object} session - Session analysis
   */
  calculateEngagementScore(session) {
    let score = 0;
    let level = 'low';

    try {
      // Duration factor (0-30 points)
      const durationMinutes = session.duration / 60;
      score += Math.min(30, durationMinutes * 2);

      // Page views factor (0-25 points)
      score += Math.min(25, session.pageViews * 5);

      // Actions factor (0-25 points)
      const actionCount = session.actions.filter(a => a.type !== 'pageview').length;
      score += Math.min(25, actionCount * 3);

      // Interaction depth factor (0-20 points)
      const uniqueTypes = new Set(session.actions.map(a => a.type)).size;
      score += Math.min(20, uniqueTypes * 4);

      // Determine engagement level
      if (score >= 80) level = 'very-high';
      else if (score >= 60) level = 'high';
      else if (score >= 40) level = 'medium';
      else if (score >= 20) level = 'low';
      else level = 'very-low';

    } catch (error) {
      this.logger.error('Error calculating engagement score:', error);
    }

    return { score: Math.round(score), level };
  }

  /**
   * Detect session patterns
   * @param {Object} session - Session analysis
   */
  detectSessionPatterns(session) {
    const patterns = [];

    try {
      // Quick exit pattern
      if (session.duration < 30 && session.pageViews === 1) {
        patterns.push({
          type: 'quick-exit',
          confidence: 0.9,
          description: 'User left quickly after landing'
        });
      }

      // Deep engagement pattern
      if (session.duration > 300 && session.pageViews > 5) {
        patterns.push({
          type: 'deep-engagement',
          confidence: 0.8,
          description: 'User showed deep engagement with content'
        });
      }

      // Search behavior pattern
      const searchActions = session.actions.filter(a => a.type === 'search');
      if (searchActions.length > 3) {
        patterns.push({
          type: 'search-heavy',
          confidence: 0.7,
          description: 'User exhibited search-heavy behavior'
        });
      }

      // Form interaction pattern
      const formActions = session.actions.filter(a => a.type === 'form');
      if (formActions.length > 0) {
        patterns.push({
          type: 'form-interaction',
          confidence: 0.6,
          description: 'User interacted with forms'
        });
      }

    } catch (error) {
      this.logger.error('Error detecting session patterns:', error);
    }

    return patterns;
  }

  /**
   * Detect session anomalies
   * @param {Object} session - Session analysis
   */
  detectSessionAnomalies(session) {
    const anomalies = [];

    try {
      // Unusually long session
      if (session.duration > 7200) { // 2 hours
        anomalies.push({
          type: 'long-session',
          severity: 'medium',
          description: 'Unusually long session duration',
          value: session.duration
        });
      }

      // High page views with short duration
      if (session.pageViews > 20 && session.duration < 60) {
        anomalies.push({
          type: 'rapid-browsing',
          severity: 'high',
          description: 'Very high page views in short time',
          value: { pageViews: session.pageViews, duration: session.duration }
        });
      }

      // No interactions but long duration
      if (session.duration > 600 && session.actions.length <= 1) {
        anomalies.push({
          type: 'passive-session',
          severity: 'low',
          description: 'Long duration with minimal interactions',
          value: { duration: session.duration, actions: session.actions.length }
        });
      }

    } catch (error) {
      this.logger.error('Error detecting session anomalies:', error);
    }

    return anomalies;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.eventBus.on('data:received', async (data) => {
      if (data.type === 'user-behavior' || data.type === 'session' || data.type === 'event') {
        try {
          await this.process(data.payload);
        } catch (error) {
          this.logger.error('Error processing received data:', error);
        }
      }
    });
  }

  /**
   * Initialize behavior pattern templates
   */
  initializeBehaviorPatterns() {
    this.behaviorPatterns.set('engagement', {
      patterns: ['quick-exit', 'deep-engagement', 'browse-and-leave'],
      thresholds: {
        engagement: this.config.alerts.lowEngagement,
        bounce: this.config.alerts.highBounceRate
      }
    });

    this.behaviorPatterns.set('conversion', {
      patterns: ['funnel-completion', 'funnel-dropout', 'conversion-path'],
      steps: this.config.funnelSteps
    });
  }

  /**
   * Setup periodic tasks
   */
  setupPeriodicTasks() {
    // Clean up old sessions every hour
    setInterval(() => {
      this.cleanupOldSessions();
    }, 60 * 60 * 1000);

    // Generate periodic reports every 6 hours
    setInterval(() => {
      this.generatePeriodicReport();
    }, 6 * 60 * 60 * 1000);
  }

  /**
   * Get plugin metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeSessions: this.sessions.size,
      activeFlows: this.userFlows.size,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get plugin health status
   */
  getHealth() {
    return {
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      metrics: this.getMetrics(),
      config: this.config,
      lastProcessed: this.lastProcessed || null
    };
  }

  /**
   * Update plugin configuration
   * @param {Object} newConfig - New configuration
   */
  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('User Behavior Plugin configuration updated', { newConfig });
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    this.logger.info('Destroying User Behavior Plugin');
    
    // Clear data structures
    this.sessions.clear();
    this.userFlows.clear();
    this.behaviorPatterns.clear();
    
    this.isInitialized = false;
    this.logger.info('User Behavior Plugin destroyed');
  }

  // Helper methods (implementation would be more detailed in practice)

  autoProcessData(data) {
    // Auto-detect data type and process accordingly
    return { sessions: [], flows: [], insights: [], patterns: [] };
  }

  mergeResults(target, source) {
    target.sessions.push(...(source.sessions || []));
    target.flows.push(...(source.flows || []));
    target.insights.push(...(source.insights || []));
    target.patterns.push(...(source.patterns || []));
  }

  groupEventsByPattern(events) {
    return _.groupBy(events, 'type');
  }

  analyzeEventPattern(patternType, events) {
    return {
      type: patternType,
      count: events.length,
      pattern: 'analyzed_pattern'
    };
  }

  identifyDropoffPoints(steps) {
    return steps.filter((step, index) => 
      !step.completed && index < steps.length - 1
    );
  }

  analyzeConversionFunnel(steps) {
    return {
      totalSteps: steps.length,
      completedSteps: steps.filter(s => s.completed).length
    };
  }

  detectFlowPatterns(flow) {
    return [];
  }

  generateSessionInsights(sessions) {
    return [
      {
        type: 'session-summary',
        message: `Analyzed ${sessions.length} user sessions`,
        data: { count: sessions.length }
      }
    ];
  }

  generateFlowInsights(flows) {
    return [
      {
        type: 'flow-summary',
        message: `Analyzed ${flows.length} user flows`,
        data: { count: flows.length }
      }
    ];
  }

  generatePatternInsights(patterns) {
    return [
      {
        type: 'pattern-summary',
        message: `Detected ${patterns.length} behavior patterns`,
        data: { count: patterns.length }
      }
    ];
  }

  generateCrossAnalysisInsights(results) {
    return [];
  }

  updateMetrics(results) {
    // Update metrics based on results
    this.lastProcessed = new Date();
  }

  emitResultEvents(results) {
    if (results.sessions.length > 0) {
      this.eventBus.emit('user-behavior:sessions-processed', results.sessions);
    }
    if (results.flows.length > 0) {
      this.eventBus.emit('user-behavior:flows-processed', results.flows);
    }
    if (results.patterns.length > 0) {
      this.eventBus.emit('user-behavior:patterns-detected', results.patterns);
    }
  }

  cleanupOldSessions() {
    const cutoff = moment().subtract(24, 'hours');
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.startTime.isBefore(cutoff)) {
        this.sessions.delete(sessionId);
      }
    }
  }

  generatePeriodicReport() {
    const report = {
      timestamp: new Date(),
      metrics: this.getMetrics(),
      summary: 'Periodic user behavior report generated'
    };
    
    this.eventBus.emit('user-behavior:periodic-report', report);
  }
}

module.exports = UserBehaviorPlugin;