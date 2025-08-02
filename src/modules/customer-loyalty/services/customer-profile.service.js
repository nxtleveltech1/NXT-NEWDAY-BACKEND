/**
 * Customer Profile Service
 * Handles customer profile management, tier calculations, and loyalty tracking
 */

import { db, pool } from '../../../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { CUSTOMER_TIERS, TIER_REQUIREMENTS, TIER_MULTIPLIERS, POINT_EVENTS } from '../types/index.js';

class CustomerProfileService {
  constructor() {
    this.db = db;
    this.pool = pool;
  }

  /**
   * Create new customer profile
   */
  async createCustomerProfile(customerData) {
    const customerId = customerData.customer_id || uuidv4();
    const referralCode = this.generateReferralCode();

    const profile = {
      customer_id: customerId,
      email: customerData.email,
      first_name: customerData.first_name,
      last_name: customerData.last_name,
      phone: customerData.phone || null,
      date_of_birth: customerData.date_of_birth || null,
      gender: customerData.gender || null,
      address_line1: customerData.address_line1 || null,
      address_line2: customerData.address_line2 || null,
      city: customerData.city || null,
      state_province: customerData.state_province || null,
      postal_code: customerData.postal_code || null,
      country: customerData.country || 'US',
      referral_code: referralCode,
      referred_by: customerData.referred_by || null,
      communication_preferences: JSON.stringify(customerData.communication_preferences || {}),
      interests: JSON.stringify(customerData.interests || []),
      preferred_categories: JSON.stringify(customerData.preferred_categories || []),
      mobile_app_installed: customerData.mobile_app_installed || false,
      push_notifications_enabled: customerData.push_notifications_enabled !== false,
      location_services_enabled: customerData.location_services_enabled || false
    };

    try {
      const [result] = await this.db.execute(
        `INSERT INTO customer_profiles SET ?`,
        [profile]
      );

      // Award signup bonus points
      await this.awardSignupBonus(customerId);

      // Process referral if applicable
      if (customerData.referred_by) {
        await this.processReferralSignup(customerId, customerData.referred_by);
      }

      return {
        success: true,
        customer_id: customerId,
        profile: await this.getCustomerProfile(customerId)
      };
    } catch (error) {
      console.error('Error creating customer profile:', error);
      throw new Error('Failed to create customer profile');
    }
  }

  /**
   * Get customer profile with loyalty summary
   */
  async getCustomerProfile(customerId) {
    try {
      const [profiles] = await this.db.execute(
        `SELECT * FROM customer_loyalty_summary WHERE customer_id = ?`,
        [customerId]
      );

      if (profiles.length === 0) {
        throw new Error('Customer not found');
      }

      const profile = profiles[0];
      
      // Get recent achievements
      const [achievements] = await this.db.execute(
        `SELECT * FROM customer_achievements 
         WHERE customer_id = ? AND completed = true 
         ORDER BY completed_date DESC LIMIT 5`,
        [customerId]
      );

      // Get active rewards
      const [activeRewards] = await this.db.execute(
        `SELECT rr.*, rc.title, rc.description, rc.reward_type 
         FROM reward_redemptions rr
         JOIN rewards_catalog rc ON rr.reward_id = rc.reward_id
         WHERE rr.customer_id = ? AND rr.status = 'active'
         ORDER BY rr.created_at DESC`,
        [customerId]
      );

      // Get tier benefits
      const tierBenefits = this.getTierBenefits(profile.current_tier);

      return {
        ...profile,
        communication_preferences: JSON.parse(profile.communication_preferences || '{}'),
        interests: JSON.parse(profile.interests || '[]'),
        preferred_categories: JSON.parse(profile.preferred_categories || '[]'),
        achievement_badges: JSON.parse(profile.achievement_badges || '[]'),
        recent_achievements: achievements,
        active_rewards: activeRewards,
        tier_benefits: tierBenefits,
        next_tier: this.getNextTier(profile.current_tier),
        points_to_next_tier: this.getPointsToNextTier(profile.current_tier, profile.tier_points)
      };
    } catch (error) {
      console.error('Error getting customer profile:', error);
      throw error;
    }
  }

  /**
   * Update customer profile
   */
  async updateCustomerProfile(customerId, updateData) {
    const allowedFields = [
      'first_name', 'last_name', 'phone', 'date_of_birth', 'gender',
      'address_line1', 'address_line2', 'city', 'state_province', 
      'postal_code', 'country', 'communication_preferences', 'interests',
      'preferred_categories', 'push_notifications_enabled', 'location_services_enabled'
    ];

    const updateFields = {};
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        if (['communication_preferences', 'interests', 'preferred_categories'].includes(key)) {
          updateFields[key] = JSON.stringify(updateData[key]);
        } else {
          updateFields[key] = updateData[key];
        }
      }
    });

    updateFields.updated_at = new Date();

    try {
      await this.db.execute(
        `UPDATE customer_profiles SET ? WHERE customer_id = ?`,
        [updateFields, customerId]
      );

      return await this.getCustomerProfile(customerId);
    } catch (error) {
      console.error('Error updating customer profile:', error);
      throw new Error('Failed to update customer profile');
    }
  }

  /**
   * Update customer tier based on points
   */
  async updateCustomerTier(customerId) {
    try {
      const [profiles] = await this.db.execute(
        `SELECT tier_points, current_tier FROM customer_profiles WHERE customer_id = ?`,
        [customerId]
      );

      if (profiles.length === 0) {
        throw new Error('Customer not found');
      }

      const { tier_points, current_tier } = profiles[0];
      const newTier = this.calculateTier(tier_points);

      if (newTier !== current_tier) {
        await this.db.execute(
          `UPDATE customer_profiles SET current_tier = ?, updated_at = NOW() WHERE customer_id = ?`,
          [newTier, customerId]
        );

        // Award tier upgrade bonus
        await this.awardTierUpgradeBonus(customerId, current_tier, newTier);

        // Send tier upgrade notification
        await this.sendTierUpgradeNotification(customerId, newTier);

        return {
          tier_upgraded: true,
          old_tier: current_tier,
          new_tier: newTier
        };
      }

      return {
        tier_upgraded: false,
        current_tier: current_tier
      };
    } catch (error) {
      console.error('Error updating customer tier:', error);
      throw error;
    }
  }

  /**
   * Calculate engagement score
   */
  async calculateEngagementScore(customerId) {
    try {
      const [result] = await this.db.execute(`
        SELECT 
          COALESCE(SUM(CASE WHEN pt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) as recent_point_transactions,
          COALESCE(SUM(CASE WHEN cph.purchase_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) as recent_purchases,
          COALESCE(SUM(CASE WHEN rr.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) as recent_redemptions,
          COALESCE(SUM(CASE WHEN mae.event_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) as recent_app_events,
          cp.total_purchases,
          cp.successful_referrals,
          cp.streak_days,
          DATEDIFF(NOW(), cp.last_activity_date) as days_since_activity
        FROM customer_profiles cp
        LEFT JOIN points_transactions pt ON cp.customer_id = pt.customer_id
        LEFT JOIN customer_purchase_history cph ON cp.customer_id = cph.customer_id
        LEFT JOIN reward_redemptions rr ON cp.customer_id = rr.customer_id
        LEFT JOIN mobile_app_events mae ON cp.customer_id = mae.customer_id
        WHERE cp.customer_id = ?
        GROUP BY cp.customer_id
      `, [customerId]);

      if (result.length === 0) {
        return 0;
      }

      const data = result[0];
      
      // Calculate engagement score (0-100)
      let score = 0;
      
      // Recent activity (40% weight)
      score += Math.min(data.recent_point_transactions * 2, 15);
      score += Math.min(data.recent_purchases * 5, 15);
      score += Math.min(data.recent_redemptions * 3, 10);
      
      // Overall activity (30% weight)
      score += Math.min(data.total_purchases * 0.5, 15);
      score += Math.min(data.successful_referrals * 2, 10);
      score += Math.min(data.recent_app_events * 1, 5);
      
      // Loyalty indicators (30% weight)
      score += Math.min(data.streak_days * 0.2, 10);
      
      // Penalize inactivity
      if (data.days_since_activity > 30) {
        score *= 0.7;
      } else if (data.days_since_activity > 7) {
        score *= 0.9;
      }

      const finalScore = Math.min(Math.round(score), 100);

      // Update engagement score in database
      await this.db.execute(
        `UPDATE customer_profiles SET engagement_score = ? WHERE customer_id = ?`,
        [finalScore, customerId]
      );

      return finalScore;
    } catch (error) {
      console.error('Error calculating engagement score:', error);
      return 0;
    }
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(customerId) {
    try {
      const [analytics] = await this.db.execute(`
        SELECT 
          cp.*,
          
          -- Purchase patterns
          COALESCE(purchase_stats.avg_days_between_purchases, 0) as avg_days_between_purchases,
          COALESCE(purchase_stats.most_frequent_category, '') as most_frequent_category,
          COALESCE(purchase_stats.preferred_purchase_day, '') as preferred_purchase_day,
          
          -- Point patterns
          COALESCE(point_stats.avg_points_per_transaction, 0) as avg_points_per_transaction,
          COALESCE(point_stats.total_points_earned, 0) as total_points_earned,
          COALESCE(point_stats.total_points_redeemed, 0) as total_points_redeemed,
          COALESCE(point_stats.redemption_rate, 0) as redemption_rate,
          
          -- Seasonal patterns
          COALESCE(seasonal_stats.peak_season, '') as peak_season,
          COALESCE(seasonal_stats.lowest_season, '') as lowest_season
          
        FROM customer_profiles cp
        LEFT JOIN (
          SELECT 
            customer_id,
            AVG(DATEDIFF(purchase_date, LAG(purchase_date) OVER (ORDER BY purchase_date))) as avg_days_between_purchases,
            JSON_UNQUOTE(JSON_EXTRACT(categories, '$[0]')) as most_frequent_category,
            DAYNAME(purchase_date) as preferred_purchase_day
          FROM customer_purchase_history
          WHERE customer_id = ?
          GROUP BY customer_id
        ) purchase_stats ON cp.customer_id = purchase_stats.customer_id
        LEFT JOIN (
          SELECT 
            customer_id,
            AVG(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) as avg_points_per_transaction,
            SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) as total_points_earned,
            SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) as total_points_redeemed,
            CASE 
              WHEN SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) > 0 
              THEN (SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) / 
                    SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END)) * 100
              ELSE 0 
            END as redemption_rate
          FROM points_transactions
          WHERE customer_id = ?
          GROUP BY customer_id
        ) point_stats ON cp.customer_id = point_stats.customer_id
        LEFT JOIN (
          SELECT 
            customer_id,
            CASE 
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 1 THEN total_amount ELSE 0 END) = MAX(quarterly_spend) THEN 'Q1'
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 2 THEN total_amount ELSE 0 END) = MAX(quarterly_spend) THEN 'Q2'
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 3 THEN total_amount ELSE 0 END) = MAX(quarterly_spend) THEN 'Q3'
              ELSE 'Q4'
            END as peak_season,
            CASE 
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 1 THEN total_amount ELSE 0 END) = MIN(quarterly_spend) THEN 'Q1'
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 2 THEN total_amount ELSE 0 END) = MIN(quarterly_spend) THEN 'Q2'
              WHEN SUM(CASE WHEN QUARTER(purchase_date) = 3 THEN total_amount ELSE 0 END) = MIN(quarterly_spend) THEN 'Q3'
              ELSE 'Q4'
            END as lowest_season
          FROM customer_purchase_history,
               (SELECT 
                  SUM(CASE WHEN QUARTER(purchase_date) = 1 THEN total_amount ELSE 0 END) as q1_spend,
                  SUM(CASE WHEN QUARTER(purchase_date) = 2 THEN total_amount ELSE 0 END) as q2_spend,
                  SUM(CASE WHEN QUARTER(purchase_date) = 3 THEN total_amount ELSE 0 END) as q3_spend,
                  SUM(CASE WHEN QUARTER(purchase_date) = 4 THEN total_amount ELSE 0 END) as q4_spend,
                  GREATEST(
                    SUM(CASE WHEN QUARTER(purchase_date) = 1 THEN total_amount ELSE 0 END),
                    SUM(CASE WHEN QUARTER(purchase_date) = 2 THEN total_amount ELSE 0 END),
                    SUM(CASE WHEN QUARTER(purchase_date) = 3 THEN total_amount ELSE 0 END),
                    SUM(CASE WHEN QUARTER(purchase_date) = 4 THEN total_amount ELSE 0 END)
                  ) as quarterly_spend
                FROM customer_purchase_history
                WHERE customer_id = ?
               ) quarterly
          WHERE customer_id = ?
          GROUP BY customer_id
        ) seasonal_stats ON cp.customer_id = seasonal_stats.customer_id
        WHERE cp.customer_id = ?
      `, [customerId, customerId, customerId, customerId, customerId]);

      return analytics[0] || null;
    } catch (error) {
      console.error('Error getting customer analytics:', error);
      throw error;
    }
  }

  // Helper methods
  generateReferralCode() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  calculateTier(tierPoints) {
    if (tierPoints >= TIER_REQUIREMENTS[CUSTOMER_TIERS.PLATINUM]) return CUSTOMER_TIERS.PLATINUM;
    if (tierPoints >= TIER_REQUIREMENTS[CUSTOMER_TIERS.GOLD]) return CUSTOMER_TIERS.GOLD;
    if (tierPoints >= TIER_REQUIREMENTS[CUSTOMER_TIERS.SILVER]) return CUSTOMER_TIERS.SILVER;
    return CUSTOMER_TIERS.BRONZE;
  }

  getNextTier(currentTier) {
    const tiers = [CUSTOMER_TIERS.BRONZE, CUSTOMER_TIERS.SILVER, CUSTOMER_TIERS.GOLD, CUSTOMER_TIERS.PLATINUM];
    const currentIndex = tiers.indexOf(currentTier);
    return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
  }

  getPointsToNextTier(currentTier, currentTierPoints) {
    const nextTier = this.getNextTier(currentTier);
    if (!nextTier) return 0;
    return TIER_REQUIREMENTS[nextTier] - currentTierPoints;
  }

  getTierBenefits(tier) {
    const benefits = {
      [CUSTOMER_TIERS.BRONZE]: {
        point_multiplier: TIER_MULTIPLIERS[CUSTOMER_TIERS.BRONZE],
        benefits: ['Basic rewards', 'Birthday bonus'],
        perks: []
      },
      [CUSTOMER_TIERS.SILVER]: {
        point_multiplier: TIER_MULTIPLIERS[CUSTOMER_TIERS.SILVER],
        benefits: ['20% bonus points', 'Priority support', 'Birthday bonus', 'Free shipping on orders $50+'],
        perks: ['Early access to sales']
      },
      [CUSTOMER_TIERS.GOLD]: {
        point_multiplier: TIER_MULTIPLIERS[CUSTOMER_TIERS.GOLD],
        benefits: ['50% bonus points', 'Priority support', 'Birthday bonus', 'Free shipping on all orders'],
        perks: ['Early access to sales', 'Exclusive gold member events', 'Personal shopping assistance']
      },
      [CUSTOMER_TIERS.PLATINUM]: {
        point_multiplier: TIER_MULTIPLIERS[CUSTOMER_TIERS.PLATINUM],
        benefits: ['100% bonus points', 'Dedicated support', 'Enhanced birthday bonus', 'Free expedited shipping'],
        perks: ['VIP access to new products', 'Platinum member events', 'Personal shopping assistant', 'Annual surprise gift']
      }
    };

    return benefits[tier] || benefits[CUSTOMER_TIERS.BRONZE];
  }

  async awardSignupBonus(customerId) {
    // Implementation in points service
  }

  async processReferralSignup(customerId, referralCode) {
    // Implementation in referral service
  }

  async awardTierUpgradeBonus(customerId, oldTier, newTier) {
    // Implementation in points service
  }

  async sendTierUpgradeNotification(customerId, newTier) {
    // Implementation in notification service
  }
}

export default CustomerProfileService;