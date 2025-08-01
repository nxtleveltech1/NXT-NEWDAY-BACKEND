/**
 * Gamification Service
 * Handles achievements, badges, streaks, and gamification elements
 */

import { v4 as uuidv4 } from 'uuid';
import { ACHIEVEMENT_TYPES, POINT_EVENTS, DEFAULT_POINT_VALUES } from '../types/index.js';

class GamificationService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  /**
   * Check and award achievements based on customer activity
   */
  async checkAchievements(customerId, eventType, eventData = {}) {
    try {
      const achievements = await this.getAvailableAchievements(eventType);
      const awardedAchievements = [];

      for (const achievement of achievements) {
        const eligible = await this.checkAchievementEligibility(
          customerId, 
          achievement, 
          eventData
        );

        if (eligible) {
          const awarded = await this.awardAchievement(customerId, achievement);
          if (awarded) {
            awardedAchievements.push(awarded);
          }
        }
      }

      return awardedAchievements;
    } catch (error) {
      console.error('Error checking achievements:', error);
      return [];
    }
  }

  /**
   * Get all achievements for a customer
   */
  async getCustomerAchievements(customerId, options = {}) {
    const {
      completed_only = false,
      achievement_type = null,
      limit = 50,
      offset = 0
    } = options;

    try {
      let query = `
        SELECT 
          ca.*,
          CASE 
            WHEN ca.completed = true THEN 100
            WHEN ca.target_value > 0 THEN ROUND((ca.current_value / ca.target_value) * 100, 2)
            ELSE 0
          END as progress_percentage
        FROM customer_achievements ca
        WHERE ca.customer_id = ?
      `;

      const params = [customerId];

      if (completed_only) {
        query += ` AND ca.completed = true`;
      }

      if (achievement_type) {
        query += ` AND ca.achievement_type = ?`;
        params.push(achievement_type);
      }

      query += ` ORDER BY ca.completed DESC, ca.unlocked_date DESC, ca.created_at DESC`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [achievements] = await this.db.execute(query, params);

      return achievements.map(achievement => ({
        ...achievement,
        metadata: JSON.parse(achievement.metadata || '{}')
      }));

    } catch (error) {
      console.error('Error getting customer achievements:', error);
      throw error;
    }
  }

  /**
   * Get achievement statistics
   */
  async getAchievementStats(customerId) {
    try {
      const [stats] = await this.db.execute(`
        SELECT 
          COUNT(*) as total_achievements,
          COUNT(CASE WHEN completed = true THEN 1 END) as completed_achievements,
          COUNT(CASE WHEN unlocked_date IS NOT NULL AND completed = false THEN 1 END) as in_progress_achievements,
          COALESCE(SUM(CASE WHEN completed = true THEN points_awarded ELSE 0 END), 0) as total_points_from_achievements,
          COUNT(CASE WHEN completed_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as achievements_30d,
          COUNT(CASE WHEN completed_date >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as achievements_7d
        FROM customer_achievements
        WHERE customer_id = ?
      `, [customerId]);

      // Get achievement breakdown by type
      const [breakdown] = await this.db.execute(`
        SELECT 
          achievement_type,
          COUNT(*) as total,
          COUNT(CASE WHEN completed = true THEN 1 END) as completed,
          COALESCE(SUM(CASE WHEN completed = true THEN points_awarded ELSE 0 END), 0) as points_earned
        FROM customer_achievements
        WHERE customer_id = ?
        GROUP BY achievement_type
      `, [customerId]);

      return {
        ...stats[0],
        completion_rate: stats[0].total_achievements > 0 ? 
          ((stats[0].completed_achievements / stats[0].total_achievements) * 100).toFixed(2) : 0,
        type_breakdown: breakdown
      };

    } catch (error) {
      console.error('Error getting achievement stats:', error);
      throw error;
    }
  }

  /**
   * Update customer streak
   */
  async updateStreak(customerId, eventType = 'purchase') {
    try {
      const [customer] = await this.db.execute(`
        SELECT streak_days, last_streak_date, last_activity_date
        FROM customer_profiles 
        WHERE customer_id = ?
      `, [customerId]);

      if (customer.length === 0) return 0;

      const { streak_days, last_streak_date, last_activity_date } = customer[0];
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const lastStreakDate = last_streak_date ? new Date(last_streak_date) : null;
      const lastStreakStr = lastStreakDate ? lastStreakDate.toISOString().split('T')[0] : null;

      let newStreakDays = streak_days || 0;
      let awardStreak = false;

      // Check if this is a consecutive day
      if (lastStreakStr) {
        const daysDiff = Math.floor((today - lastStreakDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
          // Consecutive day - increment streak
          newStreakDays += 1;
          awardStreak = true;
        } else if (daysDiff > 1) {
          // Streak broken - reset to 1
          newStreakDays = 1;
        } else if (daysDiff === 0) {
          // Same day - no change
          return newStreakDays;
        }
      } else {
        // First streak day
        newStreakDays = 1;
      }

      // Update customer profile
      await this.db.execute(`
        UPDATE customer_profiles 
        SET streak_days = ?, 
            last_streak_date = ?,
            updated_at = NOW()
        WHERE customer_id = ?
      `, [newStreakDays, todayStr, customerId]);

      // Award streak bonuses at milestones
      if (awardStreak && this.isStreakMilestone(newStreakDays)) {
        await this.awardStreakBonus(customerId, newStreakDays);
      }

      return newStreakDays;

    } catch (error) {
      console.error('Error updating streak:', error);
      return 0;
    }
  }

  /**
   * Get leaderboard
   */
  async getLeaderboard(type = 'points', timeframe = 'all_time', limit = 50) {
    try {
      let query = '';
      let params = [];

      switch (type) {
        case 'points':
          query = `
            SELECT 
              cp.customer_id,
              cp.first_name,
              cp.last_name,
              cp.current_tier,
              cp.lifetime_points as score,
              cp.engagement_score,
              cp.total_purchases,
              RANK() OVER (ORDER BY cp.lifetime_points DESC) as rank
            FROM customer_profiles cp
            WHERE cp.status = 'active'
            ORDER BY cp.lifetime_points DESC
            LIMIT ?
          `;
          params = [limit];
          break;

        case 'engagement':
          query = `
            SELECT 
              cp.customer_id,
              cp.first_name,
              cp.last_name,
              cp.current_tier,
              cp.engagement_score as score,
              cp.lifetime_points,
              cp.total_purchases,
              RANK() OVER (ORDER BY cp.engagement_score DESC) as rank
            FROM customer_profiles cp
            WHERE cp.status = 'active' AND cp.engagement_score > 0
            ORDER BY cp.engagement_score DESC
            LIMIT ?
          `;
          params = [limit];
          break;

        case 'achievements':
          query = `
            SELECT 
              cp.customer_id,
              cp.first_name,
              cp.last_name,
              cp.current_tier,
              achievement_stats.completed_achievements as score,
              cp.engagement_score,
              cp.lifetime_points,
              RANK() OVER (ORDER BY achievement_stats.completed_achievements DESC) as rank
            FROM customer_profiles cp
            JOIN (
              SELECT 
                customer_id,
                COUNT(CASE WHEN completed = true THEN 1 END) as completed_achievements
              FROM customer_achievements
              GROUP BY customer_id
            ) achievement_stats ON cp.customer_id = achievement_stats.customer_id
            WHERE cp.status = 'active'
            ORDER BY achievement_stats.completed_achievements DESC
            LIMIT ?
          `;
          params = [limit];
          break;

        case 'streaks':
          query = `
            SELECT 
              cp.customer_id,
              cp.first_name,
              cp.last_name,
              cp.current_tier,
              cp.streak_days as score,
              cp.engagement_score,
              cp.lifetime_points,
              RANK() OVER (ORDER BY cp.streak_days DESC) as rank
            FROM customer_profiles cp
            WHERE cp.status = 'active' AND cp.streak_days > 0
            ORDER BY cp.streak_days DESC
            LIMIT ?
          `;
          params = [limit];
          break;
      }

      const [leaderboard] = await this.db.execute(query, params);

      return leaderboard.map(entry => ({
        ...entry,
        rank: parseInt(entry.rank),
        score: parseInt(entry.score || 0)
      }));

    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get customer's leaderboard position
   */
  async getCustomerLeaderboardPosition(customerId, type = 'points') {
    try {
      let query = '';
      let params = [];

      switch (type) {
        case 'points':
          query = `
            SELECT 
              customer_id,
              lifetime_points as score,
              RANK() OVER (ORDER BY lifetime_points DESC) as position
            FROM customer_profiles
            WHERE status = 'active'
          `;
          break;

        case 'engagement':
          query = `
            SELECT 
              customer_id,
              engagement_score as score,
              RANK() OVER (ORDER BY engagement_score DESC) as position
            FROM customer_profiles
            WHERE status = 'active' AND engagement_score > 0
          `;
          break;
      }

      const [results] = await this.db.execute(query, params);
      const customerPosition = results.find(r => r.customer_id === customerId);

      return customerPosition ? {
        position: parseInt(customerPosition.position),
        score: parseInt(customerPosition.score || 0),
        total_participants: results.length
      } : null;

    } catch (error) {
      console.error('Error getting customer leaderboard position:', error);
      return null;
    }
  }

  // Helper methods

  async getAvailableAchievements(eventType) {
    const achievements = {
      [POINT_EVENTS.PURCHASE]: [
        {
          achievement_id: 'first_purchase',
          achievement_type: ACHIEVEMENT_TYPES.PURCHASE_MILESTONES,
          title: 'First Purchase',
          description: 'Made your first purchase',
          target_value: 1,
          points_awarded: 100,
          badge_icon: '🛍️'
        },
        {
          achievement_id: 'purchase_5',
          achievement_type: ACHIEVEMENT_TYPES.PURCHASE_MILESTONES,
          title: 'Regular Shopper',
          description: 'Made 5 purchases',
          target_value: 5,
          points_awarded: 250,
          badge_icon: '🛒'
        },
        {
          achievement_id: 'purchase_25',
          achievement_type: ACHIEVEMENT_TYPES.PURCHASE_MILESTONES,
          title: 'Loyal Customer',
          description: 'Made 25 purchases',
          target_value: 25,
          points_awarded: 500,
          badge_icon: '⭐'
        },
        {
          achievement_id: 'purchase_100',
          achievement_type: ACHIEVEMENT_TYPES.PURCHASE_MILESTONES,
          title: 'VIP Customer',
          description: 'Made 100 purchases',
          target_value: 100,
          points_awarded: 1000,
          badge_icon: '👑'
        }
      ],
      [POINT_EVENTS.REFERRAL]: [
        {
          achievement_id: 'first_referral',
          achievement_type: ACHIEVEMENT_TYPES.REFERRAL_COUNT,
          title: 'Ambassador',
          description: 'Referred your first friend',
          target_value: 1,
          points_awarded: 200,
          badge_icon: '🤝'
        },
        {
          achievement_id: 'referral_10',
          achievement_type: ACHIEVEMENT_TYPES.REFERRAL_COUNT,
          title: 'Super Ambassador',
          description: 'Referred 10 friends',
          target_value: 10,
          points_awarded: 1000,
          badge_icon: '🌟'
        }
      ]
    };

    return achievements[eventType] || [];
  }

  async checkAchievementEligibility(customerId, achievement, eventData) {
    try {
      // Check if already achieved
      const [existing] = await this.db.execute(`
        SELECT achievement_id FROM customer_achievements 
        WHERE customer_id = ? AND achievement_id = ?
      `, [customerId, achievement.achievement_id]);

      if (existing.length > 0) {
        return false; // Already achieved
      }

      // Get customer stats
      const [customer] = await this.db.execute(`
        SELECT total_purchases, successful_referrals, total_spent
        FROM customer_profiles 
        WHERE customer_id = ?
      `, [customerId]);

      if (customer.length === 0) return false;

      const stats = customer[0];

      // Check specific achievement criteria
      switch (achievement.achievement_type) {
        case ACHIEVEMENT_TYPES.PURCHASE_MILESTONES:
          return stats.total_purchases >= achievement.target_value;
        
        case ACHIEVEMENT_TYPES.REFERRAL_COUNT:
          return stats.successful_referrals >= achievement.target_value;
        
        case ACHIEVEMENT_TYPES.SPENDING_THRESHOLD:
          return stats.total_spent >= achievement.target_value;
        
        default:
          return false;
      }

    } catch (error) {
      console.error('Error checking achievement eligibility:', error);
      return false;
    }
  }

  async awardAchievement(customerId, achievement) {
    try {
      const achievementRecordId = uuidv4();

      // Insert achievement record
      await this.db.execute(`
        INSERT INTO customer_achievements (
          customer_id, achievement_id, achievement_type, title, description,
          badge_icon, points_awarded, target_value, current_value, completed,
          unlocked_date, completed_date, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
      `, [
        customerId,
        achievement.achievement_id,
        achievement.achievement_type,
        achievement.title,
        achievement.description,
        achievement.badge_icon,
        achievement.points_awarded,
        achievement.target_value,
        achievement.target_value,
        true,
        JSON.stringify({ awarded_at: new Date().toISOString() })
      ]);

      // Award points
      if (achievement.points_awarded > 0) {
        await this.awardAchievementPoints(customerId, achievement);
      }

      // Update customer's achievement badges
      await this.updateCustomerBadges(customerId, achievement);

      // Send achievement notification
      await this.sendAchievementNotification(customerId, achievement);

      return {
        achievement_id: achievement.achievement_id,
        title: achievement.title,
        points_awarded: achievement.points_awarded,
        badge_icon: achievement.badge_icon
      };

    } catch (error) {
      console.error('Error awarding achievement:', error);
      return null;
    }
  }

  async awardAchievementPoints(customerId, achievement) {
    const transactionId = uuidv4();
    
    const [customer] = await this.db.execute(
      `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    const newBalance = customer[0].available_points + achievement.points_awarded;

    await this.db.execute(`
      INSERT INTO points_transactions (
        transaction_id, customer_id, transaction_type, points_amount, 
        balance_after, event_type, description, metadata
      ) VALUES (?, ?, 'earn', ?, ?, 'achievement', ?, ?)
    `, [
      transactionId,
      customerId,
      achievement.points_awarded,
      newBalance,
      `Achievement unlocked: ${achievement.title}`,
      JSON.stringify({
        achievement_id: achievement.achievement_id,
        achievement_type: achievement.achievement_type
      })
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
    `, [
      achievement.points_awarded,
      achievement.points_awarded,
      achievement.points_awarded,
      achievement.points_awarded,
      customerId
    ]);
  }

  async updateCustomerBadges(customerId, achievement) {
    const [customer] = await this.db.execute(`
      SELECT achievement_badges FROM customer_profiles WHERE customer_id = ?
    `, [customerId]);

    const currentBadges = JSON.parse(customer[0].achievement_badges || '[]');
    currentBadges.push({
      achievement_id: achievement.achievement_id,
      badge_icon: achievement.badge_icon,
      title: achievement.title,
      earned_at: new Date().toISOString()
    });

    await this.db.execute(`
      UPDATE customer_profiles 
      SET achievement_badges = ?
      WHERE customer_id = ?
    `, [JSON.stringify(currentBadges), customerId]);
  }

  isStreakMilestone(days) {
    const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
    return milestones.includes(days);
  }

  async awardStreakBonus(customerId, streakDays) {
    const bonusPoints = Math.min(streakDays * 5, 100); // Max 100 points
    const transactionId = uuidv4();
    
    const [customer] = await this.db.execute(
      `SELECT available_points FROM customer_profiles WHERE customer_id = ?`,
      [customerId]
    );

    const newBalance = customer[0].available_points + bonusPoints;

    await this.db.execute(`
      INSERT INTO points_transactions (
        transaction_id, customer_id, transaction_type, points_amount, 
        balance_after, event_type, description, metadata
      ) VALUES (?, ?, 'earn', ?, ?, 'streak_bonus', ?, ?)
    `, [
      transactionId,
      customerId,
      bonusPoints,
      newBalance,
      `Streak milestone bonus: ${streakDays} days`,
      JSON.stringify({ streak_days: streakDays })
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
    `, [bonusPoints, bonusPoints, bonusPoints, bonusPoints, customerId]);
  }

  async sendAchievementNotification(customerId, achievement) {
    // This would integrate with the notification service
    // For now, just log the achievement
    console.log(`Achievement unlocked for ${customerId}: ${achievement.title}`);
  }
}

export default GamificationService;