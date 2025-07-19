import { db } from '../config/database.js'
import { priceLists, priceListItems, suppliers } from '../db/schema.js'
import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { updatePriceListStatus, getPriceListById } from '../db/price-list-queries.js'
import { getSupplierById } from '../db/supplier-queries.js'

/**
 * Price Change Approval Workflow Service
 * Implements comprehensive approval workflows for price list changes,
 * including validation, approval routing, and change impact analysis
 */

// ==================== APPROVAL WORKFLOW STATES ====================

export const APPROVAL_STATES = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CHANGES_REQUESTED: 'changes_requested',
  ARCHIVED: 'archived'
}

export const APPROVAL_ROLES = {
  SUBMITTER: 'submitter',
  REVIEWER: 'reviewer',
  APPROVER: 'approver',
  ADMIN: 'admin'
}

// ==================== WORKFLOW CONFIGURATION ====================

const WORKFLOW_CONFIG = {
  // Approval thresholds
  thresholds: {
    // Automatic approval if price increase is less than 5%
    autoApprovalPercentage: 5,
    // Requires senior approval if increase is more than 20%
    seniorApprovalPercentage: 20,
    // Requires executive approval if increase is more than 50%
    executiveApprovalPercentage: 50
  },
  
  // Approval routing rules
  routing: {
    // Low impact changes (< 5% increase)
    lowImpact: {
      requiredApprovals: 1,
      roles: [APPROVAL_ROLES.REVIEWER]
    },
    // Medium impact changes (5-20% increase)
    mediumImpact: {
      requiredApprovals: 2,
      roles: [APPROVAL_ROLES.REVIEWER, APPROVAL_ROLES.APPROVER]
    },
    // High impact changes (20-50% increase)
    highImpact: {
      requiredApprovals: 3,
      roles: [APPROVAL_ROLES.REVIEWER, APPROVAL_ROLES.APPROVER, APPROVAL_ROLES.ADMIN]
    },
    // Critical impact changes (> 50% increase)
    criticalImpact: {
      requiredApprovals: 3,
      roles: [APPROVAL_ROLES.REVIEWER, APPROVAL_ROLES.APPROVER, APPROVAL_ROLES.ADMIN],
      requiresExecutiveApproval: true
    }
  },
  
  // Business rules
  businessRules: {
    // Cannot approve own submissions
    preventSelfApproval: true,
    // Requires justification for price increases > 10%
    requiresJustificationThreshold: 10,
    // Maximum allowed price increase without special approval
    maxPriceIncreasePercent: 100,
    // Approval expires after 30 days
    approvalExpiryDays: 30
  }
}

// ==================== APPROVAL WORKFLOW FUNCTIONS ====================

/**
 * Submit price list for approval workflow
 */
export async function submitPriceListForApprovalWorkflow(priceListId, submitterUserId, options = {}) {
  try {
    const {
      submissionNotes = null,
      justification = null,
      requestedEffectiveDate = null,
      urgentApproval = false
    } = options

    // Get price list with full details
    const priceList = await getPriceListById(priceListId)
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${priceListId}`
      }
    }

    // Validate current status
    if (![APPROVAL_STATES.DRAFT, APPROVAL_STATES.CHANGES_REQUESTED].includes(priceList.status)) {
      return {
        success: false,
        error: 'Invalid status for submission',
        message: `Price list status is ${priceList.status}. Only draft or changes-requested price lists can be submitted.`
      }
    }

    // Analyze price changes and determine approval requirements
    const changeAnalysis = await analyzePriceChangeImpact(priceList)
    const approvalRequirements = determineApprovalRequirements(changeAnalysis)

    // Validate business rules
    const businessRuleValidation = validateBusinessRules(priceList, changeAnalysis, options)
    if (!businessRuleValidation.valid) {
      return {
        success: false,
        error: 'Business rule validation failed',
        message: businessRuleValidation.message,
        data: { 
          violations: businessRuleValidation.violations,
          changeAnalysis 
        }
      }
    }

    // Create approval workflow record
    const workflowRecord = await createApprovalWorkflow({
      priceListId,
      submitterUserId,
      submissionNotes,
      justification,
      requestedEffectiveDate,
      urgentApproval,
      changeAnalysis,
      approvalRequirements
    })

    // Update price list status
    const updatedPriceList = await updatePriceListStatus(
      priceListId, 
      APPROVAL_STATES.PENDING_REVIEW, 
      submitterUserId
    )

    // Send notifications to approvers
    await notifyApprovers(workflowRecord, approvalRequirements)

    return {
      success: true,
      data: {
        priceList: updatedPriceList,
        workflow: workflowRecord,
        changeAnalysis,
        approvalRequirements,
        nextSteps: getNextApprovalSteps(approvalRequirements)
      },
      message: 'Price list submitted for approval successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to submit price list for approval'
    }
  }
}

/**
 * Process approval step in workflow
 */
export async function processApprovalStep(priceListId, approverUserId, decision, options = {}) {
  try {
    const {
      approvalNotes = null,
      requestedChanges = null,
      overrideReason = null
    } = options

    // Validate decision
    if (!['approve', 'reject', 'request_changes'].includes(decision)) {
      return {
        success: false,
        error: 'Invalid decision',
        message: 'Decision must be one of: approve, reject, request_changes'
      }
    }

    // Get workflow record
    const workflow = await getApprovalWorkflow(priceListId)
    if (!workflow) {
      return {
        success: false,
        error: 'Workflow not found',
        message: `No approval workflow found for price list ${priceListId}`
      }
    }

    // Validate approver authorization
    const authValidation = validateApproverAuthorization(workflow, approverUserId)
    if (!authValidation.authorized) {
      return {
        success: false,
        error: 'Unauthorized approver',
        message: authValidation.reason
      }
    }

    // Process the decision
    const processResult = await processApprovalDecision(
      workflow, 
      approverUserId, 
      decision, 
      { approvalNotes, requestedChanges, overrideReason }
    )

    // Update price list status based on workflow state
    const newStatus = determineNewPriceListStatus(workflow, processResult)
    const updatedPriceList = await updatePriceListStatus(priceListId, newStatus, approverUserId)

    // Send notifications
    await notifyWorkflowParticipants(workflow, processResult)

    return {
      success: true,
      data: {
        priceList: updatedPriceList,
        workflow: processResult.updatedWorkflow,
        decision: {
          approver: approverUserId,
          decision,
          processedAt: new Date(),
          notes: approvalNotes
        },
        nextSteps: processResult.nextSteps
      },
      message: `Approval ${decision} processed successfully`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to process approval step'
    }
  }
}

/**
 * Get approval workflow status
 */
export async function getApprovalWorkflowStatus(priceListId) {
  try {
    const workflow = await getApprovalWorkflow(priceListId)
    if (!workflow) {
      return {
        success: false,
        error: 'Workflow not found',
        message: `No approval workflow found for price list ${priceListId}`
      }
    }

    const status = {
      workflowId: workflow.id,
      priceListId,
      currentStatus: workflow.status,
      currentStep: workflow.currentStep,
      submittedAt: workflow.submittedAt,
      submitter: workflow.submitter,
      
      // Progress tracking
      progress: {
        totalSteps: workflow.requiredApprovals.length,
        completedSteps: workflow.approvals.length,
        pendingSteps: workflow.requiredApprovals.length - workflow.approvals.length,
        percentComplete: (workflow.approvals.length / workflow.requiredApprovals.length) * 100
      },
      
      // Approval details
      approvals: workflow.approvals,
      pendingApprovers: workflow.pendingApprovers,
      rejections: workflow.rejections,
      
      // Change analysis
      changeAnalysis: workflow.changeAnalysis,
      impactLevel: workflow.impactLevel,
      
      // Timeline
      timeline: buildWorkflowTimeline(workflow),
      
      // Next actions
      nextActions: getNextWorkflowActions(workflow)
    }

    return {
      success: true,
      data: status,
      message: 'Workflow status retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve workflow status'
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Analyze price change impact compared to current active price list
 */
async function analyzePriceChangeImpact(priceList) {
  try {
    // Get current active price list for comparison
    const currentActiveList = await db
      .select()
      .from(priceLists)
      .where(
        and(
          eq(priceLists.supplierId, priceList.supplier.id),
          eq(priceLists.status, 'active')
        )
      )
      .limit(1)

    if (!currentActiveList[0]) {
      // No existing active list - this is a new price list
      return {
        isNewPriceList: true,
        impactLevel: 'low',
        totalItems: priceList.items.length,
        analysis: {
          newItems: priceList.items.length,
          modifiedItems: 0,
          removedItems: 0,
          priceIncreases: 0,
          priceDecreases: 0,
          averagePriceChange: 0,
          maxPriceIncrease: 0,
          totalValueImpact: 0
        }
      }
    }

    // Get current active price list items for comparison
    const currentItems = await db
      .select()
      .from(priceListItems)
      .where(eq(priceListItems.priceListId, currentActiveList[0].id))

    // Create maps for easier comparison
    const currentItemsMap = new Map(currentItems.map(item => [item.sku, item]))
    const newItemsMap = new Map(priceList.items.map(item => [item.sku, item]))

    const analysis = {
      newItems: 0,
      modifiedItems: 0,
      removedItems: 0,
      priceIncreases: 0,
      priceDecreases: 0,
      noChange: 0,
      totalValueImpact: 0,
      maxPriceIncrease: 0,
      maxPriceDecrease: 0,
      priceChanges: []
    }

    // Analyze each item in the new price list
    for (const newItem of priceList.items) {
      const currentItem = currentItemsMap.get(newItem.sku)
      
      if (!currentItem) {
        // New item
        analysis.newItems++
        analysis.priceChanges.push({
          sku: newItem.sku,
          type: 'new',
          newPrice: newItem.unitPrice,
          impact: newItem.unitPrice * (newItem.minQuantity || 1)
        })
      } else {
        // Existing item - compare prices
        const priceDiff = newItem.unitPrice - currentItem.unitPrice
        const percentChange = (priceDiff / currentItem.unitPrice) * 100
        
        analysis.modifiedItems++
        
        if (priceDiff > 0) {
          analysis.priceIncreases++
          analysis.maxPriceIncrease = Math.max(analysis.maxPriceIncrease, percentChange)
        } else if (priceDiff < 0) {
          analysis.priceDecreases++
          analysis.maxPriceDecrease = Math.min(analysis.maxPriceDecrease, percentChange)
        } else {
          analysis.noChange++
        }
        
        analysis.totalValueImpact += Math.abs(priceDiff) * (newItem.minQuantity || 1)
        
        if (priceDiff !== 0) {
          analysis.priceChanges.push({
            sku: newItem.sku,
            type: priceDiff > 0 ? 'increase' : 'decrease',
            oldPrice: currentItem.unitPrice,
            newPrice: newItem.unitPrice,
            change: priceDiff,
            percentChange,
            impact: Math.abs(priceDiff) * (newItem.minQuantity || 1)
          })
        }
      }
    }

    // Check for removed items
    for (const currentItem of currentItems) {
      if (!newItemsMap.has(currentItem.sku)) {
        analysis.removedItems++
        analysis.priceChanges.push({
          sku: currentItem.sku,
          type: 'removed',
          oldPrice: currentItem.unitPrice,
          impact: currentItem.unitPrice * (currentItem.minQuantity || 1)
        })
      }
    }

    // Calculate average price change
    const totalItems = analysis.modifiedItems
    const totalPriceChanges = analysis.priceIncreases + analysis.priceDecreases
    
    if (totalPriceChanges > 0) {
      analysis.averagePriceChange = analysis.priceChanges
        .filter(change => change.type === 'increase' || change.type === 'decrease')
        .reduce((acc, change) => acc + Math.abs(change.percentChange), 0) / totalPriceChanges
    }

    // Determine impact level
    let impactLevel = 'low'
    if (analysis.maxPriceIncrease > WORKFLOW_CONFIG.thresholds.executiveApprovalPercentage) {
      impactLevel = 'critical'
    } else if (analysis.maxPriceIncrease > WORKFLOW_CONFIG.thresholds.seniorApprovalPercentage) {
      impactLevel = 'high'
    } else if (analysis.maxPriceIncrease > WORKFLOW_CONFIG.thresholds.autoApprovalPercentage) {
      impactLevel = 'medium'
    }

    return {
      isNewPriceList: false,
      impactLevel,
      totalItems: priceList.items.length,
      analysis,
      comparisonWith: {
        priceListId: currentActiveList[0].id,
        priceListName: currentActiveList[0].name,
        effectiveDate: currentActiveList[0].effectiveDate
      }
    }
  } catch (error) {
    throw new Error(`Failed to analyze price change impact: ${error.message}`)
  }
}

/**
 * Determine approval requirements based on change analysis
 */
function determineApprovalRequirements(changeAnalysis) {
  const { impactLevel, analysis } = changeAnalysis
  
  let requirements = WORKFLOW_CONFIG.routing.lowImpact
  
  switch (impactLevel) {
    case 'medium':
      requirements = WORKFLOW_CONFIG.routing.mediumImpact
      break
    case 'high':
      requirements = WORKFLOW_CONFIG.routing.highImpact
      break
    case 'critical':
      requirements = WORKFLOW_CONFIG.routing.criticalImpact
      break
  }

  // Add special requirements based on analysis
  const specialRequirements = []
  
  if (analysis.maxPriceIncrease > WORKFLOW_CONFIG.businessRules.requiresJustificationThreshold) {
    specialRequirements.push('JUSTIFICATION_REQUIRED')
  }
  
  if (analysis.newItems > 100) {
    specialRequirements.push('BULK_ITEM_REVIEW')
  }
  
  if (analysis.removedItems > 10) {
    specialRequirements.push('DISCONTINUED_ITEM_APPROVAL')
  }

  return {
    impactLevel,
    requiredApprovals: requirements.requiredApprovals,
    requiredRoles: requirements.roles,
    requiresExecutiveApproval: requirements.requiresExecutiveApproval || false,
    specialRequirements,
    estimatedTimeframe: calculateApprovalTimeframe(requirements, specialRequirements)
  }
}

/**
 * Validate business rules for approval submission
 */
function validateBusinessRules(priceList, changeAnalysis, options) {
  const violations = []
  
  // Check maximum price increase limit
  if (changeAnalysis.analysis.maxPriceIncrease > WORKFLOW_CONFIG.businessRules.maxPriceIncreasePercent) {
    violations.push({
      rule: 'MAX_PRICE_INCREASE',
      message: `Price increase of ${changeAnalysis.analysis.maxPriceIncrease}% exceeds maximum allowed ${WORKFLOW_CONFIG.businessRules.maxPriceIncreasePercent}%`
    })
  }

  // Check justification requirement
  if (changeAnalysis.analysis.maxPriceIncrease > WORKFLOW_CONFIG.businessRules.requiresJustificationThreshold && !options.justification) {
    violations.push({
      rule: 'JUSTIFICATION_REQUIRED',
      message: `Price increases over ${WORKFLOW_CONFIG.businessRules.requiresJustificationThreshold}% require justification`
    })
  }

  // Check for empty price list
  if (!priceList.items || priceList.items.length === 0) {
    violations.push({
      rule: 'EMPTY_PRICE_LIST',
      message: 'Price list cannot be empty'
    })
  }

  return {
    valid: violations.length === 0,
    violations,
    message: violations.length > 0 ? violations.map(v => v.message).join('; ') : 'All business rules validated successfully'
  }
}

/**
 * Create approval workflow record (placeholder - would use actual workflow table)
 */
async function createApprovalWorkflow(workflowData) {
  // In a real implementation, this would create a record in a workflow table
  // For now, we'll return a mock workflow object
  const workflow = {
    id: `wf_${Date.now()}`,
    priceListId: workflowData.priceListId,
    submitter: workflowData.submitterUserId,
    submittedAt: new Date(),
    status: 'pending_review',
    currentStep: 1,
    changeAnalysis: workflowData.changeAnalysis,
    approvalRequirements: workflowData.approvalRequirements,
    requiredApprovals: workflowData.approvalRequirements.requiredRoles.map((role, index) => ({
      step: index + 1,
      role,
      required: true,
      completed: false
    })),
    approvals: [],
    rejections: [],
    pendingApprovers: workflowData.approvalRequirements.requiredRoles,
    metadata: {
      submissionNotes: workflowData.submissionNotes,
      justification: workflowData.justification,
      urgentApproval: workflowData.urgentApproval
    }
  }

  return workflow
}

/**
 * Get approval workflow (placeholder)
 */
async function getApprovalWorkflow(priceListId) {
  // Mock implementation - in real system would query workflow table
  return null
}

/**
 * Calculate approval timeframe estimate
 */
function calculateApprovalTimeframe(requirements, specialRequirements) {
  let baseDays = requirements.requiredApprovals * 2 // 2 days per approval level
  
  if (requirements.requiresExecutiveApproval) {
    baseDays += 3 // Additional time for executive approval
  }
  
  if (specialRequirements.includes('BULK_ITEM_REVIEW')) {
    baseDays += 2 // Additional time for bulk review
  }
  
  return {
    estimatedDays: baseDays,
    estimatedCompletionDate: new Date(Date.now() + baseDays * 24 * 60 * 60 * 1000)
  }
}

/**
 * Get next approval steps
 */
function getNextApprovalSteps(approvalRequirements) {
  return approvalRequirements.requiredRoles.map((role, index) => ({
    step: index + 1,
    role,
    description: `${role} approval required`,
    estimated: `${(index + 1) * 2} days`
  }))
}

/**
 * Validate approver authorization (placeholder)
 */
function validateApproverAuthorization(workflow, approverUserId) {
  return {
    authorized: true,
    reason: 'Authorized'
  }
}

/**
 * Process approval decision (placeholder)
 */
async function processApprovalDecision(workflow, approverUserId, decision, options) {
  // Mock implementation
  return {
    updatedWorkflow: workflow,
    nextSteps: []
  }
}

/**
 * Determine new price list status based on workflow
 */
function determineNewPriceListStatus(workflow, processResult) {
  return APPROVAL_STATES.PENDING_APPROVAL // Simplified for demo
}

/**
 * Build workflow timeline
 */
function buildWorkflowTimeline(workflow) {
  const timeline = [
    {
      step: 'submission',
      timestamp: workflow.submittedAt,
      actor: workflow.submitter,
      action: 'Submitted for approval',
      status: 'completed'
    }
  ]

  // Add approval steps
  workflow.approvals.forEach((approval, index) => {
    timeline.push({
      step: `approval_${index + 1}`,
      timestamp: approval.timestamp,
      actor: approval.approver,
      action: `Approved by ${approval.role}`,
      status: 'completed',
      notes: approval.notes
    })
  })

  return timeline
}

/**
 * Get next workflow actions
 */
function getNextWorkflowActions(workflow) {
  return [
    {
      action: 'PENDING_REVIEW',
      description: 'Waiting for reviewer approval',
      assignedTo: workflow.pendingApprovers
    }
  ]
}

/**
 * Send notifications (placeholder)
 */
async function notifyApprovers(workflowRecord, approvalRequirements) {
  // Placeholder for notification system
  console.log(`Notifications sent to approvers for workflow ${workflowRecord.id}`)
}

/**
 * Send workflow notifications (placeholder)
 */
async function notifyWorkflowParticipants(workflow, processResult) {
  // Placeholder for notification system
  console.log(`Workflow notifications sent for ${workflow.id}`)
}

export default {
  submitPriceListForApprovalWorkflow,
  processApprovalStep,
  getApprovalWorkflowStatus,
  APPROVAL_STATES,
  APPROVAL_ROLES,
  WORKFLOW_CONFIG
}