/**
 * Points Service
 * Handles all point-related operations: earning, redemption, expiration, and calculations
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  POINT_EVENTS, 
  TRANSACTION_TYPES, 
  DEFAULT_POINT_VALUES, 
  POINT_EXPIRATION,
  TIER_MULTIPLIERS 
} from '../types/index.js';

class PointsService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Award points for various events
   */
  async awardPoints(customerId, eventType, amount, metadata = {}) {
    const transactionId = uuidv4();
    
    try {
      // Get customer's current tier for multiplier
      const [customer] = await this.db.execute(
        `SELECT current_tier, available_points FROM customer_profiles WHERE customer_id = ?`,
        [customerId]
      );

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { current_tier, available_points } = customer[0];
      const tierMultiplier = TIER_MULTIPLIERS[current_tier] || 1.0;
      const campaignMultiplier = metadata.campaign_multiplier || 1.0;
      
      // Calculate final points with multipliers
      const basePoints = amount || DEFAULT_POINT_VALUES[eventType] || 0;
      const finalPoints = Math.round(basePoints * tierMultiplier * campaignMultiplier);
      const newBalance = available_points + finalPoints;

      // Calculate expiration date
      const expirationDays = POINT_EXPIRATION[eventType] || POINT_EXPIRATION.DEFAULT;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expirationDays);

      // Insert points transaction
      await this.db.execute(`
        INSERT INTO points_transactions (
          transaction_id, customer_id, transaction_type, points_amount, balance_after,
          event_type, order_id, campaign_id, multiplier, description, metadata, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transactionId,
        customerId,
        TRANSACTION_TYPES.EARN,
        finalPoints,
        newBalance,
        eventType,
        metadata.order_id || null,
        metadata.campaign_id || null,
        tierMultiplier * campaignMultiplier,
        metadata.description || `Points earned for ${eventType}`,
        JSON.stringify(metadata),
        expiresAt
      ]);

      // Update customer's point balances
      await this.db.execute(`
        UPDATE customer_profiles SET 
          available_points = available_points + ?,
          total_points = total_points + ?,
          lifetime_points = lifetime_points + ?,
          tier_points = tier_points + ?,
          last_activity_date = NOW(),
          updated_at = NOW()
        WHERE customer_id = ?
      `, [finalPoints, finalPoints, finalPoints, finalPoints, customerId]);

      // Update tier if necessary
      await this.updateCustomerTier(customerId);

      // Send notification
      await this.sendPointsEarnedNotification(customerId, finalPoints, eventType);

      return {
        success: true,
        transaction_id: transactionId,
        points_awarded: finalPoints,
        new_balance: newBalance,
        multiplier_applied: tierMultiplier * campaignMultiplier,
        expires_at: expiresAt
      };

    } catch (error) {
      console.error('Error awarding points:', error);
      throw new Error('Failed to award points');
    }
  }

  /**
   * Redeem points for rewards
   */
  async redeemPoints(customerId, pointsToRedeem, rewardId = null, metadata = {}) {
    const transactionId = uuidv4();
    
    try {
      // Get customer's available points
      const [customer] = await this.db.execute(
        `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
        [customerId]
      );

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { available_points } = customer[0];

      if (available_points < pointsToRedeem) {
        throw new Error('Insufficient points');
      }

      const newBalance = available_points - pointsToRedeem;

      // Insert redemption transaction
      await this.db.execute(`
        INSERT INTO points_transactions (
          transaction_id, customer_id, transaction_type, points_amount, balance_after,
          event_type, order_id, description, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transactionId,
        customerId,
        TRANSACTION_TYPES.REDEEM,
        -pointsToRedeem,
        newBalance,
        'redemption',
        metadata.order_id || null,
        metadata.description || 'Points redeemed for reward',
        JSON.stringify({ reward_id: rewardId, ...metadata })
      ]);

      // Update customer's available points
      await this.db.execute(`
        UPDATE customer_profiles SET 
          available_points = available_points - ?,
          last_activity_date = NOW(),
          updated_at = NOW()
        WHERE customer_id = ?
      `, [pointsToRedeem, customerId]);

      return {
        success: true,
        transaction_id: transactionId,
        points_redeemed: pointsToRedeem,
        new_balance: newBalance
      };

    } catch (error) {
      console.error('Error redeeming points:', error);
      throw error;
    }
  }

  /**
   * Calculate points for purchase
   */
  async calculatePurchasePoints(customerId, purchaseAmount, categories = [], campaignId = null) {
    try {
      // Get customer tier
      const [customer] = await this.db.execute(
        `SELECT current_tier FROM customer_profiles WHERE customer_id = ?`,
        [customerId]
      );

      if (customer.length === 0) {
        throw new Error('Customer not found');
      }

      const { current_tier } = customer[0];
      const tierMultiplier = TIER_MULTIPLIERS[current_tier] || 1.0;

      // Base points (1 point per dollar)
      const basePoints = Math.floor(purchaseAmount * DEFAULT_POINT_VALUES[POINT_EVENTS.PURCHASE]);

      // Check for active campaigns
      let campaignMultiplier = 1.0;
      let campaignBonus = 0;

      if (campaignId) {
        const [campaign] = await this.db.execute(`
          SELECT multiplier, bonus_points, applicable_categories 
          FROM loyalty_campaigns 
          WHERE campaign_id = ? AND status = 'active' 
          AND start_date <= NOW() AND end_date >= NOW()
        `, [campaignId]);

        if (campaign.length > 0) {
          const { multiplier, bonus_points, applicable_categories } = campaign[0];
          const applicableCategories = JSON.parse(applicable_categories || '[]');
          
          // Check if purchase categories match campaign categories
          if (applicableCategories.length === 0 || 
              categories.some(cat => applicableCategories.includes(cat))) {
            campaignMultiplier = multiplier || 1.0;
            campaignBonus = bonus_points || 0;
          }
        }
      }

      // Category-specific bonuses
      const categoryBonus = this.calculateCategoryBonus(categories, purchaseAmount);

      // Calculate final points
      const multipliedPoints = Math.round(basePoints * tierMultiplier * campaignMultiplier);
      const totalPoints = multipliedPoints + campaignBonus + categoryBonus;

      return {
        base_points: basePoints,
        tier_multiplier: tierMultiplier,
        campaign_multiplier: campaignMultiplier,
        campaign_bonus: campaignBonus,
        category_bonus: categoryBonus,
        total_points: totalPoints,
        breakdown: {
          base: basePoints,
          tier_bonus: Math.round(basePoints * (tierMultiplier - 1)),
          campaign_bonus: Math.round(basePoints * (campaignMultiplier - 1)) + campaignBonus,
          category_bonus: categoryBonus
        }
      };

    } catch (error) {
      console.error('Error calculating purchase points:', error);
      throw error;
    }
  }

  /**
   * Process purchase and award points
   */
  async processPurchase(customerId, purchaseData) {
    try {
      const {
        order_id,
        total_amount,
        categories = [],
        campaign_id = null,
        items = []
      } = purchaseData;

      // Calculate points
      const pointsCalculation = await this.calculatePurchasePoints(
        customerId, 
        total_amount, 
        categories, 
        campaign_id
      );

      // Award points
      const pointsResult = await this.awardPoints(
        customerId,
        POINT_EVENTS.PURCHASE,
        pointsCalculation.total_points,
        {
          order_id,
          campaign_id,
          purchase_amount: total_amount,
          categories,
          description: `Points earned for purchase #${order_id}`
        }
      );

      // Record purchase history
      await this.recordPurchaseHistory(customerId, purchaseData, pointsCalculation);

      // Update customer statistics
      await this.updatePurchaseStatistics(customerId, total_amount);

      return {
        ...pointsResult,
        points_calculation: pointsCalculation
      };

    } catch (error) {
      console.error('Error processing purchase:', error);
      throw error;
    }
  }

  /**
   * Get points balance and summary
   */
  async getPointsBalance(customerId) {
    try {
      const [balance] = await this.db.execute(`
        SELECT 
          cp.available_points,
          cp.total_points,
          cp.lifetime_points,
          
          -- Points expiring in next 30 days
          COALESCE(expiring.expiring_points, 0) as points_expiring_soon,
          
          -- Recent activity (last 30 days)
          COALESCE(recent.points_earned, 0) as points_earned_30d,
          COALESCE(recent.points_redeemed, 0) as points_redeemed_30d,
          
          -- All-time stats
          COALESCE(lifetime.total_earned, 0) as lifetime_points_earned,
          COALESCE(lifetime.total_redeemed, 0) as lifetime_points_redeemed
          
        FROM customer_profiles cp
        LEFT JOIN (
          SELECT 
            customer_id,
            SUM(points_amount) as expiring_points
          FROM points_transactions 
          WHERE transaction_type = 'earn' 
          AND expired = false
          AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)
          GROUP BY customer_id
        ) expiring ON cp.customer_id = expiring.customer_id
        LEFT JOIN (
          SELECT 
            customer_id,
            SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) as points_earned,
            SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) as points_redeemed
          FROM points_transactions 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY customer_id
        ) recent ON cp.customer_id = recent.customer_id
        LEFT JOIN (
          SELECT 
            customer_id,
            SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) as total_earned,
            SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) as total_redeemed
          FROM points_transactions 
          GROUP BY customer_id
        ) lifetime ON cp.customer_id = lifetime.customer_id
        WHERE cp.customer_id = ?
      `, [customerId]);

      if (balance.length === 0) {
        throw new Error('Customer not found');
      }

      return balance[0];

    } catch (error) {
      console.error('Error getting points balance:', error);
      throw error;
    }
  }

  /**
   * Get points transaction history
   */
  async getPointsHistory(customerId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      transaction_type = null,
      event_type = null,
      start_date = null,
      end_date = null
    } = options;

    try {
      let query = `
        SELECT 
          pt.*,
          CASE 
            WHEN pt.expires_at < NOW() AND pt.transaction_type = 'earn' THEN 'expired'
            WHEN pt.expires_at IS NOT NULL AND pt.expires_at <= DATE_ADD(NOW(), INTERVAL 30 DAY) THEN 'expiring_soon'
            ELSE 'active'
          END as status
        FROM points_transactions pt
        WHERE pt.customer_id = ?
      `;

      const params = [customerId];

      if (transaction_type) {
        query += ` AND pt.transaction_type = ?`;
        params.push(transaction_type);
      }

      if (event_type) {
        query += ` AND pt.event_type = ?`;
        params.push(event_type);
      }

      if (start_date) {
        query += ` AND pt.created_at >= ?`;
        params.push(start_date);
      }

      if (end_date) {
        query += ` AND pt.created_at <= ?`;
        params.push(end_date);
      }

      query += ` ORDER BY pt.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [transactions] = await this.db.execute(query, params);

      // Parse metadata for each transaction
      return transactions.map(transaction => ({
        ...transaction,
        metadata: JSON.parse(transaction.metadata || '{}')
      }));

    } catch (error) {
      console.error('Error getting points history:', error);
      throw error;
    }
  }

  /**
   * Expire old points
   */
  async expirePoints() {
    try {
      // Find expired points
      const [expiredTransactions] = await this.db.execute(`
        SELECT customer_id, SUM(points_amount) as expired_points
        FROM points_transactions 
        WHERE transaction_type = 'earn' 
        AND expired = false 
        AND expires_at < NOW()
        GROUP BY customer_id
      `);

      for (const expiredData of expiredTransactions) {
        const { customer_id, expired_points } = expiredData;

        // Mark transactions as expired
        await this.db.execute(`
          UPDATE points_transactions 
          SET expired = true, processed_at = NOW()
          WHERE customer_id = ? 
          AND transaction_type = 'earn' 
          AND expired = false 
          AND expires_at < NOW()
        `, [customer_id]);

        // Create expiration transaction
        const transactionId = uuidv4();
        const [customer] = await this.db.execute(
          `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
          [customer_id]
        );

        const newBalance = customer[0].available_points - expired_points;

        await this.db.execute(`
          INSERT INTO points_transactions (
            transaction_id, customer_id, transaction_type, points_amount, 
            balance_after, event_type, description
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          transactionId,
          customer_id,
          TRANSACTION_TYPES.EXPIRE,
          -expired_points,
          newBalance,
          'expiration',
          `${expired_points} points expired`
        ]);

        // Update customer's available points
        await this.db.execute(`
          UPDATE customer_profiles 
          SET available_points = available_points - ?,
              updated_at = NOW()
          WHERE customer_id = ?
        `, [expired_points, customer_id]);

        // Send expiration notification
        await this.sendPointsExpirationNotification(customer_id, expired_points);
      }

      return {
        customers_affected: expiredTransactions.length,
        total_points_expired: expiredTransactions.reduce((sum, data) => sum + data.expired_points, 0)
      };

    } catch (error) {
      console.error('Error expiring points:', error);
      throw error;
    }
  }

  // Helper methods
  calculateCategoryBonus(categories, purchaseAmount) {
    // Define category-specific bonus rates
    const categoryBonuses = {
      'electronics': 0.5, // 0.5 extra points per dollar
      'fashion': 0.3,
      'health': 0.4,
      'books': 0.2
    };

    let bonus = 0;
    categories.forEach(category => {
      if (categoryBonuses[category]) {
        bonus += Math.floor(purchaseAmount * categoryBonuses[category]);
      }
    });

    return bonus;
  }

  async recordPurchaseHistory(customerId, purchaseData, pointsCalculation) {
    const {
      order_id,
      total_amount,
      tax_amount = 0,
      shipping_amount = 0,
      discount_amount = 0,
      categories = [],
      items = [],
      purchase_channel = 'online',
      source_campaign = null
    } = purchaseData;

    const [customer] = await this.db.execute(
      `SELECT current_tier FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    await this.db.execute(`
      INSERT INTO customer_purchase_history (
        purchase_id, customer_id, order_id, purchase_date, total_amount,
        tax_amount, shipping_amount, discount_amount, points_earned,
        tier_at_purchase, multiplier_applied, items, categories,
        purchase_channel, source_campaign
      ) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      customerId,
      order_id,
      total_amount,
      tax_amount,
      shipping_amount,
      discount_amount,
      pointsCalculation.total_points,
      customer[0]?.current_tier || 'bronze',
      pointsCalculation.tier_multiplier * pointsCalculation.campaign_multiplier,
      JSON.stringify(items),
      JSON.stringify(categories),
      purchase_channel,
      source_campaign
    ]);
  }

  async updatePurchaseStatistics(customerId, purchaseAmount) {
    await this.db.execute(`
      UPDATE customer_profiles SET
        total_purchases = total_purchases + 1,
        total_spent = total_spent + ?,
        average_order_value = total_spent / total_purchases,
        last_purchase_date = NOW(),
        last_activity_date = NOW(),
        updated_at = NOW()
      WHERE customer_id = ?
    `, [purchaseAmount, customerId]);
  }

  async updateCustomerTier(customerId) {
    // This would call the customer profile service
    // Implementation depends on service architecture
  }

  async sendPointsEarnedNotification(customerId, points, eventType) {
    // Implementation in notification service
  }

  async sendPointsExpirationNotification(customerId, expiredPoints) {
    // Implementation in notification service
  }
}

export default PointsService;