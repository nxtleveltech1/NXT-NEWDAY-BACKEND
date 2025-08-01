/**
 * Rewards Service
 * Handles reward catalog management, redemption, and reward availability
 */

import { v4 as uuidv4 } from 'uuid';
import { REWARD_TYPES, CUSTOMER_TIERS } from '../types/index.js';

class RewardsService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Get rewards catalog with filtering and personalization
   */
  async getRewardsCatalog(customerId = null, filters = {}) {
    const {
      reward_type = null,
      tier_requirement = null,
      max_points_cost = null,
      min_points_cost = null,
      featured_only = false,
      category = null,
      limit = 50,
      offset = 0
    } = filters;

    try {
      let query = `
        SELECT 
          rc.*,
          CASE WHEN rc.total_quantity IS NULL THEN true 
               ELSE rc.available_quantity > 0 
          END as available,
          CASE WHEN ? IS NOT NULL THEN
            CASE WHEN cp.current_tier = 'platinum' THEN 4
                 WHEN cp.current_tier = 'gold' THEN 3
                 WHEN cp.current_tier = 'silver' THEN 2
                 ELSE 1
            END >= CASE WHEN rc.tier_requirement = 'platinum' THEN 4
                        WHEN rc.tier_requirement = 'gold' THEN 3
                        WHEN rc.tier_requirement = 'silver' THEN 2
                        ELSE 1
                   END
            ELSE true
          END as customer_eligible,
          CASE WHEN ? IS NOT NULL THEN cp.available_points >= rc.points_cost
               ELSE true
          END as customer_can_afford
        FROM rewards_catalog rc
        LEFT JOIN customer_profiles cp ON cp.customer_id = ?
        WHERE rc.status = 'active'
        AND (rc.valid_from IS NULL OR rc.valid_from <= NOW())
        AND (rc.valid_until IS NULL OR rc.valid_until >= NOW())
      `;

      const params = [customerId, customerId, customerId];

      if (reward_type) {
        query += ` AND rc.reward_type = ?`;
        params.push(reward_type);
      }

      if (tier_requirement) {
        query += ` AND (rc.tier_requirement IS NULL OR rc.tier_requirement = ?)`;
        params.push(tier_requirement);
      }

      if (max_points_cost) {
        query += ` AND rc.points_cost <= ?`;
        params.push(max_points_cost);
      }

      if (min_points_cost) {
        query += ` AND rc.points_cost >= ?`;
        params.push(min_points_cost);
      }

      if (featured_only) {
        query += ` AND rc.featured = true`;
      }

      if (category) {
        query += ` AND JSON_CONTAINS(rc.categories, ?)`;
        params.push(JSON.stringify(category));
      }

      query += ` ORDER BY rc.featured DESC, rc.points_cost ASC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [rewards] = await this.db.execute(query, params);

      // Parse JSON fields
      return rewards.map(reward => ({
        ...reward,
        categories: JSON.parse(reward.categories || '[]'),
        applicable_products: JSON.parse(reward.applicable_products || '[]'),
        excluded_products: JSON.parse(reward.excluded_products || '[]')
      }));

    } catch (error) {
      console.error('Error getting rewards catalog:', error);
      throw error;
    }
  }

  /**
   * Get personalized reward recommendations
   */
  async getPersonalizedRewards(customerId, limit = 10) {
    try {
      // Get customer profile and preferences
      const [customer] = await this.db.execute(`
        SELECT current_tier, available_points, preferred_categories, interests
        FROM customer_profiles WHERE customer_id = ?
      `, [customerId]);

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { current_tier, available_points, preferred_categories, interests } = customer[0];
      const preferredCats = JSON.parse(preferred_categories || '[]');
      const customerInterests = JSON.parse(interests || '[]');

      // Get purchase history to understand preferences
      const [purchaseHistory] = await this.db.execute(`
        SELECT categories FROM customer_purchase_history 
        WHERE customer_id = ? 
        ORDER BY purchase_date DESC 
        LIMIT 10
      `, [customerId]);

      // Extract frequently purchased categories
      const categoryFrequency = {};
      purchaseHistory.forEach(purchase => {
        const categories = JSON.parse(purchase.categories || '[]');
        categories.forEach(cat => {
          categoryFrequency[cat] = (categoryFrequency[cat] || 0) + 1;
        });
      });

      const topCategories = Object.keys(categoryFrequency)
        .sort((a, b) => categoryFrequency[b] - categoryFrequency[a])
        .slice(0, 3);

      // Build recommendation query
      const relevantCategories = [...new Set([...preferredCats, ...topCategories])];
      
      let query = `
        SELECT 
          rc.*,
          CASE WHEN rc.total_quantity IS NULL THEN true 
               ELSE rc.available_quantity > 0 
          END as available,
          -- Scoring for personalization
          (
            CASE WHEN rc.points_cost <= ? * 0.8 THEN 10 ELSE 0 END + -- Affordable
            CASE WHEN rc.tier_requirement = ? OR rc.tier_requirement IS NULL THEN 15 ELSE 0 END + -- Tier appropriate
            CASE WHEN rc.featured = true THEN 5 ELSE 0 END + -- Featured
            CASE WHEN rc.reward_type = 'discount' THEN 8 ELSE 0 END + -- Popular type
            CASE WHEN JSON_OVERLAPS(rc.categories, ?) THEN 20 ELSE 0 END -- Category match
          ) as recommendation_score
        FROM rewards_catalog rc
        WHERE rc.status = 'active'
        AND (rc.valid_from IS NULL OR rc.valid_from <= NOW())
        AND (rc.valid_until IS NULL OR rc.valid_until >= NOW())
        AND rc.points_cost <= ?
        AND (rc.tier_requirement IS NULL OR 
             CASE WHEN ? = 'platinum' THEN true
                  WHEN ? = 'gold' AND rc.tier_requirement IN ('gold', 'silver', 'bronze') THEN true
                  WHEN ? = 'silver' AND rc.tier_requirement IN ('silver', 'bronze') THEN true
                  WHEN ? = 'bronze' AND rc.tier_requirement = 'bronze' THEN true
                  ELSE false
             END)
        ORDER BY recommendation_score DESC, rc.points_cost ASC
        LIMIT ?
      `;

      const [recommendations] = await this.db.execute(query, [
        available_points,
        current_tier,
        JSON.stringify(relevantCategories),
        available_points,
        current_tier,
        current_tier,
        current_tier,
        current_tier,
        limit
      ]);

      return recommendations.map(reward => ({
        ...reward,
        categories: JSON.parse(reward.categories || '[]'),
        applicable_products: JSON.parse(reward.applicable_products || '[]'),
        excluded_products: JSON.parse(reward.excluded_products || '[]'),
        recommendation_reason: this.getRecommendationReason(reward, preferredCats, topCategories)
      }));

    } catch (error) {
      console.error('Error getting personalized rewards:', error);
      throw error;
    }
  }

  /**
   * Redeem a reward
   */
  async redeemReward(customerId, rewardId, metadata = {}) {
    const redemptionId = uuidv4();
    
    try {
      await this.db.beginTransaction();

      // Get reward details
      const [reward] = await this.db.execute(`
        SELECT * FROM rewards_catalog WHERE reward_id = ? AND status = 'active'
      `, [rewardId]);

      if (reward.length === 0) {
        throw new Error('Reward not found or inactive');
      }

      const rewardData = reward[0];

      // Check reward availability
      if (rewardData.total_quantity !== null && rewardData.available_quantity <= 0) {
        throw new Error('Reward is out of stock');
      }

      // Check validity
      if (rewardData.valid_until && new Date(rewardData.valid_until) < new Date()) {
        throw new Error('Reward has expired');
      }

      // Get customer details
      const [customer] = await this.db.execute(`
        SELECT current_tier, available_points FROM customer_profiles WHERE customer_id = ?
      `, [customerId]);

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { current_tier, available_points } = customer[0];

      // Check tier eligibility
      if (rewardData.tier_requirement) {
        const tierLevels = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
        if (tierLevels[current_tier] < tierLevels[rewardData.tier_requirement]) {
          throw new Error('Customer tier is not eligible for this reward');
        }
      }

      // Check points sufficiency
      if (available_points < rewardData.points_cost) {
        throw new Error('Insufficient points');
      }

      // Check redemption limits
      const [redemptionCount] = await this.db.execute(`
        SELECT COUNT(*) as count FROM reward_redemptions 
        WHERE customer_id = ? AND reward_id = ?
      `, [customerId, rewardId]);

      if (rewardData.max_per_customer && redemptionCount[0].count >= rewardData.max_per_customer) {
        throw new Error('Maximum redemptions reached for this reward');
      }

      // Generate redemption code
      const redemptionCode = this.generateRedemptionCode();
      
      // Calculate expiration (default 90 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      // Create redemption record
      await this.db.execute(`
        INSERT INTO reward_redemptions (
          redemption_id, customer_id, reward_id, points_used, cash_value,
          redemption_code, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        redemptionId,
        customerId,
        rewardId,
        rewardData.points_cost,
        rewardData.cash_value || 0,
        redemptionCode,
        expiresAt,
        'active'
      ]);

      // Deduct points using points service
      // This would integrate with the points service
      await this.deductCustomerPoints(customerId, rewardData.points_cost, {
        reward_id: rewardId,
        redemption_id: redemptionId,
        description: `Redeemed: ${rewardData.title}`
      });

      // Update reward availability
      if (rewardData.total_quantity !== null) {
        await this.db.execute(`
          UPDATE rewards_catalog 
          SET available_quantity = available_quantity - 1,
              updated_at = NOW()
          WHERE reward_id = ?
        `, [rewardId]);
      }

      await this.db.commit();

      // Send redemption notification
      await this.sendRedemptionNotification(customerId, rewardData, redemptionCode);

      return {
        success: true,
        redemption_id: redemptionId,
        redemption_code: redemptionCode,
        reward: {
          title: rewardData.title,
          type: rewardData.reward_type,
          points_used: rewardData.points_cost,
          cash_value: rewardData.cash_value
        },
        expires_at: expiresAt
      };

    } catch (error) {
      await this.db.rollback();
      console.error('Error redeeming reward:', error);
      throw error;
    }
  }

  /**
   * Get customer's redemption history
   */
  async getRedemptionHistory(customerId, options = {}) {
    const {
      status = null,
      limit = 20,
      offset = 0
    } = options;

    try {
      let query = `
        SELECT 
          rr.*,
          rc.title,
          rc.description,
          rc.reward_type,
          rc.image_url,
          CASE 
            WHEN rr.status = 'used' THEN 'Used'
            WHEN rr.expires_at < NOW() THEN 'Expired'
            WHEN rr.status = 'cancelled' THEN 'Cancelled'
            ELSE 'Active'
          END as display_status
        FROM reward_redemptions rr
        JOIN rewards_catalog rc ON rr.reward_id = rc.reward_id
        WHERE rr.customer_id = ?
      `;

      const params = [customerId];

      if (status) {
        query += ` AND rr.status = ?`;
        params.push(status);
      }

      query += ` ORDER BY rr.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [redemptions] = await this.db.execute(query, params);

      return redemptions;

    } catch (error) {
      console.error('Error getting redemption history:', error);
      throw error;
    }
  }

  /**
   * Use a redemption (mark as used)
   */
  async useRedemption(redemptionCode, orderId = null) {
    try {
      // Get redemption details
      const [redemption] = await this.db.execute(`
        SELECT * FROM reward_redemptions WHERE redemption_code = ?
      `, [redemptionCode]);

      if (redemption.length === 0) {
        throw new Error('Invalid redemption code');
      }

      const redemptionData = redemption[0];

      // Check if already used
      if (redemptionData.used) {
        throw new Error('Redemption code has already been used');
      }

      // Check if expired
      if (new Date(redemptionData.expires_at) < new Date()) {
        throw new Error('Redemption code has expired');
      }

      // Check if cancelled
      if (redemptionData.status === 'cancelled') {
        throw new Error('Redemption code has been cancelled');
      }

      // Mark as used
      await this.db.execute(`
        UPDATE reward_redemptions 
        SET used = true, 
            used_at = NOW(), 
            used_order_id = ?,
            status = 'used',
            updated_at = NOW()
        WHERE redemption_code = ?
      `, [orderId, redemptionCode]);

      return {
        success: true,
        redemption_id: redemptionData.redemption_id,
        customer_id: redemptionData.customer_id,
        points_value: redemptionData.points_used,
        cash_value: redemptionData.cash_value
      };

    } catch (error) {
      console.error('Error using redemption:', error);
      throw error;
    }
  }

  /**
   * Create or update reward in catalog
   */
  async createReward(rewardData) {
    const rewardId = rewardData.reward_id || uuidv4();

    const reward = {
      reward_id: rewardId,
      title: rewardData.title,
      description: rewardData.description || null,
      reward_type: rewardData.reward_type,
      points_cost: rewardData.points_cost,
      cash_value: rewardData.cash_value || null,
      tier_requirement: rewardData.tier_requirement || null,
      product_id: rewardData.product_id || null,
      discount_percentage: rewardData.discount_percentage || null,
      discount_amount: rewardData.discount_amount || null,
      minimum_purchase: rewardData.minimum_purchase || null,
      total_quantity: rewardData.total_quantity || null,
      available_quantity: rewardData.available_quantity || rewardData.total_quantity,
      max_per_customer: rewardData.max_per_customer || 1,
      valid_from: rewardData.valid_from || null,
      valid_until: rewardData.valid_until || null,
      categories: JSON.stringify(rewardData.categories || []),
      applicable_products: JSON.stringify(rewardData.applicable_products || []),
      excluded_products: JSON.stringify(rewardData.excluded_products || []),
      status: rewardData.status || 'active',
      featured: rewardData.featured || false,
      image_url: rewardData.image_url || null,
      terms_conditions: rewardData.terms_conditions || null
    };

    try {
      const [result] = await this.db.execute(
        `INSERT INTO rewards_catalog SET ? ON DUPLICATE KEY UPDATE ?`,
        [reward, reward]
      );

      return {
        success: true,
        reward_id: rewardId,
        action: result.affectedRows === 1 ? 'created' : 'updated'
      };

    } catch (error) {
      console.error('Error creating/updating reward:', error);
      throw error;
    }
  }

  /**
   * Get reward analytics
   */
  async getRewardAnalytics(rewardId = null) {
    try {
      let query = `
        SELECT 
          rc.reward_id,
          rc.title,
          rc.reward_type,
          rc.points_cost,
          COUNT(rr.redemption_id) as total_redemptions,
          COUNT(CASE WHEN rr.used = true THEN 1 END) as total_used,
          COUNT(CASE WHEN rr.status = 'active' THEN 1 END) as active_redemptions,
          COUNT(CASE WHEN rr.expires_at < NOW() AND rr.used = false THEN 1 END) as expired_unused,
          COALESCE(SUM(rr.points_used), 0) as total_points_redeemed,
          COALESCE(AVG(rr.points_used), 0) as avg_points_per_redemption,
          COUNT(DISTINCT rr.customer_id) as unique_customers,
          
          -- Redemption rate by tier
          COUNT(CASE WHEN cp.current_tier = 'bronze' THEN 1 END) as bronze_redemptions,
          COUNT(CASE WHEN cp.current_tier = 'silver' THEN 1 END) as silver_redemptions,
          COUNT(CASE WHEN cp.current_tier = 'gold' THEN 1 END) as gold_redemptions,
          COUNT(CASE WHEN cp.current_tier = 'platinum' THEN 1 END) as platinum_redemptions,
          
          -- Time-based metrics
          COUNT(CASE WHEN rr.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as redemptions_30d,
          COUNT(CASE WHEN rr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as redemptions_7d
          
        FROM rewards_catalog rc
        LEFT JOIN reward_redemptions rr ON rc.reward_id = rr.reward_id
        LEFT JOIN customer_profiles cp ON rr.customer_id = cp.customer_id
        WHERE rc.status = 'active'
      `;

      const params = [];

      if (rewardId) {
        query += ` AND rc.reward_id = ?`;
        params.push(rewardId);
      }

      query += ` GROUP BY rc.reward_id ORDER BY total_redemptions DESC`;

      const [analytics] = await this.db.execute(query, params);

      return analytics.map(reward => ({
        ...reward,
        usage_rate: reward.total_redemptions > 0 ? 
          ((reward.total_used / reward.total_redemptions) * 100).toFixed(2) : 0,
        popularity_score: this.calculatePopularityScore(reward)
      }));

    } catch (error) {
      console.error('Error getting reward analytics:', error);
      throw error;
    }
  }

  // Helper methods
  generateRedemptionCode() {
    return 'RWD-' + Math.random().toString(36).substr(2, 12).toUpperCase();
  }

  getRecommendationReason(reward, preferredCategories, topPurchaseCategories) {
    const rewardCategories = JSON.parse(reward.categories || '[]');
    
    if (rewardCategories.some(cat => preferredCategories.includes(cat))) {
      return 'Based on your preferences';
    }
    
    if (rewardCategories.some(cat => topPurchaseCategories.includes(cat))) {
      return 'Based on your purchase history';
    }
    
    if (reward.featured) {
      return 'Featured reward';
    }
    
    if (reward.recommendation_score > 15) {
      return 'Popular choice';
    }
    
    return 'Good value';
  }

  calculatePopularityScore(rewardData) {
    const {
      total_redemptions,
      unique_customers,
      redemptions_30d,
      total_used,
      points_cost
    } = rewardData;

    // Normalize and weight different factors
    const redemptionWeight = Math.min(total_redemptions / 10, 10); // Max 10 points
    const uniquenessWeight = Math.min(unique_customers / 5, 5); // Max 5 points
    const recentActivityWeight = Math.min(redemptions_30d / 3, 3); // Max 3 points
    const usageWeight = total_redemptions > 0 ? (total_used / total_redemptions) * 2 : 0; // Max 2 points

    return Math.round(redemptionWeight + uniquenessWeight + recentActivityWeight + usageWeight);
  }

  async deductCustomerPoints(customerId, points, metadata) {
    // This would integrate with the points service
    // For now, we'll do a direct database update
    const transactionId = uuidv4();
    
    const [customer] = await this.db.execute(
      `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    const newBalance = customer[0].available_points - points;

    await this.db.execute(`
      INSERT INTO points_transactions (
        transaction_id, customer_id, transaction_type, points_amount, 
        balance_after, event_type, description, metadata
      ) VALUES (?, ?, 'redeem', ?, ?, 'redemption', ?, ?)
    `, [
      transactionId,
      customerId,
      -points,
      newBalance,
      metadata.description,
      JSON.stringify(metadata)
    ]);

    await this.db.execute(`
      UPDATE customer_profiles 
      SET available_points = available_points - ?,
          last_activity_date = NOW(),
          updated_at = NOW()
      WHERE customer_id = ?
    `, [points, customerId]);
  }

  async sendRedemptionNotification(customerId, reward, redemptionCode) {
    // Implementation in notification service
  }
}

export default RewardsService;