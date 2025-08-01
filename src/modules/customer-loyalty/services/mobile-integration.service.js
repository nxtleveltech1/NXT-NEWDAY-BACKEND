/**
 * Mobile Integration Service
 * Handles mobile app specific features, events, and integrations
 */

import { v4 as uuidv4 } from 'uuid';
import { MOBILE_EVENTS, DEFAULT_POINT_VALUES } from '../types/index.js';

class MobileIntegrationService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Track mobile app events and award points
   */
  async trackEvent(customerId, eventType, eventData = {}) {
    const eventId = uuidv4();

    try {
      const {
        latitude = null,
        longitude = null,
        location_name = null,
        device_type = null,
        app_version = null,
        os_version = null,
        metadata = {}
      } = eventData;

      // Insert event record
      await this.db.execute(`
        INSERT INTO mobile_app_events (
          event_id, customer_id, event_type, event_data, latitude, longitude,
          location_name, device_type, app_version, os_version, event_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        eventId,
        customerId,
        eventType,
        JSON.stringify(eventData),
        latitude,
        longitude,
        location_name,
        device_type,
        app_version,
        os_version
      ]);

      // Award points for certain events
      let pointsAwarded = 0;
      if (this.shouldAwardPoints(eventType, customerId)) {
        pointsAwarded = await this.awardEventPoints(customerId, eventType, eventId, metadata);
      }

      // Update customer app engagement
      await this.updateAppEngagement(customerId, eventType);

      return {
        success: true,
        event_id: eventId,
        points_awarded: pointsAwarded,
        event_type: eventType,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error tracking mobile event:', error);
      throw error;
    }
  }

  /**
   * Handle app installation and first-time setup
   */
  async handleAppInstallation(customerId, deviceInfo = {}) {
    try {
      const {
        device_type,
        app_version,
        os_version,
        push_token = null,
        timezone = null
      } = deviceInfo;

      await this.db.beginTransaction();

      // Update customer profile
      await this.db.execute(`
        UPDATE customer_profiles 
        SET mobile_app_installed = true,
            push_notifications_enabled = true,
            updated_at = NOW()
        WHERE customer_id = ?
      `, [customerId]);

      // Track installation event
      const installResult = await this.trackEvent(customerId, MOBILE_EVENTS.APP_INSTALL, {
        device_type,
        app_version,
        os_version,
        push_token,
        timezone,
        first_install: true
      });

      // Store push token if provided
      if (push_token) {
        await this.storePushToken(customerId, push_token, device_type);
      }

      // Create welcome series for new app users
      await this.createWelcomeSeries(customerId);

      await this.db.commit();

      return {
        success: true,
        welcome_points: installResult.points_awarded,
        onboarding_complete: true
      };

    } catch (error) {
      await this.db.rollback();
      console.error('Error handling app installation:', error);
      throw error;
    }
  }

  /**
   * Process location-based check-ins
   */
  async processCheckIn(customerId, locationData) {
    try {
      const {
        latitude,
        longitude,
        location_name,
        location_type = 'store',
        accuracy = null
      } = locationData;

      // Validate location data
      if (!latitude || !longitude) {
        throw new Error('Location coordinates are required');
      }

      // Check for duplicate check-ins (within 1 hour and 100 meters)
      const [recentCheckIns] = await this.db.execute(`
        SELECT event_id, latitude, longitude, event_timestamp
        FROM mobile_app_events 
        WHERE customer_id = ? 
          AND event_type = 'location_check_in'
          AND event_timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ORDER BY event_timestamp DESC
        LIMIT 5
      `, [customerId]);

      // Calculate distance to recent check-ins
      for (const checkIn of recentCheckIns) {
        const distance = this.calculateDistance(
          latitude, longitude, 
          checkIn.latitude, checkIn.longitude
        );
        
        if (distance < 0.1) { // Within 100 meters
          return {
            success: false,
            message: 'Already checked in at this location recently',
            duplicate: true
          };
        }
      }

      // Process the check-in
      const result = await this.trackEvent(customerId, MOBILE_EVENTS.LOCATION_CHECK_IN, {
        latitude,
        longitude,
        location_name,
        location_type,
        accuracy
      });

      // Check for location-based achievements
      await this.checkLocationAchievements(customerId, locationData);

      // Check for special location-based offers
      const offers = await this.checkLocationOffers(customerId, latitude, longitude);

      return {
        ...result,
        location_offers: offers,
        check_in_count: await this.getCheckInCount(customerId)
      };

    } catch (error) {
      console.error('Error processing check-in:', error);
      throw error;
    }
  }

  /**
   * Handle QR code scanning for rewards
   */
  async processQRCodeScan(customerId, qrData) {
    try {
      const {
        qr_code,
        scan_location = null,
        campaign_id = null
      } = qrData;

      // Validate QR code format and decode
      const qrInfo = this.decodeQRCode(qr_code);

      if (!qrInfo.valid) {
        return {
          success: false,
          message: 'Invalid QR code',
          error: 'QR_INVALID'
        };
      }

      // Track the scan event
      const scanResult = await this.trackEvent(customerId, MOBILE_EVENTS.QR_CODE_SCAN, {
        qr_code,
        scan_location,
        campaign_id,
        qr_type: qrInfo.type,
        qr_value: qrInfo.value
      });

      let additionalReward = null;

      // Process different QR code types
      switch (qrInfo.type) {
        case 'points':
          additionalReward = await this.processPointsQR(customerId, qrInfo.value);
          break;
        case 'discount':
          additionalReward = await this.processDiscountQR(customerId, qrInfo.value);
          break;
        case 'product':
          additionalReward = await this.processProductQR(customerId, qrInfo.value);
          break;
        case 'campaign':
          additionalReward = await this.processCampaignQR(customerId, qrInfo.value);
          break;
      }

      return {
        ...scanResult,
        qr_reward: additionalReward,
        qr_type: qrInfo.type
      };

    } catch (error) {
      console.error('Error processing QR code scan:', error);
      throw error;
    }
  }

  /**
   * Get mobile app analytics for customer
   */
  async getCustomerMobileAnalytics(customerId, days = 30) {
    try {
      const [analytics] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_events,
          COUNT(DISTINCT DATE(event_timestamp)) as active_days,
          COUNT(CASE WHEN event_type = 'location_check_in' THEN 1 END) as check_ins,
          COUNT(CASE WHEN event_type = 'qr_code_scan' THEN 1 END) as qr_scans,
          COUNT(CASE WHEN event_type = 'push_notification_opened' THEN 1 END) as notifications_opened,
          COALESCE(SUM(points_earned), 0) as total_mobile_points,
          
          -- Device info from most recent event
          device_type,
          app_version,
          os_version,
          
          -- Location stats
          COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as location_events,
          COUNT(DISTINCT location_name) as unique_locations
          
        FROM mobile_app_events mae
        WHERE customer_id = ? 
          AND event_timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY customer_id, device_type, app_version, os_version
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `, [customerId, days]);

      if (analytics.length === 0) {
        return {
          customer_id: customerId,
          has_mobile_activity: false,
          period_days: days
        };
      }

      const data = analytics[0];

      // Get event timeline
      const [timeline] = await this.db.execute(`
        SELECT 
          DATE(event_timestamp) as date,
          COUNT(*) as events,
          COALESCE(SUM(points_earned), 0) as points
        FROM mobile_app_events
        WHERE customer_id = ? 
          AND event_timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(event_timestamp)
        ORDER BY date DESC
      `, [customerId, days]);

      // Get favorite locations
      const [locations] = await this.db.execute(`
        SELECT 
          location_name,
          COUNT(*) as visit_count,
          AVG(latitude) as avg_latitude,
          AVG(longitude) as avg_longitude
        FROM mobile_app_events
        WHERE customer_id = ? 
          AND event_type = 'location_check_in'
          AND location_name IS NOT NULL
          AND event_timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY location_name
        ORDER BY visit_count DESC
        LIMIT 5
      `, [customerId, days]);

      return {
        customer_id: customerId,
        period_days: days,
        has_mobile_activity: true,
        summary: {
          ...data,
          engagement_score: this.calculateMobileEngagementScore(data),
          activity_frequency: data.active_days / days
        },
        timeline: timeline,
        favorite_locations: locations
      };

    } catch (error) {
      console.error('Error getting mobile analytics:', error);
      throw error;
    }
  }

  /**
   * Get app-wide mobile analytics
   */
  async getAppAnalytics(timeframe = '30d') {
    try {
      let dateFilter = '';
      let days = 30;

      switch (timeframe) {
        case '7d':
          days = 7;
          dateFilter = 'AND event_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
          break;
        case '30d':
          days = 30;
          dateFilter = 'AND event_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
          break;
        case '90d':
          days = 90;
          dateFilter = 'AND event_timestamp >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
          break;
      }

      const [overview] = await this.db.execute(`
        SELECT 
          COUNT(DISTINCT customer_id) as active_users,
          COUNT(*) as total_events,
          COUNT(DISTINCT DATE(event_timestamp)) as total_active_days,
          COALESCE(SUM(points_earned), 0) as total_points_awarded,
          
          -- Event breakdown
          COUNT(CASE WHEN event_type = 'location_check_in' THEN 1 END) as check_ins,
          COUNT(CASE WHEN event_type = 'qr_code_scan' THEN 1 END) as qr_scans,
          COUNT(CASE WHEN event_type = 'push_notification_opened' THEN 1 END) as notifications_opened,
          COUNT(CASE WHEN event_type = 'app_install' THEN 1 END) as new_installs,
          
          -- Averages
          COUNT(*) / COUNT(DISTINCT customer_id) as avg_events_per_user,
          COALESCE(SUM(points_earned), 0) / COUNT(DISTINCT customer_id) as avg_points_per_user
          
        FROM mobile_app_events
        WHERE 1=1 ${dateFilter}
      `);

      // Device breakdown
      const [devices] = await this.db.execute(`
        SELECT 
          device_type,
          COUNT(DISTINCT customer_id) as users,
          COUNT(*) as events,
          ROUND((COUNT(DISTINCT customer_id) / (SELECT COUNT(DISTINCT customer_id) FROM mobile_app_events WHERE 1=1 ${dateFilter})) * 100, 2) as percentage
        FROM mobile_app_events
        WHERE device_type IS NOT NULL ${dateFilter}
        GROUP BY device_type
        ORDER BY users DESC
      `);

      // Top events
      const [topEvents] = await this.db.execute(`
        SELECT 
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT customer_id) as unique_users,
          COALESCE(SUM(points_earned), 0) as total_points
        FROM mobile_app_events
        WHERE 1=1 ${dateFilter}
        GROUP BY event_type
        ORDER BY count DESC
      `);

      // Daily activity
      const [dailyActivity] = await this.db.execute(`
        SELECT 
          DATE(event_timestamp) as date,
          COUNT(DISTINCT customer_id) as active_users,
          COUNT(*) as events,
          COALESCE(SUM(points_earned), 0) as points_awarded
        FROM mobile_app_events
        WHERE 1=1 ${dateFilter}
        GROUP BY DATE(event_timestamp)
        ORDER BY date DESC
      `);

      return {
        timeframe: timeframe,
        period_days: days,
        overview: overview[0],
        device_breakdown: devices,
        top_events: topEvents,
        daily_activity: dailyActivity
      };

    } catch (error) {
      console.error('Error getting app analytics:', error);
      throw error;
    }
  }

  // Helper methods

  shouldAwardPoints(eventType, customerId) {
    // Define which events should award points and any limits
    const pointEvents = [
      MOBILE_EVENTS.APP_INSTALL,
      MOBILE_EVENTS.LOCATION_CHECK_IN,
      MOBILE_EVENTS.QR_CODE_SCAN,
      MOBILE_EVENTS.PUSH_NOTIFICATION_OPENED
    ];

    return pointEvents.includes(eventType);
  }

  async awardEventPoints(customerId, eventType, eventId, metadata = {}) {
    const points = DEFAULT_POINT_VALUES[eventType] || 0;
    
    if (points <= 0) return 0;

    // Check daily limits
    const dailyLimit = this.getDailyPointLimit(eventType);
    if (dailyLimit > 0) {
      const todayPoints = await this.getTodayEventPoints(customerId, eventType);
      if (todayPoints >= dailyLimit) {
        return 0; // Daily limit reached
      }
    }

    const transactionId = uuidv4();
    
    const [customer] = await this.db.execute(
      `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    const newBalance = customer[0].available_points + points;

    await this.db.execute(`
      INSERT INTO points_transactions (
        transaction_id, customer_id, transaction_type, points_amount, 
        balance_after, event_type, description, metadata
      ) VALUES (?, ?, 'earn', ?, ?, ?, ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      `Mobile app activity: ${eventType}`,
      JSON.stringify({ mobile_event_id: eventId, ...metadata })
    ]);

    await this.db.execute(`
      UPDATE customer_profiles 
      SET available_points = available_points + ?,
          total_points = total_points + ?,
          lifetime_points = lifetime_points + ?,
          tier_points = tier_points + ?,
          last_activity_date = NOW(),
          updated_at = NOW()
      WHERE customer_id = ?
    `, [points, points, points, points, customerId]);

    // Update the event record with points awarded
    await this.db.execute(`
      UPDATE mobile_app_events 
      SET points_earned = ?, processed_at = NOW()
      WHERE event_id = ?
    `, [points, eventId]);

    return points;
  }

  getDailyPointLimit(eventType) {
    const limits = {
      [MOBILE_EVENTS.LOCATION_CHECK_IN]: 50, // Max 5 check-ins per day (10 points each)
      [MOBILE_EVENTS.QR_CODE_SCAN]: 25, // Max 5 QR scans per day
      [MOBILE_EVENTS.PUSH_NOTIFICATION_OPENED]: 10 // Max 10 notification opens
    };

    return limits[eventType] || 0;
  }

  async getTodayEventPoints(customerId, eventType) {
    const [result] = await this.db.execute(`
      SELECT COALESCE(SUM(points_earned), 0) as today_points
      FROM mobile_app_events
      WHERE customer_id = ? 
        AND event_type = ?
        AND DATE(event_timestamp) = CURDATE()
    `, [customerId, eventType]);

    return result[0].today_points;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in kilometers
  }

  calculateMobileEngagementScore(data) {
    let score = 0;
    
    // Event frequency (max 30 points)
    score += Math.min(data.total_events / 10, 30);
    
    // Activity consistency (max 25 points)
    score += Math.min(data.activity_frequency * 25, 25);
    
    // Feature usage variety (max 25 points)
    let features = 0;
    if (data.check_ins > 0) features += 8;
    if (data.qr_scans > 0) features += 8;
    if (data.notifications_opened > 0) features += 5;
    if (data.location_events > 0) features += 4;
    score += Math.min(features, 25);
    
    // Location engagement (max 20 points)
    score += Math.min(data.unique_locations * 4, 20);
    
    return Math.min(Math.round(score), 100);
  }

  decodeQRCode(qrCode) {
    try {
      // Simple QR code format: TYPE:VALUE
      const [type, value] = qrCode.split(':');
      
      const validTypes = ['points', 'discount', 'product', 'campaign'];
      
      if (!validTypes.includes(type) || !value) {
        return { valid: false };
      }

      return {
        valid: true,
        type: type,
        value: value
      };
    } catch (error) {
      return { valid: false };
    }
  }

  async processPointsQR(customerId, pointsValue) {
    const points = parseInt(pointsValue);
    if (isNaN(points) || points <= 0) return null;

    // Award the points
    const transactionId = uuidv4();
    
    const [customer] = await this.db.execute(
      `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    const newBalance = customer[0].available_points + points;

    await this.db.execute(`
      INSERT INTO points_transactions (
        transaction_id, customer_id, transaction_type, points_amount, 
        balance_after, event_type, description, metadata
      ) VALUES (?, ?, 'earn', ?, ?, 'qr_reward', ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      `Bonus points from QR code`,
      JSON.stringify({ qr_type: 'points', qr_value: pointsValue })
    ]);

    await this.db.execute(`
      UPDATE customer_profiles 
      SET available_points = available_points + ?,
          total_points = total_points + ?,
          lifetime_points = lifetime_points + ?,
          tier_points = tier_points + ?,
          last_activity_date = NOW(),
          updated_at = NOW()
      WHERE customer_id = ?
    `, [points, points, points, points, customerId]);

    return {
      type: 'points',
      points_awarded: points,
      message: `You earned ${points} bonus points!`
    };
  }

  async processDiscountQR(customerId, discountValue) {
    // Create a personal discount reward
    const rewardId = uuidv4();
    const discount = parseInt(discountValue);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days to use

    await this.db.execute(`
      INSERT INTO rewards_catalog (
        reward_id, title, description, reward_type, points_cost,
        discount_percentage, total_quantity, available_quantity,
        valid_from, valid_until, status, categories
      ) VALUES (?, ?, ?, 'discount', 0, ?, 1, 1, NOW(), ?, 'active', ?)
    `, [
      rewardId,
      `${discount}% QR Discount`,
      `Exclusive ${discount}% discount from QR code scan`,
      discount,
      expiresAt,
      JSON.stringify(['qr_reward', 'exclusive'])
    ]);

    return {
      type: 'discount',
      discount_percentage: discount,
      reward_id: rewardId,
      expires_at: expiresAt,
      message: `You unlocked a ${discount}% discount!`
    };
  }

  async processProductQR(customerId, productId) {
    // Create product-specific reward or information
    return {
      type: 'product',
      product_id: productId,
      message: 'Product information unlocked!'
    };
  }

  async processCampaignQR(customerId, campaignId) {
    // Enroll customer in campaign
    return {
      type: 'campaign',
      campaign_id: campaignId,
      message: 'You\'ve joined the special campaign!'
    };
  }

  async updateAppEngagement(customerId, eventType) {
    // Update last app activity
    await this.db.execute(`
      UPDATE customer_profiles 
      SET last_activity_date = NOW(),
          updated_at = NOW()
      WHERE customer_id = ?
    `, [customerId]);
  }

  async storePushToken(customerId, pushToken, deviceType) {
    // Store push notification token (implement based on your notification system)
    console.log(`Stored push token for ${customerId}: ${pushToken.substr(0, 10)}...`);
  }

  async createWelcomeSeries(customerId) {
    // Create welcome notification series for new app users
    console.log(`Created welcome series for new app user: ${customerId}`);
  }

  async checkLocationAchievements(customerId, locationData) {
    // Check for location-based achievements
    const checkInCount = await this.getCheckInCount(customerId);
    
    const milestones = [1, 5, 10, 25, 50, 100];
    if (milestones.includes(checkInCount)) {
      // Award location milestone achievement
      console.log(`Location milestone reached: ${checkInCount} check-ins`);
    }
  }

  async checkLocationOffers(customerId, latitude, longitude) {
    // Check for location-based offers
    // This would integrate with your offers/promotions system
    return [];
  }

  async getCheckInCount(customerId) {
    const [result] = await this.db.execute(`
      SELECT COUNT(*) as count
      FROM mobile_app_events
      WHERE customer_id = ? AND event_type = 'location_check_in'
    `, [customerId]);

    return result[0].count;
  }
}

export default MobileIntegrationService;