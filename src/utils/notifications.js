/**
 * Emergency Notification System
 * Handles rollback and incident notifications
 */

import fs from 'fs/promises';
import path from 'path';

export class NotificationService {
  constructor() {
    const sanitize = (val) => {
      return typeof val === 'string' && /^\$\{.+\}$/.test(val) ? null : val;
    };

    this.channels = {
      slack: sanitize(process.env.SLACK_WEBHOOK_URL),
      email: sanitize(process.env.EMAIL_SERVICE_URL),
      sms: sanitize(process.env.SMS_SERVICE_URL),
      pagerduty: sanitize(process.env.PAGERDUTY_INTEGRATION_KEY)
    };

    this.contacts = {
      oncall: process.env.ONCALL_CONTACT || 'oncall@company.com',
      dba: process.env.DBA_CONTACT || 'dba@company.com',
      devops: process.env.DEVOPS_CONTACT || 'devops@company.com',
      management: process.env.MANAGEMENT_CONTACT || 'management@company.com',
      po: process.env.PO_CONTACT || 'po@company.com'
    };

    this.templates = {
      'rollback-initiated': {
        title: '🚨 PRODUCTION ROLLBACK INITIATED',
        severity: 'CRITICAL',
        channels: ['slack', 'email', 'sms', 'pagerduty'],
        contacts: ['oncall', 'dba', 'devops', 'management']
      },
      'rollback-success': {
        title: '✅ PRODUCTION ROLLBACK COMPLETED',
        severity: 'HIGH',
        channels: ['slack', 'email'],
        contacts: ['oncall', 'dba', 'devops', 'management', 'po']
      },
      'rollback-failure': {
        title: '❌ PRODUCTION ROLLBACK FAILED',
        severity: 'CRITICAL',
        channels: ['slack', 'email', 'sms', 'pagerduty'],
        contacts: ['oncall', 'dba', 'devops', 'management']
      },
      'validation-failure': {
        title: '⚠️ POST-ROLLBACK VALIDATION FAILED',
        severity: 'HIGH',
        channels: ['slack', 'email', 'sms'],
        contacts: ['oncall', 'dba', 'devops']
      },
      'maintenance-mode': {
        title: '🔧 MAINTENANCE MODE ACTIVATED',
        severity: 'MEDIUM',
        channels: ['slack', 'email'],
        contacts: ['oncall', 'po']
      }
    };
  }

  async notifyStakeholders(notification) {
    const template = this.templates[notification.type];
    if (!template) {
      throw new Error(`Unknown notification type: ${notification.type}`);
    }

    const message = this.buildMessage(template, notification);
    const results = {};

    // Send to all configured channels
    for (const channel of template.channels) {
      if (this.channels[channel]) {
        try {
          results[channel] = await this.sendToChannel(channel, message, template.severity);
        } catch (error) {
          console.error(`Failed to send ${channel} notification:`, error.message);
          results[channel] = { success: false, error: error.message };
        }
      }
    }

    // Log notification
    await this.logNotification(notification, message, results);

    return results;
  }

  buildMessage(template, notification) {
    const timestamp = new Date().toISOString();
    
    switch (notification.type) {
      case 'rollback-initiated':
        return {
          title: template.title,
          severity: template.severity,
          fields: [
            { name: 'System', value: 'NXT NEW DAY', inline: true },
            { name: 'Rollback ID', value: notification.rollbackId, inline: true },
            { name: 'Type', value: notification.rollbackType, inline: true },
            { name: 'Trigger', value: notification.trigger || 'Manual', inline: true },
            { name: 'Start Time', value: timestamp, inline: true },
            { name: 'Expected Duration', value: this.getExpectedDuration(notification.rollbackType), inline: true },
            { name: 'Impact', value: notification.impact || 'Service temporarily unavailable', inline: false },
            { name: 'Next Update', value: notification.nextUpdate || 'In 5 minutes', inline: true }
          ],
          color: '#FF0000', // Red for critical
          footer: `Incident ID: ${notification.rollbackId} | On-call: ${this.contacts.oncall}`
        };

      case 'rollback-success':
        return {
          title: template.title,
          severity: template.severity,
          fields: [
            { name: 'System', value: 'NXT NEW DAY', inline: true },
            { name: 'Rollback ID', value: notification.rollbackId, inline: true },
            { name: 'Type', value: notification.rollbackType, inline: true },
            { name: 'Duration', value: `${notification.duration}s`, inline: true },
            { name: 'Services Restored', value: this.getRestoredServices(notification.rollbackType), inline: false },
            { name: 'Data Loss', value: notification.dataLoss || 'None', inline: true },
            { name: 'Safety Backup', value: notification.safetyBackup ? '✅ Created' : '❌ None', inline: true },
            { name: 'Validation', value: '✅ All checks passed', inline: true }
          ],
          color: '#00FF00', // Green for success
          footer: `Rollback completed at ${timestamp} | Total downtime: ${notification.duration}s`
        };

      case 'rollback-failure':
        return {
          title: template.title,
          severity: template.severity,
          fields: [
            { name: 'System', value: 'NXT NEW DAY', inline: true },
            { name: 'Rollback ID', value: notification.rollbackId, inline: true },
            { name: 'Type', value: notification.rollbackType, inline: true },
            { name: 'Error', value: notification.error, inline: false },
            { name: 'Safety Backup', value: notification.safetyBackup ? '✅ Available' : '❌ None', inline: true },
            { name: 'Current Status', value: 'Manual intervention required', inline: true },
            { name: 'Escalation', value: 'Management team notified', inline: true }
          ],
          color: '#FF0000', // Red for failure
          footer: `URGENT: Manual intervention required | Escalation path activated`
        };

      case 'validation-failure':
        return {
          title: template.title,
          severity: template.severity,
          fields: [
            { name: 'System', value: 'NXT NEW DAY', inline: true },
            { name: 'Rollback ID', value: notification.rollbackId, inline: true },
            { name: 'Failed Checks', value: notification.failedChecks?.join(', ') || 'Unknown', inline: false },
            { name: 'Errors', value: notification.errors?.join('\n') || 'Check logs for details', inline: false },
            { name: 'Action Required', value: 'Investigate and resolve validation failures', inline: false }
          ],
          color: '#FFA500', // Orange for warning
          footer: `Validation failed at ${timestamp} | Investigation required`
        };

      case 'maintenance-mode':
        return {
          title: template.title,
          severity: template.severity,
          fields: [
            { name: 'System', value: 'NXT NEW DAY', inline: true },
            { name: 'Status', value: notification.enabled ? 'ENABLED' : 'DISABLED', inline: true },
            { name: 'Reason', value: notification.reason || 'Rollback procedure', inline: true },
            { name: 'Duration', value: notification.expectedDuration || 'TBD', inline: true },
            { name: 'Impact', value: 'All services temporarily unavailable', inline: false }
          ],
          color: '#FFA500', // Orange for maintenance
          footer: `Maintenance mode ${notification.enabled ? 'activated' : 'deactivated'} at ${timestamp}`
        };

      default:
        return {
          title: 'System Notification',
          severity: 'INFO',
          fields: [
            { name: 'Type', value: notification.type, inline: true },
            { name: 'Timestamp', value: timestamp, inline: true },
            { name: 'Data', value: JSON.stringify(notification, null, 2), inline: false }
          ],
          color: '#0099FF'
        };
    }
  }

  async sendToChannel(channel, message, severity) {
    switch (channel) {
      case 'slack':
        return await this.sendSlackNotification(message);
      case 'email':
        return await this.sendEmailNotification(message, severity);
      case 'sms':
        return await this.sendSMSNotification(message, severity);
      case 'pagerduty':
        return await this.sendPagerDutyNotification(message, severity);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }

  async sendSlackNotification(message) {
    if (!this.channels.slack) {
      return { success: false, error: 'Slack webhook URL not configured' };
    }

    try {
      const payload = {
        username: 'NXT Rollback Bot',
        icon_emoji: ':warning:',
        attachments: [{
          title: message.title,
          color: message.color,
          fields: message.fields,
          footer: message.footer,
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

      return { success: true, messageId: response.headers.get('x-slack-req-id') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendEmailNotification(message, severity) {
    if (!this.channels.email) {
      return { success: false, error: 'Email service URL not configured' };
    }

    try {
      const emailBody = this.formatEmailBody(message);
      const subject = `[${severity}] ${message.title}`;

      const payload = {
        to: this.getEmailRecipients(severity),
        subject,
        html: emailBody,
        priority: severity === 'CRITICAL' ? 'high' : 'normal'
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

  async sendSMSNotification(message, severity) {
    if (!this.channels.sms) {
      return { success: false, error: 'SMS service URL not configured' };
    }

    // Only send SMS for critical alerts to avoid spam
    if (severity !== 'CRITICAL') {
      return { success: true, skipped: 'Non-critical severity' };
    }

    try {
      const smsBody = this.formatSMSBody(message);
      
      const payload = {
        to: this.getSMSRecipients(),
        message: smsBody
      };

      const response = await fetch(this.channels.sms, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`SMS service error: ${response.status}`);
      }

      const result = await response.json();
      return { success: true, messageId: result.messageId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendPagerDutyNotification(message, severity) {
    if (!this.channels.pagerduty) {
      return { success: false, error: 'PagerDuty integration key not configured' };
    }

    // Only send PagerDuty for critical alerts
    if (severity !== 'CRITICAL') {
      return { success: true, skipped: 'Non-critical severity' };
    }

    try {
      const payload = {
        routing_key: this.channels.pagerduty,
        event_action: 'trigger',
        payload: {
          summary: message.title,
          severity: 'critical',
          source: 'NXT NEW DAY',
          component: 'rollback-system',
          custom_details: message.fields.reduce((acc, field) => {
            acc[field.name] = field.value;
            return acc;
          }, {})
        }
      };

      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.status}`);
      }

      const result = await response.json();
      return { success: true, dedupKey: result.dedup_key };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  formatEmailBody(message) {
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: ${message.color};">${message.title}</h2>
        <table style="width: 100%; border-collapse: collapse;">
    `;

    for (const field of message.fields) {
      html += `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 150px;">
            ${field.name}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd;">
            ${field.value}
          </td>
        </tr>
      `;
    }

    html += `
        </table>
        <p style="margin-top: 20px; font-style: italic; color: #666;">
          ${message.footer}
        </p>
      </div>
    `;

    return html;
  }

  formatSMSBody(message) {
    const key_fields = message.fields.slice(0, 3); // Only include key fields for SMS
    let sms = `${message.title}\n\n`;
    
    for (const field of key_fields) {
      sms += `${field.name}: ${field.value}\n`;
    }
    
    sms += `\nContact: ${this.contacts.oncall}`;
    return sms;
  }

  getEmailRecipients(severity) {
    const recipients = [this.contacts.oncall];
    
    if (severity === 'CRITICAL') {
      recipients.push(this.contacts.dba, this.contacts.devops, this.contacts.management);
    } else if (severity === 'HIGH') {
      recipients.push(this.contacts.dba, this.contacts.devops);
    }
    
    return recipients.filter(email => email && email.includes('@'));
  }

  getSMSRecipients() {
    // Only SMS the primary on-call for critical alerts
    return [this.contacts.oncall].filter(phone => phone && phone.includes('+'));
  }

  getExpectedDuration(rollbackType) {
    const durations = {
      full: '5-10 minutes',
      database: '3-5 minutes',
      application: '2-3 minutes',
      feature: '1-2 minutes'
    };
    return durations[rollbackType] || '5-10 minutes';
  }

  getRestoredServices(rollbackType) {
    const services = {
      full: 'Database, Backend API, Frontend, All Features',
      database: 'Database, Data Integrity',
      application: 'Backend API, Frontend',
      feature: 'Specific Features Only'
    };
    return services[rollbackType] || 'All Services';
  }

  async logNotification(notification, message, results) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: notification.type,
      rollbackId: notification.rollbackId,
      message: message.title,
      channels: results,
      success: Object.values(results).every(r => r.success)
    };

    try {
      const logFile = '/var/log/nxt-notifications.log';
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log notification:', error.message);
    }
  }
}

// Export convenience function
export async function notifyStakeholders(notification) {
  const service = new NotificationService();
  return await service.notifyStakeholders(notification);
}

export default NotificationService;