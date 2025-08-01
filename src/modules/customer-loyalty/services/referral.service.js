/**
 * Referral Service
 * Handles customer referral program, tracking, and rewards
 */

import { v4 as uuidv4 } from 'uuid';
import { REFERRAL_STATUS, POINT_EVENTS, DEFAULT_POINT_VALUES } from '../types/index.js';

class ReferralService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Create a referral invitation
   */
  async createReferral(referrerCustomerId, refereeEmail, metadata = {}) {
    const referralId = uuidv4();

    try {
      // Get referrer's referral code
      const [referrer] = await this.db.execute(`
        SELECT referral_code, first_name, last_name 
        FROM customer_profiles 
        WHERE customer_id = ?
      `, [referrerCustomerId]);

      if (referrer.length === 0) {
        throw new Error('Referrer not found');
      }

      const { referral_code, first_name, last_name } = referrer[0];

      // Check if this email has already been referred by this customer
      const [existingReferral] = await this.db.execute(`
        SELECT referral_id FROM customer_referrals 
        WHERE referrer_customer_id = ? AND referee_email = ?
        AND status IN ('pending', 'completed')
      `, [referrerCustomerId, refereeEmail]);

      if (existingReferral.length > 0) {
        throw new Error('This email has already been referred by you');
      }

      // Set expiration (default 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Create referral record
      await this.db.execute(`
        INSERT INTO customer_referrals (
          referral_id, referrer_customer_id, referral_code, referee_email,
          referral_source, campaign_id, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        referralId,
        referrerCustomerId,
        referral_code,
        refereeEmail,
        metadata.source || 'direct',
        metadata.campaign_id || null,
        expiresAt,
        REFERRAL_STATUS.PENDING
      ]);

      // Send referral invitation email
      await this.sendReferralInvitation(refereeEmail, {
        referrer_name: `${first_name} ${last_name}`,
        referral_code: referral_code,
        referral_id: referralId,
        expires_at: expiresAt
      });

      return {
        success: true,
        referral_id: referralId,
        referral_code: referral_code,
        expires_at: expiresAt
      };

    } catch (error) {
      console.error('Error creating referral:', error);
      throw error;
    }
  }

  /**
   * Process referral signup when referee registers
   */
  async processReferralSignup(refereeCustomerId, referralCode) {
    try {
      // Find the referral record
      const [referral] = await this.db.execute(`
        SELECT cr.*, cp.first_name, cp.last_name
        FROM customer_referrals cr
        JOIN customer_profiles cp ON cr.referrer_customer_id = cp.customer_id
        WHERE cr.referral_code = ? AND cr.status = ?
        ORDER BY cr.referral_date DESC
        LIMIT 1
      `, [referralCode, REFERRAL_STATUS.PENDING]);

      if (referral.length === 0) {
        throw new Error('Invalid or expired referral code');
      }

      const referralData = referral[0];

      // Check if referral has expired
      if (new Date(referralData.expires_at) < new Date()) {
        await this.db.execute(`
          UPDATE customer_referrals 
          SET status = ? 
          WHERE referral_id = ?
        `, [REFERRAL_STATUS.EXPIRED, referralData.referral_id]);
        
        throw new Error('Referral code has expired');
      }

      // Update referral with referee information
      await this.db.execute(`
        UPDATE customer_referrals 
        SET referee_customer_id = ?,
            signup_date = NOW(),
            status = ?
        WHERE referral_id = ?
      `, [refereeCustomerId, REFERRAL_STATUS.PENDING, referralData.referral_id]);

      // Update referee's profile with referrer information
      await this.db.execute(`
        UPDATE customer_profiles 
        SET referred_by = ?
        WHERE customer_id = ?
      `, [referralData.referrer_customer_id, refereeCustomerId]);

      // Award initial signup points to referee (if applicable)
      await this.awardRefereeSignupBonus(refereeCustomerId, referralData.referral_id);

      return {
        success: true,
        referral_id: referralData.referral_id,
        referrer_name: `${referralData.first_name} ${referralData.last_name}`
      };

    } catch (error) {
      console.error('Error processing referral signup:', error);
      throw error;
    }
  }

  /**
   * Complete referral when referee makes first purchase
   */
  async completeReferral(refereeCustomerId, purchaseAmount) {
    try {
      // Find pending referral for this customer
      const [referral] = await this.db.execute(`
        SELECT * FROM customer_referrals 
        WHERE referee_customer_id = ? AND status = ?
      `, [refereeCustomerId, REFERRAL_STATUS.PENDING]);

      if (referral.length === 0) {
        return { success: false, message: 'No pending referral found' };
      }

      const referralData = referral[0];
      const referrerCustomerId = referralData.referrer_customer_id;

      await this.db.beginTransaction();

      // Update referral status
      await this.db.execute(`
        UPDATE customer_referrals 
        SET first_purchase_date = NOW(),
            completed_date = NOW(),
            status = ?
        WHERE referral_id = ?
      `, [REFERRAL_STATUS.COMPLETED, referralData.referral_id]);

      // Award points to referrer
      const referrerPoints = this.calculateReferrerReward(purchaseAmount);
      await this.awardReferrerPoints(referrerCustomerId, referrerPoints, referralData.referral_id);

      // Award bonus points to referee
      const refereePoints = this.calculateRefereeReward(purchaseAmount);
      if (refereePoints > 0) {
        await this.awardRefereePoints(refereeCustomerId, refereePoints, referralData.referral_id);
      }

      // Update referrer's successful referrals count
      await this.db.execute(`
        UPDATE customer_profiles 
        SET successful_referrals = successful_referrals + 1,
            updated_at = NOW()
        WHERE customer_id = ?
      `, [referrerCustomerId]);

      await this.db.commit();

      // Send completion notifications
      await this.sendReferralCompletionNotifications(
        referrerCustomerId, 
        refereeCustomerId, 
        referrerPoints, 
        refereePoints
      );

      // Check for referral milestones
      await this.checkReferralMilestones(referrerCustomerId);

      return {
        success: true,
        referral_id: referralData.referral_id,
        referrer_points: referrerPoints,
        referee_points: refereePoints
      };

    } catch (error) {
      await this.db.rollback();
      console.error('Error completing referral:', error);
      throw error;
    }
  }

  /**
   * Get referral statistics for a customer
   */
  async getReferralStats(customerId) {
    try {
      const [stats] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_referrals_sent,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_referrals,
          COUNT(CASE WHEN status = 'pending' AND signup_date IS NOT NULL THEN 1 END) as pending_purchases,
          COUNT(CASE WHEN status = 'pending' AND signup_date IS NULL THEN 1 END) as pending_signups,
          COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_referrals,
          COALESCE(SUM(referrer_points_awarded), 0) as total_points_earned,
          
          -- Recent activity (last 30 days)
          COUNT(CASE WHEN referral_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as referrals_30d,
          COUNT(CASE WHEN completed_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as completions_30d
          
        FROM customer_referrals
        WHERE referrer_customer_id = ?
      `, [customerId]);

      const [recentReferrals] = await this.db.execute(`
        SELECT 
          cr.*,
          cp.first_name as referee_first_name,
          cp.last_name as referee_last_name
        FROM customer_referrals cr
        LEFT JOIN customer_profiles cp ON cr.referee_customer_id = cp.customer_id
        WHERE cr.referrer_customer_id = ?
        ORDER BY cr.referral_date DESC
        LIMIT 10
      `, [customerId]);

      // Calculate conversion rate
      const totalSent = stats[0].total_referrals_sent;
      const completed = stats[0].completed_referrals;
      const conversionRate = totalSent > 0 ? ((completed / totalSent) * 100).toFixed(2) : 0;

      return {
        ...stats[0],
        conversion_rate: parseFloat(conversionRate),
        recent_referrals: recentReferrals
      };

    } catch (error) {
      console.error('Error getting referral stats:', error);
      throw error;
    }
  }

  /**
   * Get referral leaderboard
   */
  async getReferralLeaderboard(limit = 50, timeframe = 'all_time') {
    try {
      let dateFilter = '';
      if (timeframe === 'monthly') {
        dateFilter = 'AND cr.completed_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
      } else if (timeframe === 'yearly') {
        dateFilter = 'AND cr.completed_date >= DATE_SUB(NOW(), INTERVAL 365 DAY)';
      }

      const [leaderboard] = await this.db.execute(`
        SELECT 
          cp.customer_id,
          cp.first_name,
          cp.last_name,
          cp.current_tier,
          COUNT(cr.referral_id) as total_referrals,
          COUNT(CASE WHEN cr.status = 'completed' THEN 1 END) as completed_referrals,
          COALESCE(SUM(cr.referrer_points_awarded), 0) as total_points_earned,
          CASE 
            WHEN COUNT(cr.referral_id) > 0 
            THEN ROUND((COUNT(CASE WHEN cr.status = 'completed' THEN 1 END) / COUNT(cr.referral_id)) * 100, 2)
            ELSE 0 
          END as conversion_rate,
          
          -- Recent activity for trending
          COUNT(CASE WHEN cr.completed_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as recent_completions
          
        FROM customer_profiles cp
        LEFT JOIN customer_referrals cr ON cp.customer_id = cr.referrer_customer_id ${dateFilter}
        WHERE cp.successful_referrals > 0
        GROUP BY cp.customer_id
        ORDER BY completed_referrals DESC, total_points_earned DESC
        LIMIT ?
      `, [limit]);

      return leaderboard.map((entry, index) => ({
        rank: index + 1,
        ...entry,
        trending: entry.recent_completions > 0
      }));

    } catch (error) {
      console.error('Error getting referral leaderboard:', error);
      throw error;
    }
  }

  /**
   * Generate referral link for sharing
   */
  async generateReferralLink(customerId, source = 'direct') {
    try {
      const [customer] = await this.db.execute(`
        SELECT referral_code FROM customer_profiles WHERE customer_id = ?
      `, [customerId]);

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { referral_code } = customer[0];
      
      // In a real implementation, this would be your actual domain
      const baseUrl = process.env.FRONTEND_URL || 'https://yourapp.com';
      const referralLink = `${baseUrl}/signup?ref=${referral_code}&source=${source}`;

      // Track link generation for analytics
      await this.trackReferralLinkGeneration(customerId, source);

      return {
        referral_code: referral_code,
        referral_link: referralLink,
        shareable_message: this.generateShareableMessage(referral_code),
        qr_code_url: this.generateQRCodeUrl(referralLink)
      };

    } catch (error) {
      console.error('Error generating referral link:', error);
      throw error;
    }
  }

  /**
   * Validate referral code
   */
  async validateReferralCode(referralCode) {
    try {
      const [customer] = await this.db.execute(`
        SELECT customer_id, first_name, last_name, current_tier
        FROM customer_profiles 
        WHERE referral_code = ? AND status = 'active'
      `, [referralCode]);

      if (customer.length === 0) {
        return { valid: false, message: 'Invalid referral code' };
      }

      const customerData = customer[0];

      // Get referrer's referral performance
      const [stats] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_referrals,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_referrals
        FROM customer_referrals
        WHERE referrer_customer_id = ?
      `, [customerData.customer_id]);

      return {
        valid: true,
        referrer: {
          name: `${customerData.first_name} ${customerData.last_name}`,
          tier: customerData.current_tier,
          referral_stats: stats[0]
        },
        benefits: this.getReferralBenefits()
      };

    } catch (error) {
      console.error('Error validating referral code:', error);
      return { valid: false, message: 'Error validating referral code' };
    }
  }

  /**
   * Get referral analytics
   */
  async getReferralAnalytics(timeframe = 'all_time') {
    try {
      let dateFilter = '';
      const params = [];

      if (timeframe === 'monthly') {
        dateFilter = 'WHERE cr.referral_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
      } else if (timeframe === 'yearly') {
        dateFilter = 'WHERE cr.referral_date >= DATE_SUB(NOW(), INTERVAL 365 DAY)';
      }

      const [analytics] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_referrals,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_referrals,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_referrals,
          COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_referrals,
          COUNT(DISTINCT referrer_customer_id) as active_referrers,
          COALESCE(SUM(referrer_points_awarded), 0) as total_points_awarded,
          COALESCE(AVG(referrer_points_awarded), 0) as avg_points_per_referral,
          
          -- Conversion metrics
          CASE 
            WHEN COUNT(*) > 0 
            THEN ROUND((COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*)) * 100, 2)
            ELSE 0 
          END as overall_conversion_rate,
          
          -- Time to conversion (in days)
          COALESCE(AVG(DATEDIFF(completed_date, signup_date)), 0) as avg_days_to_conversion
          
        FROM customer_referrals cr
        ${dateFilter}
      `);

      // Get referral sources breakdown
      const [sources] = await this.db.execute(`
        SELECT 
          referral_source,
          COUNT(*) as referrals_count,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
          ROUND((COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*)) * 100, 2) as conversion_rate
        FROM customer_referrals cr
        ${dateFilter}
        GROUP BY referral_source
        ORDER BY referrals_count DESC
      `);

      // Get top referrers
      const [topReferrers] = await this.db.execute(`
        SELECT 
          cp.customer_id,
          cp.first_name,
          cp.last_name,
          cp.current_tier,
          COUNT(cr.referral_id) as total_referrals,
          COUNT(CASE WHEN cr.status = 'completed' THEN 1 END) as completed_referrals,
          COALESCE(SUM(cr.referrer_points_awarded), 0) as points_earned
        FROM customer_profiles cp
        JOIN customer_referrals cr ON cp.customer_id = cr.referrer_customer_id
        ${dateFilter.replace('WHERE', 'AND')}
        GROUP BY cp.customer_id
        ORDER BY completed_referrals DESC
        LIMIT 10
      `);

      return {
        overview: analytics[0],
        sources_breakdown: sources,
        top_referrers: topReferrers,
        timeframe: timeframe
      };

    } catch (error) {
      console.error('Error getting referral analytics:', error);
      throw error;
    }
  }

  // Helper methods
  calculateReferrerReward(purchaseAmount) {
    // Base reward: 500 points + 10% of purchase amount (in points)
    const baseReward = DEFAULT_POINT_VALUES[POINT_EVENTS.REFERRAL];
    const purchaseBonus = Math.floor(purchaseAmount * 0.1); // 10% of purchase as points
    return baseReward + purchaseBonus;
  }

  calculateRefereeReward(purchaseAmount) {
    // Referee gets 10% bonus on their first purchase
    return Math.floor(purchaseAmount * 0.1);
  }

  async awardReferrerPoints(customerId, points, referralId) {
    // This would integrate with the points service
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
      ) VALUES (?, ?, 'earn', ?, ?, 'referral', ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      'Points earned for successful referral',
      JSON.stringify({ referral_id: referralId, type: 'referrer_reward' })
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

    // Update referral record
    await this.db.execute(`
      UPDATE customer_referrals 
      SET referrer_points_awarded = ?
      WHERE referral_id = ?
    `, [points, referralId]);
  }

  async awardRefereePoints(customerId, points, referralId) {
    // Similar to referrer points but for referee
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
      ) VALUES (?, ?, 'earn', ?, ?, 'referral', ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      'Bonus points for being referred',
      JSON.stringify({ referral_id: referralId, type: 'referee_reward' })
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

    // Update referral record
    await this.db.execute(`
      UPDATE customer_referrals 
      SET referee_points_awarded = ?
      WHERE referral_id = ?
    `, [points, referralId]);
  }

  async awardRefereeSignupBonus(customerId, referralId) {
    // Award small signup bonus (separate from purchase bonus)
    const signupBonus = 50; // 50 points for signing up via referral
    await this.awardRefereePoints(customerId, signupBonus, referralId);
  }

  async checkReferralMilestones(customerId) {
    const [stats] = await this.db.execute(`
      SELECT successful_referrals FROM customer_profiles WHERE customer_id = ?
    `, [customerId]);

    const milestones = [5, 10, 25, 50, 100];
    const currentCount = stats[0].successful_referrals;

    // Check if customer just hit a milestone
    if (milestones.includes(currentCount)) {
      const bonusPoints = currentCount * 100; // 100 points per referral milestone
      await this.awardMilestoneBonus(customerId, currentCount, bonusPoints);
    }
  }

  async awardMilestoneBonus(customerId, milestone, points) {
    // Award milestone bonus points
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
      ) VALUES (?, ?, 'earn', ?, ?, 'milestone', ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      `Referral milestone bonus: ${milestone} successful referrals`,
      JSON.stringify({ milestone_type: 'referral', milestone_value: milestone })
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
  }

  generateShareableMessage(referralCode) {
    return `Join me on our loyalty program and we both get rewards! Use my referral code: ${referralCode}`;
  }

  generateQRCodeUrl(referralLink) {
    // In production, you'd use a QR code generation service
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(referralLink)}`;
  }

  getReferralBenefits() {
    return {
      referrer: ['500 bonus points', '10% of referee\'s first purchase in points', 'Milestone bonuses'],
      referee: ['50 signup bonus points', '10% bonus on first purchase', 'Welcome to loyalty program']
    };
  }

  async trackReferralLinkGeneration(customerId, source) {
    // Track for analytics - could be stored in a separate events table
  }

  async sendReferralInvitation(email, data) {
    // Implementation in notification service
  }

  async sendReferralCompletionNotifications(referrerCustomerId, refereeCustomerId, referrerPoints, refereePoints) {
    // Implementation in notification service
  }
}

export default ReferralService;