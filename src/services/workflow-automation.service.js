/**
 * Workflow Automation Service
 * 
 * Handles automated workflows for supply chain operations:
 * - Price list upload notifications and triggers
 * - Price comparison alerts and approval processes  
 * - Auto-update product costs with validation
 * - Price change reports and notifications
 * - Workflow state management and tracking
 */

import { db } from '../db/index.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems,
  products, 
  inventory,
  timeSeriesEvents,
  timeSeriesMetrics
} from '../db/schema.js';
import { eq, and, desc, gte, lte, isNull, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { EventEmitter } from 'events';

class WorkflowAutomationService extends EventEmitter {
  constructor() {
    super();
    this.activeWorkflows = new Map();
    this.workflowRules = new Map();
    this.notificationQueue = [];
    this.isProcessing = false;
    
    // Initialize default workflow rules
    this.initializeDefaultRules();
  }

  // ==================== WORKFLOW INITIALIZATION ====================

  /**
   * Initialize default workflow rules
   */
  initializeDefaultRules() {
    // Price change approval rules
    this.addWorkflowRule('price_change_approval', {
      triggers: ['price_list_uploaded'],
      conditions: {
        priceChangeThreshold: 20, // Percentage
        requireApproval: true,
        autoApproveThreshold: 5 // Auto-approve changes under 5%
      },
      actions: ['validate_prices', 'check_thresholds', 'send_notifications', 'update_status'],
      approvers: ['price_manager', 'supply_chain_manager'],
      escalationTime: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Inventory reorder workflow
    this.addWorkflowRule('inventory_reorder', {
      triggers: ['price_update_completed', 'inventory_low_stock'],
      conditions: {
        reorderPointReached: true,
        supplierActive: true,
        autoReorderEnabled: true
      },
      actions: ['calculate_reorder_quantity', 'create_purchase_order', 'send_to_supplier'],
      approvers: ['inventory_manager'],
      escalationTime: 4 * 60 * 60 * 1000 // 4 hours
    });

    // Cost variance analysis
    this.addWorkflowRule('cost_variance_analysis', {
      triggers: ['price_list_processed'],
      conditions: {
        varianceThreshold: 15, // Percentage
        requireAnalysis: true
      },
      actions: ['calculate_variance', 'generate_report', 'notify_stakeholders'],
      approvers: ['finance_manager', 'procurement_manager'],
      escalationTime: 12 * 60 * 60 * 1000 // 12 hours
    });
  }

  /**
   * Add or update workflow rule
   */
  addWorkflowRule(ruleName, rule) {
    this.workflowRules.set(ruleName, {
      ...rule,
      createdAt: new Date(),
      isActive: true
    });
  }

  // ==================== PRICE LIST WORKFLOWS ====================

  /**
   * Process price list upload workflow
   */
  async processPriceListUploadWorkflow(priceListId, options = {}) {
    const workflowId = `price_upload_${priceListId}_${Date.now()}`;
    
    try {
      // Initialize workflow
      const workflow = await this.initializeWorkflow(workflowId, 'price_list_upload', {
        priceListId,
        triggeredBy: options.userId || 'system',
        options
      });

      // Get price list data
      const priceList = await db.select()
        .from(priceLists)
        .where(eq(priceLists.id, priceListId))
        .limit(1);

      if (!priceList.length) {
        throw new Error(`Price list ${priceListId} not found`);
      }

      const priceListData = priceList[0];

      // Step 1: Validate price list
      const validationResult = await this.validatePriceList(priceListId);
      await this.updateWorkflowStep(workflowId, 'validation', validationResult);

      if (!validationResult.success) {
        await this.failWorkflow(workflowId, 'Price list validation failed', validationResult.errors);
        return { success: false, errors: validationResult.errors };
      }

      // Step 2: Analyze price changes
      const priceAnalysis = await this.analyzePriceChanges(priceListId, options);
      await this.updateWorkflowStep(workflowId, 'price_analysis', priceAnalysis);

      // Step 3: Check approval requirements
      const approvalRequired = await this.checkApprovalRequirements(priceAnalysis, options);
      await this.updateWorkflowStep(workflowId, 'approval_check', { approvalRequired });

      if (approvalRequired && !options.autoApprove) {
        // Workflow requires approval - pause and send notifications
        await this.pauseWorkflowForApproval(workflowId, priceAnalysis);
        return {
          success: true,
          status: 'pending_approval',
          workflowId,
          approvalRequired: true,
          priceAnalysis
        };
      }

      // Step 4: Apply price changes
      const updateResult = await this.applyPriceChanges(priceListId, priceAnalysis, options);
      await this.updateWorkflowStep(workflowId, 'price_update', updateResult);

      // Step 5: Generate reports and notifications
      const notificationResult = await this.sendPriceChangeNotifications(priceListData, priceAnalysis);
      await this.updateWorkflowStep(workflowId, 'notifications', notificationResult);

      // Step 6: Trigger downstream workflows
      if (options.triggerReorderWorkflow !== false) {
        await this.triggerReorderWorkflow(priceListData.supplierId, updateResult);
      }

      // Complete workflow
      await this.completeWorkflow(workflowId, {
        priceAnalysis,
        updateResult,
        notificationResult
      });

      return {
        success: true,
        status: 'completed',
        workflowId,
        priceAnalysis,
        updateResult,
        notificationResult
      };

    } catch (error) {
      await this.failWorkflow(workflowId, error.message, { error: error.stack });
      throw error;
    }
  }

  /**
   * Validate price list data
   */
  async validatePriceList(priceListId) {
    const errors = [];
    const warnings = [];

    try {
      // Get price list items
      const items = await db.select()
        .from(priceListItems)
        .where(eq(priceListItems.priceListId, priceListId));

      if (items.length === 0) {
        errors.push('Price list contains no items');
        return { success: false, errors, warnings };
      }

      // Validate each item
      for (const item of items) {
        // Check required fields
        if (!item.sku || !item.unitPrice) {
          errors.push(`Item missing required fields: SKU=${item.sku}, Price=${item.unitPrice}`);
          continue;
        }

        // Check price validity
        if (item.unitPrice <= 0) {
          errors.push(`Invalid price for SKU ${item.sku}: ${item.unitPrice}`);
        }

        // Check SKU format (basic validation)
        if (item.sku.length < 3) {
          warnings.push(`Short SKU detected: ${item.sku}`);
        }

        // Check for extremely high prices (potential data entry errors)
        if (item.unitPrice > 10000) {
          warnings.push(`High price detected for SKU ${item.sku}: $${item.unitPrice}`);
        }
      }

      // Check for duplicate SKUs
      const skuCounts = items.reduce((acc, item) => {
        acc[item.sku] = (acc[item.sku] || 0) + 1;
        return acc;
      }, {});

      const duplicates = Object.entries(skuCounts)
        .filter(([_, count]) => count > 1)
        .map(([sku, count]) => sku);

      if (duplicates.length > 0) {
        errors.push(`Duplicate SKUs found: ${duplicates.join(', ')}`);
      }

      return {
        success: errors.length === 0,
        errors,
        warnings,
        itemCount: items.length,
        duplicateCount: duplicates.length
      };

    } catch (error) {
      return {
        success: false,
        errors: [`Validation error: ${error.message}`],
        warnings
      };
    }
  }

  /**
   * Analyze price changes and their impact
   */
  async analyzePriceChanges(priceListId, options = {}) {
    try {
      // Get price list data
      const [priceList] = await db.select()
        .from(priceLists)
        .where(eq(priceLists.id, priceListId))
        .limit(1);

      const items = await db.select()
        .from(priceListItems)
        .where(eq(priceListItems.priceListId, priceListId));

      const analysis = {
        totalItems: items.length,
        priceChanges: [],
        summary: {
          increases: 0,
          decreases: 0,
          noChange: 0,
          newItems: 0,
          significantChanges: 0
        },
        financialImpact: {
          totalCostImpact: 0,
          avgPriceChange: 0,
          maxIncrease: 0,
          maxDecrease: 0
        }
      };

      for (const item of items) {
        // Find existing product
        const existingProduct = await db.select()
          .from(products)
          .where(and(
            eq(products.sku, item.sku),
            eq(products.supplierId, priceList.supplierId)
          ))
          .limit(1);

        let changeData;

        if (existingProduct.length > 0) {
          const product = existingProduct[0];
          const oldPrice = parseFloat(product.costPrice);
          const newPrice = parseFloat(item.unitPrice);
          const change = newPrice - oldPrice;
          const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;

          changeData = {
            sku: item.sku,
            productId: product.id,
            oldPrice,
            newPrice,
            change,
            changePercent: Math.round(changePercent * 100) / 100,
            type: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'no_change',
            isSignificant: Math.abs(changePercent) > (options.significantChangeThreshold || 10)
          };

          // Update summary
          if (change > 0) analysis.summary.increases++;
          else if (change < 0) analysis.summary.decreases++;
          else analysis.summary.noChange++;

          if (changeData.isSignificant) analysis.summary.significantChanges++;

          // Update financial impact
          analysis.financialImpact.totalCostImpact += change;
          if (changePercent > analysis.financialImpact.maxIncrease) {
            analysis.financialImpact.maxIncrease = changePercent;
          }
          if (changePercent < analysis.financialImpact.maxDecrease) {
            analysis.financialImpact.maxDecrease = changePercent;
          }

        } else {
          // New item
          changeData = {
            sku: item.sku,
            productId: null,
            oldPrice: 0,
            newPrice: parseFloat(item.unitPrice),
            change: parseFloat(item.unitPrice),
            changePercent: 0,
            type: 'new',
            isSignificant: true // New items are always significant
          };

          analysis.summary.newItems++;
          analysis.summary.significantChanges++;
        }

        analysis.priceChanges.push(changeData);
      }

      // Calculate average price change
      const totalChanges = analysis.priceChanges
        .filter(c => c.type !== 'new' && c.type !== 'no_change');
      
      if (totalChanges.length > 0) {
        analysis.financialImpact.avgPriceChange = 
          Math.round((totalChanges.reduce((sum, c) => sum + c.changePercent, 0) / totalChanges.length) * 100) / 100;
      }

      return analysis;

    } catch (error) {
      throw new Error(`Price analysis failed: ${error.message}`);
    }
  }

  /**
   * Check if approval is required based on analysis
   */
  async checkApprovalRequirements(priceAnalysis, options = {}) {
    const rules = this.workflowRules.get('price_change_approval');
    if (!rules) return false;

    // Check for significant price changes
    const significantChanges = priceAnalysis.summary.significantChanges;
    const totalItems = priceAnalysis.totalItems;
    const significantPercentage = (significantChanges / totalItems) * 100;

    // Approval required if:
    // 1. More than threshold percentage of items have significant changes
    // 2. Any single item has a change greater than auto-approve threshold
    // 3. Total financial impact exceeds threshold

    const maxChange = Math.max(
      Math.abs(priceAnalysis.financialImpact.maxIncrease),
      Math.abs(priceAnalysis.financialImpact.maxDecrease)
    );

    return (
      significantPercentage > rules.conditions.priceChangeThreshold ||
      maxChange > rules.conditions.autoApproveThreshold ||
      Math.abs(priceAnalysis.financialImpact.totalCostImpact) > (options.financialThreshold || 10000)
    );
  }

  /**
   * Apply approved price changes
   */
  async applyPriceChanges(priceListId, priceAnalysis, options = {}) {
    const results = {
      updated: 0,
      created: 0,
      errors: [],
      warnings: []
    };

    try {
      await db.transaction(async (tx) => {
        for (const change of priceAnalysis.priceChanges) {
          try {
            if (change.type === 'new') {
              // Create new product
              const [newProduct] = await tx.insert(products)
                .values({
                  sku: change.sku,
                  name: change.sku, // Default name, can be updated later
                  costPrice: change.newPrice,
                  unitPrice: change.newPrice * (options.defaultMarkup || 1.3),
                  supplierId: priceAnalysis.supplierId,
                  isActive: true,
                  metadata: {
                    source: 'price_list_workflow',
                    priceListId,
                    createdAt: new Date()
                  }
                })
                .returning();
              
              results.created++;
              change.productId = newProduct.id;

            } else if (change.type !== 'no_change') {
              // Update existing product
              await tx.update(products)
                .set({
                  costPrice: change.newPrice,
                  updatedAt: new Date()
                })
                .where(eq(products.id, change.productId));
              
              results.updated++;
            }

          } catch (error) {
            results.errors.push({
              sku: change.sku,
              error: error.message
            });
          }
        }
      });

      // Log the price update completion
      await this.logEvent('price_changes_applied', {
        priceListId,
        results,
        analysis: priceAnalysis
      });

      return results;

    } catch (error) {
      throw new Error(`Failed to apply price changes: ${error.message}`);
    }
  }

  /**
   * Send price change notifications
   */
  async sendPriceChangeNotifications(priceList, priceAnalysis) {
    const notifications = [];

    try {
      // Notify stakeholders about significant changes
      if (priceAnalysis.summary.significantChanges > 0) {
        notifications.push({
          type: 'price_change_alert',
          recipients: ['procurement_team', 'finance_team'],
          subject: `Significant Price Changes - ${priceList.name}`,
          data: {
            supplierName: priceList.supplierName,
            significantChanges: priceAnalysis.summary.significantChanges,
            totalItems: priceAnalysis.totalItems,
            maxIncrease: priceAnalysis.financialImpact.maxIncrease,
            maxDecrease: priceAnalysis.financialImpact.maxDecrease,
            totalCostImpact: priceAnalysis.financialImpact.totalCostImpact
          },
          priority: 'high',
          scheduledFor: new Date()
        });
      }

      // Notify about new products
      if (priceAnalysis.summary.newItems > 0) {
        notifications.push({
          type: 'new_products_added',
          recipients: ['inventory_team', 'sales_team'],
          subject: `New Products Added - ${priceList.name}`,
          data: {
            supplierName: priceList.supplierName,
            newItemCount: priceAnalysis.summary.newItems,
            newItems: priceAnalysis.priceChanges
              .filter(c => c.type === 'new')
              .slice(0, 10) // First 10 new items
          },
          priority: 'medium',
          scheduledFor: new Date()
        });
      }

      // Queue notifications for processing
      this.notificationQueue.push(...notifications);
      
      // Process notifications if not already processing
      if (!this.isProcessing) {
        this.processNotificationQueue();
      }

      return {
        sent: notifications.length,
        queued: this.notificationQueue.length,
        notifications: notifications.map(n => ({
          type: n.type,
          recipients: n.recipients,
          priority: n.priority
        }))
      };

    } catch (error) {
      throw new Error(`Failed to send notifications: ${error.message}`);
    }
  }

  /**
   * Trigger reorder workflow after price updates
   */
  async triggerReorderWorkflow(supplierId, updateResult) {
    try {
      // Import the supply chain integration service
      const { supplyChainIntegrationService } = await import('./supply-chain-integration.service.js');
      
      // Generate reorder suggestions
      const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(supplierId);

      if (suggestions.suggestions.length > 0) {
        // Log reorder trigger
        await this.logEvent('reorder_workflow_triggered', {
          supplierId,
          suggestionCount: suggestions.suggestions.length,
          totalValue: suggestions.totalValue,
          triggeredBy: 'price_update_workflow'
        });

        // Emit event for other services to handle
        this.emit('reorderWorkflowTriggered', {
          supplierId,
          suggestions,
          source: 'price_update'
        });
      }

      return suggestions;

    } catch (error) {
      console.error('Failed to trigger reorder workflow:', error);
      // Don't throw error - this is not critical for price update workflow
      return { suggestions: [], error: error.message };
    }
  }

  // ==================== APPROVAL WORKFLOWS ====================

  /**
   * Pause workflow for approval
   */
  async pauseWorkflowForApproval(workflowId, analysis) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    workflow.status = 'pending_approval';
    workflow.pausedAt = new Date();
    workflow.approvalData = analysis;

    // Send approval request notifications
    await this.sendApprovalRequest(workflowId, analysis);

    // Set escalation timer
    setTimeout(() => {
      this.handleApprovalEscalation(workflowId);
    }, this.workflowRules.get('price_change_approval').escalationTime);

    await this.logEvent('workflow_paused_for_approval', {
      workflowId,
      significantChanges: analysis.summary.significantChanges,
      totalCostImpact: analysis.financialImpact.totalCostImpact
    });
  }

  /**
   * Approve workflow and continue processing
   */
  async approveWorkflow(workflowId, approvedBy, comments = '') {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    if (workflow.status !== 'pending_approval') {
      throw new Error(`Workflow ${workflowId} is not pending approval`);
    }

    workflow.status = 'approved';
    workflow.approvedBy = approvedBy;
    workflow.approvedAt = new Date();
    workflow.approvalComments = comments;

    await this.logEvent('workflow_approved', {
      workflowId,
      approvedBy,
      comments
    });

    // Continue workflow processing
    if (workflow.type === 'price_list_upload') {
      await this.continueApprovedPriceListWorkflow(workflowId);
    }

    return { success: true, status: 'approved' };
  }

  /**
   * Reject workflow
   */
  async rejectWorkflow(workflowId, rejectedBy, reason = '') {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    workflow.status = 'rejected';
    workflow.rejectedBy = rejectedBy;
    workflow.rejectedAt = new Date();
    workflow.rejectionReason = reason;

    await this.logEvent('workflow_rejected', {
      workflowId,
      rejectedBy,
      reason
    });

    // Clean up workflow
    this.activeWorkflows.delete(workflowId);

    return { success: true, status: 'rejected' };
  }

  /**
   * Continue processing approved price list workflow
   */
  async continueApprovedPriceListWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    const { priceListId, options } = workflow.data;
    const { approvalData } = workflow;

    try {
      // Apply price changes
      const updateResult = await this.applyPriceChanges(priceListId, approvalData, options);
      await this.updateWorkflowStep(workflowId, 'price_update', updateResult);

      // Send notifications
      const priceList = await db.select()
        .from(priceLists)
        .where(eq(priceLists.id, priceListId))
        .limit(1);

      const notificationResult = await this.sendPriceChangeNotifications(priceList[0], approvalData);
      await this.updateWorkflowStep(workflowId, 'notifications', notificationResult);

      // Trigger reorder workflow
      if (options.triggerReorderWorkflow !== false) {
        await this.triggerReorderWorkflow(priceList[0].supplierId, updateResult);
      }

      // Complete workflow
      await this.completeWorkflow(workflowId, {
        approvalData,
        updateResult,
        notificationResult
      });

    } catch (error) {
      await this.failWorkflow(workflowId, error.message, { error: error.stack });
      throw error;
    }
  }

  // ==================== WORKFLOW MANAGEMENT ====================

  /**
   * Initialize a new workflow
   */
  async initializeWorkflow(workflowId, type, data) {
    const workflow = {
      id: workflowId,
      type,
      status: 'running',
      data,
      steps: new Map(),
      startedAt: new Date(),
      updatedAt: new Date()
    };

    this.activeWorkflows.set(workflowId, workflow);

    await this.logEvent('workflow_initialized', {
      workflowId,
      type,
      data
    });

    return workflow;
  }

  /**
   * Update workflow step
   */
  async updateWorkflowStep(workflowId, stepName, result) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    workflow.steps.set(stepName, {
      result,
      completedAt: new Date()
    });
    workflow.updatedAt = new Date();

    await this.logEvent('workflow_step_completed', {
      workflowId,
      stepName,
      result: typeof result === 'object' ? JSON.stringify(result) : result
    });
  }

  /**
   * Complete workflow
   */
  async completeWorkflow(workflowId, finalResult) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    workflow.status = 'completed';
    workflow.completedAt = new Date();
    workflow.finalResult = finalResult;

    await this.logEvent('workflow_completed', {
      workflowId,
      duration: workflow.completedAt - workflow.startedAt,
      finalResult
    });

    // Clean up after some time
    setTimeout(() => {
      this.activeWorkflows.delete(workflowId);
    }, 60 * 60 * 1000); // Keep for 1 hour

    this.emit('workflowCompleted', { workflowId, workflow, result: finalResult });
  }

  /**
   * Fail workflow
   */
  async failWorkflow(workflowId, error, details = {}) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (workflow) {
      workflow.status = 'failed';
      workflow.failedAt = new Date();
      workflow.error = error;
      workflow.errorDetails = details;
    }

    await this.logEvent('workflow_failed', {
      workflowId,
      error,
      details
    });

    this.emit('workflowFailed', { workflowId, error, details });
  }

  // ==================== NOTIFICATION PROCESSING ====================

  /**
   * Process notification queue
   */
  async processNotificationQueue() {
    if (this.isProcessing || this.notificationQueue.length === 0) return;

    this.isProcessing = true;

    try {
      while (this.notificationQueue.length > 0) {
        const notification = this.notificationQueue.shift();
        await this.processNotification(notification);
      }
    } catch (error) {
      console.error('Notification processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process individual notification
   */
  async processNotification(notification) {
    try {
      // In a real implementation, this would integrate with email service,
      // Slack, Teams, or other notification systems
      
      console.log(`Sending notification: ${notification.type}`);
      console.log(`Recipients: ${notification.recipients.join(', ')}`);
      console.log(`Subject: ${notification.subject}`);
      console.log(`Priority: ${notification.priority}`);

      // Log notification
      await this.logEvent('notification_sent', {
        type: notification.type,
        recipients: notification.recipients,
        subject: notification.subject,
        priority: notification.priority
      });

      // Emit event for external notification handlers
      this.emit('notificationSent', notification);

    } catch (error) {
      console.error('Failed to send notification:', error);
      
      await this.logEvent('notification_failed', {
        type: notification.type,
        error: error.message,
        notification
      });
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) return null;

    return {
      id: workflow.id,
      type: workflow.type,
      status: workflow.status,
      startedAt: workflow.startedAt,
      updatedAt: workflow.updatedAt,
      completedAt: workflow.completedAt,
      steps: Array.from(workflow.steps.entries()).map(([name, step]) => ({
        name,
        completedAt: step.completedAt,
        success: step.result?.success !== false
      }))
    };
  }

  /**
   * Get active workflows
   */
  getActiveWorkflows() {
    return Array.from(this.activeWorkflows.values()).map(workflow => ({
      id: workflow.id,
      type: workflow.type,
      status: workflow.status,
      startedAt: workflow.startedAt,
      updatedAt: workflow.updatedAt
    }));
  }

  /**
   * Log workflow event
   */
  async logEvent(eventType, data) {
    try {
      await db.insert(timeSeriesEvents)
        .values({
          timestamp: new Date(),
          eventType,
          eventCategory: 'workflow',
          entityType: 'workflow_automation',
          entityId: data.workflowId,
          action: eventType,
          properties: data,
          metadata: {
            source: 'workflow_automation_service',
            version: '1.0'
          },
          resultStatus: data.error ? 'error' : 'success'
        });
    } catch (error) {
      console.error('Failed to log workflow event:', error);
    }
  }

  /**
   * Send approval request (placeholder)
   */
  async sendApprovalRequest(workflowId, analysis) {
    // In a real implementation, this would send approval requests
    // via email, workflow management system, etc.
    
    console.log(`Approval required for workflow ${workflowId}`);
    console.log(`Significant changes: ${analysis.summary.significantChanges}`);
    console.log(`Total cost impact: $${analysis.financialImpact.totalCostImpact}`);

    this.emit('approvalRequired', { workflowId, analysis });
  }

  /**
   * Handle approval escalation
   */
  async handleApprovalEscalation(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow || workflow.status !== 'pending_approval') return;

    console.log(`Escalating approval for workflow ${workflowId}`);
    
    await this.logEvent('approval_escalated', { workflowId });
    this.emit('approvalEscalated', { workflowId, workflow });
  }
}

export const workflowAutomationService = new WorkflowAutomationService();
export default workflowAutomationService;