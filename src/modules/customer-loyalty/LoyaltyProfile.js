const pool = require('../../config/database');

class LoyaltyProfile {
  static async getByUserId(userId) {
    const result = await pool.query(`
      SELECT * FROM loyalty_profiles WHERE user_id = $1
    `, [userId]);
    
    return result.rows[0];
  }

  static async getByReferralCode(referralCode) {
    const result = await pool.query(`
      SELECT lp.*, u.first_name, u.last_name, u.email
      FROM loyalty_profiles lp
      JOIN users u ON lp.user_id = u.id
      WHERE lp.referral_code = $1
    `, [referralCode]);
    
    return result.rows[0];
  }

  static async updatePoints(userId, pointsChange, transactionType, source, description, referenceId = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get current profile
      const profileResult = await client.query(`
        SELECT * FROM loyalty_profiles WHERE user_id = $1
      `, [userId]);
      
      if (profileResult.rows.length === 0) {
        throw new Error('Loyalty profile not found');
      }
      
      const profile = profileResult.rows[0];
      let newCurrentPoints = profile.current_points;
      let newLifetimePoints = profile.lifetime_points;
      
      if (transactionType === 'EARN') {
        newCurrentPoints += pointsChange;
        newLifetimePoints += pointsChange;
      } else if (transactionType === 'REDEEM') {
        if (profile.current_points < Math.abs(pointsChange)) {
          throw new Error('Insufficient points for redemption');
        }
        newCurrentPoints -= Math.abs(pointsChange);
      } else if (transactionType === 'EXPIRE') {
        newCurrentPoints -= Math.abs(pointsChange);
      } else if (transactionType === 'ADJUSTMENT') {
        newCurrentPoints += pointsChange;
        if (pointsChange > 0) {
          newLifetimePoints += pointsChange;
        }
      }
      
      // Ensure points don't go negative
      newCurrentPoints = Math.max(0, newCurrentPoints);
      
      // Update loyalty profile
      await client.query(`
        UPDATE loyalty_profiles 
        SET current_points = $2, lifetime_points = $3
        WHERE user_id = $1
      `, [userId, newCurrentPoints, newLifetimePoints]);
      
      // Record transaction
      await client.query(`
        INSERT INTO points_transactions (user_id, transaction_type, points, source, description, reference_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [userId, transactionType, pointsChange, source, description, referenceId]);
      
      // Check for tier upgrade
      const newTier = this.calculateTier(newLifetimePoints);
      if (newTier !== profile.tier) {
        await client.query(`
          UPDATE loyalty_profiles 
          SET tier = $2, tier_expires_at = $3
          WHERE user_id = $1
        `, [userId, newTier, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)]); // 1 year from now
      }
      
      await client.query('COMMIT');
      
      return {
        current_points: newCurrentPoints,
        lifetime_points: newLifetimePoints,
        tier: newTier,
        points_change: pointsChange
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static calculateTier(lifetimePoints) {
    const thresholds = {
      PLATINUM: parseInt(process.env.TIER_UPGRADE_THRESHOLD_PLATINUM) || 50000,
      GOLD: parseInt(process.env.TIER_UPGRADE_THRESHOLD_GOLD) || 15000,
      SILVER: parseInt(process.env.TIER_UPGRADE_THRESHOLD_SILVER) || 5000,
      BRONZE: parseInt(process.env.TIER_UPGRADE_THRESHOLD_BRONZE) || 1000
    };

    if (lifetimePoints >= thresholds.PLATINUM) return 'PLATINUM';
    if (lifetimePoints >= thresholds.GOLD) return 'GOLD';
    if (lifetimePoints >= thresholds.SILVER) return 'SILVER';
    if (lifetimePoints >= thresholds.BRONZE) return 'BRONZE';
    return 'BRONZE';
  }

  static async getPointsHistory(userId, limit = 50, offset = 0) {
    const result = await pool.query(`
      SELECT * FROM points_transactions 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);
    
    return result.rows;
  }

  static async getTierBenefits(tier) {
    const result = await pool.query(`
      SELECT * FROM tier_benefits 
      WHERE tier = $1 AND is_active = true
      ORDER BY benefit_type
    `, [tier]);
    
    return result.rows;
  }

  static async getPointsSummary(userId) {
    const result = await pool.query(`
      SELECT 
        lp.current_points,
        lp.lifetime_points,
        lp.tier,
        COALESCE(earning.earned_this_month, 0) as earned_this_month,
        COALESCE(spending.spent_this_month, 0) as spent_this_month,
        COALESCE(expiring.expiring_soon, 0) as expiring_soon
      FROM loyalty_profiles lp
      LEFT JOIN (
        SELECT user_id, SUM(points) as earned_this_month
        FROM points_transactions 
        WHERE transaction_type = 'EARN' 
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY user_id
      ) earning ON lp.user_id = earning.user_id
      LEFT JOIN (
        SELECT user_id, SUM(ABS(points)) as spent_this_month
        FROM points_transactions 
        WHERE transaction_type = 'REDEEM' 
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY user_id
      ) spending ON lp.user_id = spending.user_id
      LEFT JOIN (
        SELECT user_id, SUM(points) as expiring_soon
        FROM points_transactions 
        WHERE transaction_type = 'EARN' 
        AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        GROUP BY user_id
      ) expiring ON lp.user_id = expiring.user_id
      WHERE lp.user_id = $1
    `, [userId]);
    
    return result.rows[0];
  }
}

module.exports = LoyaltyProfile;