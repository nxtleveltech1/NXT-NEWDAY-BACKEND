const EventEmitter = require('events');

class RealTimeService extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // Store WebSocket connections by user ID
    this.userSessions = new Map(); // Track user sessions
  }

  // Add WebSocket connection for a user
  addConnection(userId, ws) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId).add(ws);
    
    // Update session tracking
    this.userSessions.set(userId, {
      lastActivity: Date.now(),
      connectionCount: this.connections.get(userId).size
    });

    console.log(`User ${userId} connected. Total connections: ${this.connections.get(userId).size}`);
    
    // Send connection confirmation
    this.sendToUser(userId, {
      type: 'CONNECTION_ESTABLISHED',
      timestamp: Date.now(),
      message: 'Real-time updates enabled'
    });
  }

  // Remove WebSocket connection
  removeConnection(userId, ws) {
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(ws);
      
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
        this.userSessions.delete(userId);
        console.log(`User ${userId} fully disconnected`);
      } else {
        // Update session count
        this.userSessions.set(userId, {
          ...this.userSessions.get(userId),
          connectionCount: this.connections.get(userId).size
        });
        console.log(`User ${userId} connection removed. Remaining: ${this.connections.get(userId).size}`);
      }
    }
  }

  // Send message to specific user
  sendToUser(userId, data) {
    if (this.connections.has(userId)) {
      const userConnections = this.connections.get(userId);
      const message = JSON.stringify({
        ...data,
        timestamp: Date.now()
      });

      userConnections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(message);
          } catch (error) {
            console.error(`Failed to send message to user ${userId}:`, error);
            this.removeConnection(userId, ws);
          }
        } else {
          this.removeConnection(userId, ws);
        }
      });
    }
  }

  // Broadcast to all connected users
  broadcast(data) {
    const message = JSON.stringify({
      ...data,
      timestamp: Date.now()
    });

    this.connections.forEach((userConnections, userId) => {
      userConnections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(message);
          } catch (error) {
            console.error(`Failed to broadcast to user ${userId}:`, error);
            this.removeConnection(userId, ws);
          }
        } else {
          this.removeConnection(userId, ws);
        }
      });
    });
  }

  // Notify about points change
  notifyPointsUpdate(userId, pointsData) {
    this.sendToUser(userId, {
      type: 'POINTS_UPDATE',
      data: {
        current_points: pointsData.current_points,
        lifetime_points: pointsData.lifetime_points,
        points_change: pointsData.points_change,
        tier: pointsData.tier,
        transaction_type: pointsData.transaction_type || 'UNKNOWN'
      }
    });

    // Emit event for other services
    this.emit('pointsUpdated', { userId, ...pointsData });
  }

  // Notify about tier upgrade
  notifyTierUpgrade(userId, tierData) {
    this.sendToUser(userId, {
      type: 'TIER_UPGRADE',
      data: {
        new_tier: tierData.new_tier,
        previous_tier: tierData.previous_tier,
        benefits: tierData.benefits,
        congratulations_message: `Congratulations! You've been upgraded to ${tierData.new_tier} tier!`
      }
    });

    // Emit event for other services
    this.emit('tierUpgraded', { userId, ...tierData });
  }

  // Notify about referral updates
  notifyReferralUpdate(userId, referralData) {
    this.sendToUser(userId, {
      type: 'REFERRAL_UPDATE',
      data: referralData
    });

    // Emit event for other services
    this.emit('referralUpdated', { userId, ...referralData });
  }

  // Notify about reward redemption
  notifyRewardRedemption(userId, redemptionData) {
    this.sendToUser(userId, {
      type: 'REWARD_REDEEMED',
      data: {
        reward_name: redemptionData.reward_name,
        points_used: redemptionData.points_used,
        redemption_code: redemptionData.redemption_code,
        status: redemptionData.status,
        message: `Successfully redeemed: ${redemptionData.reward_name}`
      }
    });

    // Emit event for other services
    this.emit('rewardRedeemed', { userId, ...redemptionData });
  }

  // Send system notification
  sendNotification(userId, notification) {
    this.sendToUser(userId, {
      type: 'NOTIFICATION',
      data: {
        title: notification.title,
        message: notification.message,
        priority: notification.priority || 'normal',
        action_url: notification.action_url,
        expires_at: notification.expires_at
      }
    });
  }

  // Get connection stats
  getStats() {
    return {
      total_connected_users: this.connections.size,
      total_connections: Array.from(this.connections.values())
        .reduce((sum, connections) => sum + connections.size, 0),
      user_sessions: Object.fromEntries(this.userSessions)
    };
  }

  // Clean up inactive connections (run periodically)
  cleanupInactiveConnections() {
    const now = Date.now();
    const inactivityThreshold = 30 * 60 * 1000; // 30 minutes

    this.userSessions.forEach((session, userId) => {
      if (now - session.lastActivity > inactivityThreshold) {
        console.log(`Cleaning up inactive connections for user ${userId}`);
        
        if (this.connections.has(userId)) {
          const userConnections = this.connections.get(userId);
          userConnections.forEach(ws => {
            if (ws.readyState === 1) {
              ws.close(1000, 'Session timeout');
            }
          });
          this.connections.delete(userId);
        }
        
        this.userSessions.delete(userId);
      }
    });
  }

  // Update user activity
  updateUserActivity(userId) {
    if (this.userSessions.has(userId)) {
      this.userSessions.set(userId, {
        ...this.userSessions.get(userId),
        lastActivity: Date.now()
      });
    }
  }
}

// Create singleton instance
const realTimeService = new RealTimeService();

// Set up periodic cleanup
setInterval(() => {
  realTimeService.cleanupInactiveConnections();
}, 5 * 60 * 1000); // Run every 5 minutes

module.exports = realTimeService;