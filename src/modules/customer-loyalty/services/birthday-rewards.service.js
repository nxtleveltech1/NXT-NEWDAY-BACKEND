/**
 * Birthday Rewards Service
 * Handles birthday reward processing and management
 */

import { v4 as uuidv4 } from 'uuid';
import { POINT_EVENTS, DEFAULT_POINT_VALUES } from '../types/index.js';

class BirthdayRewardsService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Process birthday rewards for customers
   * This should be run daily via cron job
   */
  async processBirthdayRewards() {
    try {
      // Get customers whose birthday is today
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const currentYear = today.getFullYear();

      const [birthdayCustomers] = await this.db.execute(`
        SELECT 
          cp.customer_id,
          cp.first_name,
          cp.last_name,
          cp.email,
          cp.date_of_birth,
          cp.current_tier,
          COALESCE(br.awarded, false) as already_awarded
        FROM customer_profiles cp
        LEFT JOIN birthday_rewards br ON cp.customer_id = br.customer_id 
          AND br.birthday_year = ?
        WHERE cp.date_of_birth IS NOT NULL
          AND DATE_FORMAT(cp.date_of_birth, '%m-%d') = DATE_FORMAT(?, '%m-%d')
          AND cp.status = 'active'
          AND (br.awarded IS NULL OR br.awarded = false)
      `, [currentYear, todayStr]);

      const results = [];

      for (const customer of birthdayCustomers) {
        try {
          const result = await this.awardBirthdayReward(customer, currentYear);
          results.push({
            customer_id: customer.customer_id,
            success: true,
            ...result
          });
        } catch (error) {
          console.error(`Error awarding birthday reward to ${customer.customer_id}:`, error);
          results.push({
            customer_id: customer.customer_id,
            success: false,
            error: error.message
          });
        }
      }

      return {
        total_processed: birthdayCustomers.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results
      };

    } catch (error) {
      console.error('Error processing birthday rewards:', error);
      throw error;
    }
  }

  /**
   * Award birthday reward to a specific customer
   */
  async awardBirthdayReward(customer, year = null) {
    const currentYear = year || new Date().getFullYear();

    try {
      // Check if already awarded this year
      const [existing] = await this.db.execute(`
        SELECT awarded FROM birthday_rewards 
        WHERE customer_id = ? AND birthday_year = ?
      `, [customer.customer_id, currentYear]);

      if (existing.length > 0 && existing[0].awarded) {
        throw new Error('Birthday reward already awarded this year');
      }

      // Calculate birthday reward based on tier
      const reward = this.calculateBirthdayReward(customer.current_tier);

      // Set expiration (birthday rewards expire after 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await this.db.beginTransaction();

      // Create birthday reward record
      if (existing.length === 0) {
        await this.db.execute(`
          INSERT INTO birthday_rewards (
            customer_id, birthday_year, points_awarded, reward_id,
            awarded, awarded_date, expires_at
          ) VALUES (?, ?, ?, ?, true, NOW(), ?)
        `, [
          customer.customer_id,
          currentYear,
          reward.points,
          reward.reward_id || null,
          expiresAt
        ]);
      } else {
        await this.db.execute(`
          UPDATE birthday_rewards 
          SET points_awarded = ?, 
              reward_id = ?,
              awarded = true, 
              awarded_date = NOW(),
              expires_at = ?
          WHERE customer_id = ? AND birthday_year = ?
        `, [
          reward.points,
          reward.reward_id || null,
          expiresAt,
          customer.customer_id,
          currentYear
        ]);
      }

      // Award points
      if (reward.points > 0) {
        await this.awardBirthdayPoints(customer.customer_id, reward.points);
      }

      // Create special birthday reward if applicable
      if (reward.special_reward) {
        await this.createSpecialBirthdayReward(customer, reward.special_reward);
      }

      await this.db.commit();

      // Send birthday notification
      await this.sendBirthdayNotification(customer, reward);

      return {
        points_awarded: reward.points,
        special_reward: reward.special_reward,
        expires_at: expiresAt,
        message: reward.message
      };

    } catch (error) {
      await this.db.rollback();
      throw error;
    }
  }

  /**
   * Get customer's birthday reward history
   */
  async getBirthdayHistory(customerId) {
    try {
      const [history] = await this.db.execute(`
        SELECT 
          br.*,
          rc.title as reward_title,
          rc.description as reward_description,
          rc.reward_type
        FROM birthday_rewards br
        LEFT JOIN rewards_catalog rc ON br.reward_id = rc.reward_id
        WHERE br.customer_id = ?
        ORDER BY br.birthday_year DESC
      `, [customerId]);

      return history;

    } catch (error) {
      console.error('Error getting birthday history:', error);
      throw error;
    }
  }

  /**
   * Check if customer is eligible for birthday reward
   */
  async checkBirthdayEligibility(customerId) {
    try {
      const [customer] = await this.db.execute(`
        SELECT 
          cp.date_of_birth,
          cp.current_tier,
          cp.enrollment_date,
          COALESCE(br.awarded, false) as current_year_awarded
        FROM customer_profiles cp
        LEFT JOIN birthday_rewards br ON cp.customer_id = br.customer_id 
          AND br.birthday_year = YEAR(NOW())
        WHERE cp.customer_id = ? AND cp.status = 'active'
      `, [customerId]);

      if (customer.length === 0) {
        return { eligible: false, reason: 'Customer not found or inactive' };
      }

      const customerData = customer[0];

      if (!customerData.date_of_birth) {
        return { eligible: false, reason: 'Date of birth not provided' };
      }

      if (customerData.current_year_awarded) {
        return { eligible: false, reason: 'Birthday reward already claimed this year' };
      }

      // Check if it's their birthday (within 7 days of birthday for flexibility)
      const today = new Date();
      const birthday = new Date(customerData.date_of_birth);
      birthday.setFullYear(today.getFullYear());

      const daysDiff = Math.abs((today - birthday) / (1000 * 60 * 60 * 24));

      if (daysDiff > 7) {
        const nextBirthday = new Date(birthday);
        if (today > birthday) {
          nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
        }

        return {
          eligible: false,
          reason: 'Not within birthday reward window',
          next_birthday: nextBirthday.toISOString().split('T')[0],
          days_until_birthday: Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24))
        };
      }

      const reward = this.calculateBirthdayReward(customerData.current_tier);

      return {
        eligible: true,
        reward: reward,
        birthday_date: birthday.toISOString().split('T')[0]
      };

    } catch (error) {
      console.error('Error checking birthday eligibility:', error);
      return { eligible: false, reason: 'Error checking eligibility' };
    }
  }

  /**
   * Get upcoming birthdays for marketing campaigns
   */
  async getUpcomingBirthdays(days = 7) {
    try {
      const [customers] = await this.db.execute(`
        SELECT 
          cp.customer_id,
          cp.first_name,
          cp.last_name,
          cp.email,
          cp.date_of_birth,
          cp.current_tier,
          DATE_FORMAT(cp.date_of_birth, '%m-%d') as birthday_md,
          DATEDIFF(
            STR_TO_DATE(
              CONCAT(YEAR(NOW()), '-', DATE_FORMAT(cp.date_of_birth, '%m-%d')), 
              '%Y-%m-%d'
            ), 
            NOW()
          ) as days_until_birthday
        FROM customer_profiles cp
        LEFT JOIN birthday_rewards br ON cp.customer_id = br.customer_id 
          AND br.birthday_year = YEAR(NOW())
        WHERE cp.date_of_birth IS NOT NULL
          AND cp.status = 'active'
          AND (br.awarded IS NULL OR br.awarded = false)
        HAVING days_until_birthday BETWEEN 0 AND ?
        ORDER BY days_until_birthday ASC
      `, [days]);

      return customers.map(customer => ({
        ...customer,
        expected_reward: this.calculateBirthdayReward(customer.current_tier)
      }));

    } catch (error) {
      console.error('Error getting upcoming birthdays:', error);
      throw error;
    }
  }

  /**
   * Get birthday rewards analytics
   */
  async getBirthdayAnalytics(year = null) {
    const targetYear = year || new Date().getFullYear();

    try {
      const [analytics] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_birthday_customers,
          COUNT(CASE WHEN br.awarded = true THEN 1 END) as rewards_awarded,
          COUNT(CASE WHEN br.redeemed = true THEN 1 END) as rewards_redeemed,
          COALESCE(SUM(br.points_awarded), 0) as total_points_awarded,
          COALESCE(AVG(br.points_awarded), 0) as avg_points_per_customer,
          
          -- Tier breakdown
          COUNT(CASE WHEN cp.current_tier = 'bronze' AND br.awarded = true THEN 1 END) as bronze_rewards,
          COUNT(CASE WHEN cp.current_tier = 'silver' AND br.awarded = true THEN 1 END) as silver_rewards,
          COUNT(CASE WHEN cp.current_tier = 'gold' AND br.awarded = true THEN 1 END) as gold_rewards,
          COUNT(CASE WHEN cp.current_tier = 'platinum' AND br.awarded = true THEN 1 END) as platinum_rewards,
          
          -- Monthly breakdown
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 1 AND br.awarded = true THEN 1 END) as january_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 2 AND br.awarded = true THEN 1 END) as february_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 3 AND br.awarded = true THEN 1 END) as march_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 4 AND br.awarded = true THEN 1 END) as april_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 5 AND br.awarded = true THEN 1 END) as may_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 6 AND br.awarded = true THEN 1 END) as june_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 7 AND br.awarded = true THEN 1 END) as july_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 8 AND br.awarded = true THEN 1 END) as august_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 9 AND br.awarded = true THEN 1 END) as september_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 10 AND br.awarded = true THEN 1 END) as october_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 11 AND br.awarded = true THEN 1 END) as november_rewards,
          COUNT(CASE WHEN MONTH(cp.date_of_birth) = 12 AND br.awarded = true THEN 1 END) as december_rewards
          
        FROM customer_profiles cp
        LEFT JOIN birthday_rewards br ON cp.customer_id = br.customer_id 
          AND br.birthday_year = ?
        WHERE cp.date_of_birth IS NOT NULL
          AND cp.status = 'active'
      `, [targetYear]);

      const stats = analytics[0];

      return {
        year: targetYear,
        ...stats,
        reward_rate: stats.total_birthday_customers > 0 ? 
          ((stats.rewards_awarded / stats.total_birthday_customers) * 100).toFixed(2) : 0,
        redemption_rate: stats.rewards_awarded > 0 ? 
          ((stats.rewards_redeemed / stats.rewards_awarded) * 100).toFixed(2) : 0,
        tier_breakdown: {
          bronze: stats.bronze_rewards,
          silver: stats.silver_rewards,
          gold: stats.gold_rewards,
          platinum: stats.platinum_rewards
        },
        monthly_breakdown: {
          january: stats.january_rewards,
          february: stats.february_rewards,
          march: stats.march_rewards,
          april: stats.april_rewards,
          may: stats.may_rewards,
          june: stats.june_rewards,
          july: stats.july_rewards,
          august: stats.august_rewards,
          september: stats.september_rewards,
          october: stats.october_rewards,
          november: stats.november_rewards,
          december: stats.december_rewards
        }
      };

    } catch (error) {
      console.error('Error getting birthday analytics:', error);
      throw error;
    }
  }

  // Helper methods

  calculateBirthdayReward(tier) {
    const basePoints = DEFAULT_POINT_VALUES[POINT_EVENTS.BIRTHDAY] || 200;
    
    const tierMultipliers = {
      'bronze': 1.0,
      'silver': 1.2,
      'gold': 1.5,
      'platinum': 2.0
    };

    const multiplier = tierMultipliers[tier] || 1.0;
    const points = Math.round(basePoints * multiplier);

    const rewards = {
      'bronze': {
        points: points,
        message: '🎉 Happy Birthday! Enjoy your birthday points!',
        special_reward: null
      },
      'silver': {
        points: points,
        message: '🎂 Happy Birthday, Silver member! Extra birthday points for you!',
        special_reward: {
          type: 'discount',
          value: 10,
          description: '10% off your next purchase'
        }
      },
      'gold': {
        points: points,
        message: '🌟 Happy Birthday, Gold member! Premium birthday rewards await!',
        special_reward: {
          type: 'discount',
          value: 15,
          description: '15% off your next purchase + free shipping'
        }
      },
      'platinum': {
        points: points,
        message: '👑 Happy Birthday, Platinum VIP! Exclusive birthday celebration!',
        special_reward: {
          type: 'exclusive',
          value: 25,
          description: '25% off + free express shipping + birthday surprise gift'
        }
      }
    };

    return rewards[tier] || rewards['bronze'];
  }

  async awardBirthdayPoints(customerId, points) {
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
      ) VALUES (?, ?, 'earn', ?, ?, 'birthday', ?, ?)
    `, [
      transactionId,
      customerId,
      points,
      newBalance,
      'Happy Birthday! Birthday bonus points',
      JSON.stringify({ event: 'birthday_reward', year: new Date().getFullYear() })
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

  async createSpecialBirthdayReward(customer, specialReward) {
    if (!specialReward) return;

    const rewardId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Birthday rewards expire in 30 days

    await this.db.execute(`
      INSERT INTO rewards_catalog (
        reward_id, title, description, reward_type, points_cost, 
        discount_percentage, tier_requirement, total_quantity, available_quantity,
        valid_from, valid_until, status, categories
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active', ?)
    `, [
      rewardId,
      `Birthday Special - ${specialReward.description}`,
      `Exclusive birthday reward for ${customer.first_name}`,
      specialReward.type,
      0, // Free birthday reward
      specialReward.value,
      customer.current_tier,
      1, // Only for this customer
      1,
      expiresAt,
      JSON.stringify(['birthday', 'exclusive'])
    ]);

    // Auto-redeem the special reward
    await this.db.execute(`
      INSERT INTO reward_redemptions (
        redemption_id, customer_id, reward_id, points_used, 
        redemption_code, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      customer.customer_id,
      rewardId,
      0,
      `BIRTHDAY-${customer.customer_id.substr(-6).toUpperCase()}`,
      expiresAt,
      'active'
    ]);

    return rewardId;
  }

  async sendBirthdayNotification(customer, reward) {
    // This would integrate with notification service
    console.log(`Birthday notification sent to ${customer.email}: ${reward.message}`);
    
    // Could also trigger email, push notification, SMS, etc.
  }
}

export default BirthdayRewardsService;