import EventEmitter from 'events';

/**
 * Supply Chain Notification Service
 * Handles notifications for purchase orders, inventory, and supply chain events
 */
class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.channels = {
      email: process.env.EMAIL_SERVICE_URL,
      slack: process.env.SLACK_WEBHOOK_URL,
      webhook: process.env.WEBHOOK_URL
    };

    this.contacts = {
      procurement: process.env.PROCUREMENT_CONTACT || 'procurement@company.com',
      warehouse: process.env.WAREHOUSE_CONTACT || 'warehouse@company.com',
      finance: process.env.FINANCE_CONTACT || 'finance@company.com',
      management: process.env.MANAGEMENT_CONTACT || 'management@company.com'
    };

    this.thresholds = {
      highValueOrder: parseFloat(process.env.HIGH_VALUE_THRESHOLD) || 50000,
      criticalInventory: parseInt(process.env.CRITICAL_INVENTORY_THRESHOLD) || 10,
      longLeadTime: parseInt(process.env.LONG_LEAD_TIME_THRESHOLD) || 30
    };
  }

  // ==================== PURCHASE ORDER NOTIFICATIONS ====================

  /**
   * Send purchase order approval request notification
   * @param {Object} purchaseOrder - Purchase order details
   */
  async sendPurchaseOrderApprovalRequest(purchaseOrder) {
    const notification = {
      type: 'purchase_order_approval_request',
      title: '📋 Purchase Order Approval Required',
      urgency: this.calculateUrgency(purchaseOrder),
      data: {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        totalAmount: purchaseOrder.totalAmount,
        currency: purchaseOrder.currency,
        itemCount: purchaseOrder.items?.length || 0,
        requestedDeliveryDate: purchaseOrder.requestedDeliveryDate,
        createdBy: purchaseOrder.createdBy
      }
    };

    await this.sendNotification(notification, ['procurement', 'management']);
    this.emit('notification_sent', notification);
  }

  /**
   * Send purchase order approved notification
   * @param {Object} purchaseOrder - Approved purchase order
   */
  async sendPurchaseOrderApproved(purchaseOrder) {
    const notification = {
      type: 'purchase_order_approved',
      title: '✅ Purchase Order Approved',
      urgency: 'medium',
      data: {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        totalAmount: purchaseOrder.totalAmount,
        approvedBy: purchaseOrder.approvedBy,
        approvedAt: purchaseOrder.approvedAt
      }
    };

    await this.sendNotification(notification, ['procurement', 'warehouse']);
    this.emit('notification_sent', notification);
  }

  /**
   * Send purchase order sent notification
   * @param {Object} purchaseOrder - Purchase order sent to supplier
   */
  async sendPurchaseOrderSent(purchaseOrder) {
    const notification = {
      type: 'purchase_order_sent',
      title: '📤 Purchase Order Sent to Supplier',
      urgency: 'low',
      data: {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
        sentAt: purchaseOrder.sentAt
      }
    };

    await this.sendNotification(notification, ['procurement']);
    this.emit('notification_sent', notification);
  }

  /**
   * Send purchase order delivered notification
   * @param {Object} purchaseOrder - Delivered purchase order
   */
  async sendPurchaseOrderDelivered(purchaseOrder) {
    const notification = {
      type: 'purchase_order_delivered',
      title: '📦 Purchase Order Delivered',
      urgency: 'medium',
      data: {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        deliveredAt: purchaseOrder.deliveredAt,
        warehouseId: purchaseOrder.warehouseId
      }
    };

    await this.sendNotification(notification, ['warehouse', 'procurement']);
    this.emit('notification_sent', notification);
  }

  // ==================== PRICE LIST NOTIFICATIONS ====================

  /**
   * Send new price list uploaded notification
   * @param {Object} priceList - Uploaded price list
   * @param {Object} uploadStats - Upload statistics
   */
  async sendPriceListUploaded(priceList, uploadStats) {
    const notification = {
      type: 'price_list_uploaded',
      title: '💰 New Price List Uploaded',
      urgency: 'medium',
      data: {
        supplierName: priceList.supplierName,
        fileName: priceList.originalFileName,
        itemCount: uploadStats.successCount,
        errorCount: uploadStats.errorCount,
        effectiveDate: priceList.effectiveDate,
        uploadedBy: priceList.uploadedBy
      }
    };

    await this.sendNotification(notification, ['procurement', 'finance']);
    this.emit('notification_sent', notification);
  }

  /**
   * Send price change alert notification
   * @param {Array} priceChanges - Significant price changes
   */
  async sendPriceChangeAlert(priceChanges) {
    const notification = {
      type: 'price_change_alert',
      title: '⚠️ Significant Price Changes Detected',
      urgency: 'high',
      data: {
        changesCount: priceChanges.length,
        significantChanges: priceChanges.slice(0, 10), // Top 10 for notification
        averageChange: this.calculateAverageChange(priceChanges),
        affectedSuppliers: [...new Set(priceChanges.map(c => c.supplierName))]
      }
    };

    await this.sendNotification(notification, ['procurement', 'finance', 'management']);
    this.emit('notification_sent', notification);
  }

  // ==================== INVENTORY NOTIFICATIONS ====================

  /**
   * Send low inventory alert
   * @param {Array} lowStockItems - Items with low stock
   */
  async sendLowInventoryAlert(lowStockItems) {
    const notification = {
      type: 'low_inventory_alert',
      title: '📉 Low Inventory Alert',
      urgency: 'high',
      data: {
        itemsCount: lowStockItems.length,
        criticalItems: lowStockItems.filter(item => item.quantityOnHand <= this.thresholds.criticalInventory),
        topItems: lowStockItems.slice(0, 10),
        warehousesAffected: [...new Set(lowStockItems.map(item => item.warehouseId))]
      }
    };

    await this.sendNotification(notification, ['warehouse', 'procurement']);
    this.emit('notification_sent', notification);
  }

  /**
   * Send reorder suggestion notification
   * @param {Array} reorderSuggestions - Suggested reorders
   */
  async sendReorderSuggestion(reorderSuggestions) {
    const notification = {
      type: 'reorder_suggestion',
      title: '🔄 Automatic Reorder Suggestions',
      urgency: 'medium',
      data: {
        suggestionsCount: reorderSuggestions.length,
        totalValue: reorderSuggestions.reduce((sum, item) => sum + (item.suggestedQuantity * item.unitPrice), 0),
        urgentItems: reorderSuggestions.filter(item => item.priority === 'urgent'),
        suggestions: reorderSuggestions.slice(0, 15)
      }
    };

    await this.sendNotification(notification, ['procurement']);
    this.emit('notification_sent', notification);
  }

  // ==================== RECEIPT NOTIFICATIONS ====================

  /**
   * Send receipt discrepancy notification
   * @param {Object} receipt - Receipt with discrepancies
   * @param {Array} discrepancies - List of discrepancies
   */
  async sendReceiptDiscrepancy(receipt, discrepancies) {
    const notification = {
      type: 'receipt_discrepancy',
      title: '⚠️ Receipt Discrepancy Detected',
      urgency: 'high',
      data: {
        receiptNumber: receipt.receiptNumber,
        poNumber: receipt.poNumber,
        supplierName: receipt.supplierName,
        discrepanciesCount: discrepancies.length,
        totalVariance: this.calculateTotalVariance(discrepancies),
        discrepancies: discrepancies
      }
    };

    await this.sendNotification(notification, ['warehouse', 'procurement', 'finance']);
    this.emit('notification_sent', notification);
  }

  // ==================== SUPPLIER PERFORMANCE NOTIFICATIONS ====================

  /**
   * Send supplier performance alert
   * @param {Object} supplier - Supplier information
   * @param {Object} performance - Performance metrics
   */
  async sendSupplierPerformanceAlert(supplier, performance) {
    const notification = {
      type: 'supplier_performance_alert',
      title: '📊 Supplier Performance Alert',
      urgency: this.getPerformanceUrgency(performance),
      data: {
        supplierName: supplier.companyName,
        performanceRating: performance.overallRating,
        onTimeDeliveryRate: performance.onTimeDeliveryRate,
        qualityScore: performance.qualityScore,
        issues: performance.issues,
        trend: performance.trend
      }
    };

    await this.sendNotification(notification, ['procurement', 'management']);
    this.emit('notification_sent', notification);
  }

  // ==================== CORE NOTIFICATION METHODS ====================

  /**
   * Send notification to specified recipients
   * @param {Object} notification - Notification details
   * @param {Array} recipients - List of recipient groups
   */
  async sendNotification(notification, recipients) {
    const timestamp = new Date().toISOString();
    
    // Add metadata
    notification.timestamp = timestamp;
    notification.id = this.generateNotificationId();

    const results = {};

    try {
      // Send to each configured channel
      for (const channel of Object.keys(this.channels)) {
        if (this.channels[channel]) {
          try {
            const channelResult = await this.sendToChannel(channel, notification, recipients);
            results[channel] = channelResult;
          } catch (error) {
            console.error(`Failed to send ${channel} notification:`, error);
            results[channel] = { success: false, error: error.message };
          }
        }
      }

      // Log notification
      await this.logNotification(notification, recipients, results);

      return results;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to specific channel
   * @param {string} channel - Channel type (email, slack, webhook)
   * @param {Object} notification - Notification data
   * @param {Array} recipients - Recipient groups
   */
  async sendToChannel(channel, notification, recipients) {
    switch (channel) {
      case 'email':
        return await this.sendEmailNotification(notification, recipients);
      case 'slack':
        return await this.sendSlackNotification(notification);
      case 'webhook':
        return await this.sendWebhookNotification(notification);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }

  /**
   * Send email notification
   * @param {Object} notification - Notification data
   * @param {Array} recipients - Recipient groups
   */
  async sendEmailNotification(notification, recipients) {
    if (!this.channels.email) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const emailAddresses = recipients.map(group => this.contacts[group]).filter(Boolean);
      
      const payload = {
        to: emailAddresses,
        subject: `[${notification.urgency.toUpperCase()}] ${notification.title}`,
        html: this.formatEmailBody(notification),
        priority: notification.urgency === 'high' ? 'high' : 'normal'
      };

      const response = await fetch(this.channels.email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Email service error: ${response.status}`);
      }

      const result = await response.json();
      return { success: true, messageId: result.messageId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send Slack notification
   * @param {Object} notification - Notification data
   */
  async sendSlackNotification(notification) {
    if (!this.channels.slack) {
      return { success: false, error: 'Slack webhook not configured' };
    }

    try {
      const payload = {
        username: 'Supply Chain Bot',
        icon_emoji: this.getEmojiForType(notification.type),
        attachments: [{
          title: notification.title,
          color: this.getColorForUrgency(notification.urgency),
          fields: this.formatSlackFields(notification.data),
          footer: `Notification ID: ${notification.id}`,
          ts: Math.floor(Date.now() / 1000)
        }]
      };

      const response = await fetch(this.channels.slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send webhook notification
   * @param {Object} notification - Notification data
   */
  async sendWebhookNotification(notification) {
    if (!this.channels.webhook) {
      return { success: false, error: 'Webhook URL not configured' };
    }

    try {
      const response = await fetch(this.channels.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification)
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Calculate urgency based on purchase order details
   * @param {Object} purchaseOrder - Purchase order
   * @returns {string} Urgency level
   */
  calculateUrgency(purchaseOrder) {
    const amount = parseFloat(purchaseOrder.totalAmount);
    const deliveryDate = new Date(purchaseOrder.requestedDeliveryDate);
    const now = new Date();
    const daysUntilDelivery = Math.ceil((deliveryDate - now) / (1000 * 60 * 60 * 24));

    if (amount > this.thresholds.highValueOrder) return 'high';
    if (daysUntilDelivery < 7) return 'high';
    if (amount > this.thresholds.highValueOrder / 2) return 'medium';
    
    return 'low';
  }

  /**
   * Get performance urgency level
   * @param {Object} performance - Performance metrics
   * @returns {string} Urgency level
   */
  getPerformanceUrgency(performance) {
    if (performance.overallRating < 2 || performance.onTimeDeliveryRate < 0.7) return 'high';
    if (performance.overallRating < 3 || performance.onTimeDeliveryRate < 0.85) return 'medium';
    return 'low';
  }

  /**
   * Calculate average price change
   * @param {Array} priceChanges - Price changes
   * @returns {number} Average percentage change
   */
  calculateAverageChange(priceChanges) {
    if (priceChanges.length === 0) return 0;
    const totalChange = priceChanges.reduce((sum, change) => sum + change.percentageChange, 0);
    return totalChange / priceChanges.length;
  }

  /**
   * Calculate total variance for receipt discrepancies
   * @param {Array} discrepancies - List of discrepancies
   * @returns {number} Total variance amount
   */
  calculateTotalVariance(discrepancies) {
    return discrepancies.reduce((sum, disc) => sum + Math.abs(disc.variance), 0);
  }

  /**
   * Format email body for notification
   * @param {Object} notification - Notification data
   * @returns {string} HTML email body
   */
  formatEmailBody(notification) {
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: ${this.getColorForUrgency(notification.urgency)};">
          ${notification.title}
        </h2>
        <p><strong>Time:</strong> ${notification.timestamp}</p>
        <p><strong>Urgency:</strong> ${notification.urgency.toUpperCase()}</p>
        <hr>
        <h3>Details:</h3>
        <ul>
    `;

    for (const [key, value] of Object.entries(notification.data)) {
      html += `<li><strong>${this.formatFieldName(key)}:</strong> ${this.formatFieldValue(value)}</li>`;
    }

    html += `
        </ul>
        <hr>
        <p style="font-size: 12px; color: #666;">
          Notification ID: ${notification.id}<br>
          Generated by NXT Supply Chain System
        </p>
      </div>
    `;

    return html;
  }

  /**
   * Format Slack fields
   * @param {Object} data - Notification data
   * @returns {Array} Slack field objects
   */
  formatSlackFields(data) {
    return Object.entries(data).map(([key, value]) => ({
      title: this.formatFieldName(key),
      value: this.formatFieldValue(value),
      short: this.isShortField(key)
    }));
  }

  /**
   * Get emoji for notification type
   * @param {string} type - Notification type
   * @returns {string} Emoji
   */
  getEmojiForType(type) {
    const emojis = {
      purchase_order_approval_request: ':clipboard:',
      purchase_order_approved: ':white_check_mark:',
      purchase_order_sent: ':outbox_tray:',
      purchase_order_delivered: ':package:',
      price_list_uploaded: ':money_with_wings:',
      price_change_alert: ':warning:',
      low_inventory_alert: ':chart_with_downwards_trend:',
      reorder_suggestion: ':repeat:',
      receipt_discrepancy: ':exclamation:',
      supplier_performance_alert: ':bar_chart:'
    };
    return emojis[type] || ':bell:';
  }

  /**
   * Get color for urgency level
   * @param {string} urgency - Urgency level
   * @returns {string} Color code
   */
  getColorForUrgency(urgency) {
    const colors = {
      high: '#FF0000',    // Red
      medium: '#FFA500',  // Orange
      low: '#008000'      // Green
    };
    return colors[urgency] || '#0099FF';
  }

  /**
   * Format field name for display
   * @param {string} fieldName - Field name
   * @returns {string} Formatted name
   */
  formatFieldName(fieldName) {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .replace(/_/g, ' ');
  }

  /**
   * Format field value for display
   * @param {*} value - Field value
   * @returns {string} Formatted value
   */
  formatFieldValue(value) {
    if (Array.isArray(value)) {
      return value.length > 5 ? `${value.slice(0, 5).join(', ')}... (${value.length} total)` : value.join(', ');
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  /**
   * Check if field should be displayed as short in Slack
   * @param {string} fieldName - Field name
   * @returns {boolean} Is short field
   */
  isShortField(fieldName) {
    const shortFields = ['poNumber', 'supplierName', 'totalAmount', 'currency', 'itemCount'];
    return shortFields.includes(fieldName);
  }

  /**
   * Generate unique notification ID
   * @returns {string} Notification ID
   */
  generateNotificationId() {
    return `ntf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log notification for audit trail
   * @param {Object} notification - Notification data
   * @param {Array} recipients - Recipients
   * @param {Object} results - Send results
   */
  async logNotification(notification, recipients, results) {
    const logEntry = {
      id: notification.id,
      timestamp: notification.timestamp,
      type: notification.type,
      urgency: notification.urgency,
      recipients,
      channels: Object.keys(results),
      success: Object.values(results).every(r => r.success),
      results
    };

    // Emit log event for potential database storage
    this.emit('notification_logged', logEntry);
    
    console.log('Notification sent:', logEntry);
  }
}

// Create alert function for integration monitoring
export async function createAlert(type, message, severity = 'medium', data = {}) {
  const alert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    message,
    severity,
    data,
    timestamp: new Date(),
    resolved: false
  };
  
  console.log(`[ALERT] ${severity.toUpperCase()}: ${message}`, data);
  return alert;
}

// Send notification function wrapper
export async function sendNotification(notification, recipients = []) {
  const notificationService = new NotificationService();
  return notificationService.sendNotification(notification, recipients);
}

export default NotificationService;