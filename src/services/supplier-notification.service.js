import { EventEmitter } from 'events';
import nodemailer from 'nodemailer';
import { getSupplierById } from '../db/supplier-queries.js';
import { getPriceListById } from '../db/price-list-queries.js';

/**
 * Supplier Notification Service
 * Handles automated notifications for supplier upload events:
 * - Upload completion notifications
 * - Approval workflow notifications
 * - Error and warning alerts
 * - Price list activation notifications
 * - Bulk operation summaries
 * - Real-time progress updates via WebSocket
 */

export class SupplierNotificationService extends EventEmitter {
  constructor() {
    super();
    
    this.transporter = null;
    this.setupEmailTransporter();
    
    this.notificationTypes = {
      UPLOAD_STARTED: 'upload_started',
      UPLOAD_COMPLETED: 'upload_completed',
      UPLOAD_FAILED: 'upload_failed',
      REQUIRES_APPROVAL: 'requires_approval',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      ACTIVATED: 'activated',
      BULK_COMPLETED: 'bulk_completed',
      ERROR_ALERT: 'error_alert'
    };

    this.templates = {
      upload_completed: {
        subject: 'Price List Upload Completed - {{supplierName}}',
        template: 'upload-completed'
      },
      upload_failed: {
        subject: 'Price List Upload Failed - {{supplierName}}',
        template: 'upload-failed'
      },
      requires_approval: {
        subject: 'Price List Requires Approval - {{supplierName}}',
        template: 'requires-approval'
      },
      approved: {
        subject: 'Price List Approved - {{supplierName}}',
        template: 'approved'
      },
      rejected: {
        subject: 'Price List Rejected - {{supplierName}}',
        template: 'rejected'
      },
      activated: {
        subject: 'Price List Activated - {{supplierName}}',
        template: 'activated'
      }
    };

    this.stats = {
      totalNotifications: 0,
      emailsSent: 0,
      emailsFailed: 0,
      webSocketMessages: 0
    };
  }

  /**
   * Setup email transporter
   */
  setupEmailTransporter() {
    try {
      this.transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || 'localhost',
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } catch (error) {
      console.error('Failed to setup email transporter:', error);
    }
  }

  /**
   * Send upload completion notification
   */
  async sendUploadNotification(notificationData) {
    try {
      const {
        uploadId,
        priceListId,
        itemsProcessed,
        notifySupplier = false,
        notifyApprovers = false,
        notificationType = this.notificationTypes.UPLOAD_COMPLETED
      } = notificationData;

      // Get supplier and price list information
      const priceList = await getPriceListById(priceListId);
      if (!priceList) {
        throw new Error('Price list not found for notification');
      }

      const supplier = await getSupplierById(priceList.supplierId);
      if (!supplier) {
        throw new Error('Supplier not found for notification');
      }

      const notificationPayload = {
        uploadId,
        priceListId,
        itemsProcessed,
        supplier,
        priceList,
        timestamp: new Date().toISOString()
      };

      // Send supplier notification
      if (notifySupplier && supplier.email) {
        await this.sendSupplierEmail(supplier, notificationType, notificationPayload);
      }

      // Send approver notifications
      if (notifyApprovers) {
        await this.sendApproverNotifications(notificationType, notificationPayload);
      }

      // Send real-time WebSocket notification
      await this.sendWebSocketNotification(notificationType, notificationPayload);

      this.stats.totalNotifications++;
      this.emit('notification:sent', { type: notificationType, uploadId, priceListId });

      return { success: true, message: 'Notifications sent successfully' };
    } catch (error) {
      console.error('Failed to send upload notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send approval workflow notifications
   */
  async sendApprovalNotification(approvalData) {
    try {
      const {
        priceListId,
        notificationType,
        approverUserId,
        comments,
        supplierEmail
      } = approvalData;

      const priceList = await getPriceListById(priceListId);
      const supplier = await getSupplierById(priceList.supplierId);

      const payload = {
        priceList,
        supplier,
        approverUserId,
        comments,
        timestamp: new Date().toISOString()
      };

      // Notify supplier about approval status
      if (supplierEmail || supplier.email) {
        await this.sendSupplierEmail(
          { ...supplier, email: supplierEmail || supplier.email },
          notificationType,
          payload
        );
      }

      // Notify internal stakeholders
      await this.sendInternalNotification(notificationType, payload);

      // Real-time notification
      await this.sendWebSocketNotification(notificationType, payload);

      return { success: true };
    } catch (error) {
      console.error('Failed to send approval notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send bulk operation summary
   */
  async sendBulkOperationSummary(bulkData) {
    try {
      const {
        batchId,
        summary,
        results,
        userEmail
      } = bulkData;

      const payload = {
        batchId,
        summary,
        results: results.slice(0, 10), // Limit to first 10 for email
        timestamp: new Date().toISOString()
      };

      // Send summary email to user
      if (userEmail) {
        await this.sendEmail({
          to: userEmail,
          subject: `Bulk Upload Summary - ${summary.successful}/${summary.total} Successful`,
          template: 'bulk-summary',
          data: payload
        });
      }

      // Send WebSocket notification
      await this.sendWebSocketNotification(this.notificationTypes.BULK_COMPLETED, payload);

      return { success: true };
    } catch (error) {
      console.error('Failed to send bulk operation summary:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send error alerts
   */
  async sendErrorAlert(errorData) {
    try {
      const {
        uploadId,
        errorType,
        errorMessage,
        supplierId,
        userEmail,
        severity = 'medium'
      } = errorData;

      const supplier = supplierId ? await getSupplierById(supplierId) : null;

      const payload = {
        uploadId,
        errorType,
        errorMessage,
        supplier,
        severity,
        timestamp: new Date().toISOString()
      };

      // Send error notification to user
      if (userEmail) {
        await this.sendEmail({
          to: userEmail,
          subject: `Upload Error Alert - ${errorType}`,
          template: 'error-alert',
          data: payload
        });
      }

      // Send to admin alerts if critical
      if (severity === 'critical') {
        await this.sendAdminAlert(payload);
      }

      // Real-time notification
      await this.sendWebSocketNotification(this.notificationTypes.ERROR_ALERT, payload);

      return { success: true };
    } catch (error) {
      console.error('Failed to send error alert:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send progress updates via WebSocket
   */
  async sendProgressUpdate(progressData) {
    try {
      const {
        uploadId,
        status,
        progress,
        message,
        estimatedCompletion
      } = progressData;

      const payload = {
        uploadId,
        status,
        progress,
        message,
        estimatedCompletion,
        timestamp: new Date().toISOString()
      };

      await this.sendWebSocketNotification('upload:progress', payload);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to send progress update:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================
  // HELPER METHODS
  // ====================

  /**
   * Send email to supplier
   */
  async sendSupplierEmail(supplier, notificationType, data) {
    try {
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`No template found for notification type: ${notificationType}`);
      }

      const subject = this.replaceTemplateVars(template.subject, {
        supplierName: supplier.companyName,
        supplierCode: supplier.supplierCode
      });

      const emailContent = await this.generateEmailContent(template.template, {
        ...data,
        supplier
      });

      await this.sendEmail({
        to: supplier.email,
        subject,
        html: emailContent,
        data
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to send supplier email:', error);
      throw error;
    }
  }

  /**
   * Send notifications to approvers
   */
  async sendApproverNotifications(notificationType, data) {
    try {
      // Get approver email addresses from configuration
      const approverEmails = await this.getApproverEmails();
      
      for (const email of approverEmails) {
        try {
          await this.sendEmail({
            to: email,
            subject: `Price List Approval Required - ${data.supplier.companyName}`,
            template: 'approver-notification',
            data
          });
        } catch (error) {
          console.error(`Failed to send approver notification to ${email}:`, error);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to send approver notifications:', error);
      throw error;
    }
  }

  /**
   * Send internal notifications
   */
  async sendInternalNotification(notificationType, data) {
    try {
      // Send to internal notification channels (Slack, Teams, etc.)
      if (process.env.SLACK_WEBHOOK_URL) {
        await this.sendSlackNotification(notificationType, data);
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to send internal notification:', error);
    }
  }

  /**
   * Send WebSocket notification for real-time updates
   */
  async sendWebSocketNotification(type, data) {
    try {
      if (global.wss) {
        const message = JSON.stringify({
          type: 'supplier_notification',
          notificationType: type,
          data,
          timestamp: new Date().toISOString()
        });

        global.wss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            try {
              client.send(message);
              this.stats.webSocketMessages++;
            } catch (error) {
              console.error('Failed to send WebSocket message:', error);
            }
          }
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to send WebSocket notification:', error);
    }
  }

  /**
   * Send email using configured transporter
   */
  async sendEmail(emailData) {
    try {
      if (!this.transporter) {
        throw new Error('Email transporter not configured');
      }

      const { to, subject, html, template, data } = emailData;
      
      let emailContent = html;
      if (template && !html) {
        emailContent = await this.generateEmailContent(template, data);
      }

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@yourcompany.com',
        to,
        subject,
        html: emailContent
      };

      const result = await this.transporter.sendMail(mailOptions);
      this.stats.emailsSent++;
      
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Failed to send email:', error);
      this.stats.emailsFailed++;
      throw error;
    }
  }

  /**
   * Generate email content from template
   */
  async generateEmailContent(templateName, data) {
    try {
      // In a real implementation, you would load templates from files
      // For now, we'll generate basic HTML content
      
      const baseTemplate = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>{{subject}}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              .header { border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 30px; }
              .header h1 { color: #007bff; margin: 0; font-size: 24px; }
              .content { line-height: 1.6; color: #333; }
              .highlight { background-color: #e7f3ff; padding: 15px; border-radius: 4px; margin: 20px 0; }
              .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
              .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              {{content}}
            </div>
          </body>
        </html>
      `;

      let content = '';

      switch (templateName) {
        case 'upload-completed':
          content = this.generateUploadCompletedContent(data);
          break;
        case 'upload-failed':
          content = this.generateUploadFailedContent(data);
          break;
        case 'requires-approval':
          content = this.generateRequiresApprovalContent(data);
          break;
        case 'approved':
          content = this.generateApprovedContent(data);
          break;
        case 'rejected':
          content = this.generateRejectedContent(data);
          break;
        case 'bulk-summary':
          content = this.generateBulkSummaryContent(data);
          break;
        case 'error-alert':
          content = this.generateErrorAlertContent(data);
          break;
        default:
          content = '<div class="content"><p>Notification from supplier upload system.</p></div>';
      }

      return baseTemplate.replace('{{content}}', content);
    } catch (error) {
      console.error('Failed to generate email content:', error);
      return '<html><body><p>Error generating email content</p></body></html>';
    }
  }

  /**
   * Generate upload completed email content
   */
  generateUploadCompletedContent(data) {
    return `
      <div class="header">
        <h1>Price List Upload Completed</h1>
      </div>
      <div class="content">
        <p>Dear ${data.supplier.companyName},</p>
        <p>Your price list upload has been completed successfully.</p>
        
        <div class="highlight">
          <strong>Upload Details:</strong><br>
          Price List ID: ${data.priceListId}<br>
          Items Processed: ${data.itemsProcessed}<br>
          Upload Date: ${new Date(data.timestamp).toLocaleString()}<br>
          Status: ${data.priceList.status}
        </div>
        
        ${data.priceList.status === 'pending' ? 
          '<p>Your price list is now pending approval and will be reviewed shortly.</p>' :
          '<p>Your price list is now active and available for ordering.</p>'
        }
        
        <p>Thank you for keeping your pricing information up to date.</p>
      </div>
      <div class="footer">
        <p>This is an automated notification from the supplier management system.</p>
      </div>
    `;
  }

  /**
   * Generate upload failed email content
   */
  generateUploadFailedContent(data) {
    return `
      <div class="header">
        <h1>Price List Upload Failed</h1>
      </div>
      <div class="content">
        <p>Dear ${data.supplier.companyName},</p>
        <p style="color: #dc3545;">Unfortunately, your price list upload has failed.</p>
        
        <div class="highlight" style="background-color: #f8d7da; border: 1px solid #f5c6cb;">
          <strong>Error Details:</strong><br>
          Upload ID: ${data.uploadId}<br>
          Error: ${data.errorMessage || 'Unknown error occurred'}<br>
          Upload Date: ${new Date(data.timestamp).toLocaleString()}
        </div>
        
        <p>Please review the error details above and try uploading your price list again. If you continue to experience issues, please contact our support team.</p>
        
        <a href="#" class="button">Upload New Price List</a>
      </div>
      <div class="footer">
        <p>If you need assistance, please contact our support team.</p>
      </div>
    `;
  }

  /**
   * Replace template variables
   */
  replaceTemplateVars(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  /**
   * Get approver email addresses
   */
  async getApproverEmails() {
    // In a real implementation, this would query a database or configuration
    return process.env.APPROVER_EMAILS 
      ? process.env.APPROVER_EMAILS.split(',').map(email => email.trim())
      : [];
  }

  /**
   * Send Slack notification
   */
  async sendSlackNotification(type, data) {
    try {
      if (!process.env.SLACK_WEBHOOK_URL) {
        return;
      }

      const slackMessage = {
        text: `Supplier Upload Notification: ${type}`,
        attachments: [{
          color: type.includes('failed') || type.includes('error') ? 'danger' : 'good',
          fields: [
            {
              title: 'Supplier',
              value: data.supplier?.companyName || 'Unknown',
              short: true
            },
            {
              title: 'Type',
              value: type,
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date(data.timestamp).toLocaleString(),
              short: true
            }
          ]
        }]
      };

      // Send to Slack webhook (implementation would use actual HTTP client)
      console.log('Would send Slack notification:', slackMessage);
      
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
    }
  }

  /**
   * Send admin alert for critical errors
   */
  async sendAdminAlert(errorData) {
    try {
      const adminEmails = process.env.ADMIN_EMAILS 
        ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim())
        : [];

      for (const email of adminEmails) {
        await this.sendEmail({
          to: email,
          subject: `CRITICAL: Supplier Upload System Error`,
          template: 'admin-alert',
          data: errorData
        });
      }
    } catch (error) {
      console.error('Failed to send admin alert:', error);
    }
  }

  /**
   * Get notification statistics
   */
  getStats() {
    return {
      ...this.stats,
      emailSuccessRate: this.stats.emailsSent > 0 
        ? ((this.stats.emailsSent / (this.stats.emailsSent + this.stats.emailsFailed)) * 100).toFixed(2)
        : 0
    };
  }

  // Additional template generators would be implemented here for other notification types...
  generateRequiresApprovalContent(data) { /* ... */ }
  generateApprovedContent(data) { /* ... */ }
  generateRejectedContent(data) { /* ... */ }
  generateBulkSummaryContent(data) { /* ... */ }
  generateErrorAlertContent(data) { /* ... */ }
}

// Export singleton instance
export const supplierNotificationService = new SupplierNotificationService();
export default supplierNotificationService;