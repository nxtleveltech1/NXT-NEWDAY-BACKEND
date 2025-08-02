const pool = require('../../config/database');

class Referral {
  static async createReferral(referrerId, refereeId, referralCode) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if referral already exists
      const existingResult = await client.query(`
        SELECT * FROM referrals WHERE referrer_id = $1 AND referee_id = $2
      `, [referrerId, refereeId]);
      
      if (existingResult.rows.length > 0) {
        throw new Error('Referral already exists');
      }
      
      // Create referral record
      const referralResult = await client.query(`
        INSERT INTO referrals (referrer_id, referee_id, referral_code, status)
        VALUES ($1, $2, $3, 'PENDING')
        RETURNING *
      `, [referrerId, refereeId, referralCode]);
      
      // Update referee's loyalty profile to track who referred them
      await client.query(`
        UPDATE loyalty_profiles 
        SET referred_by = $1
        WHERE user_id = $2
      `, [referrerId, refereeId]);
      
      await client.query('COMMIT');
      return referralResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async completeReferral(referralId, pointsAwarded) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get referral details
      const referralResult = await client.query(`
        SELECT * FROM referrals WHERE id = $1 AND status = 'PENDING'
      `, [referralId]);
      
      if (referralResult.rows.length === 0) {
        throw new Error('Referral not found or already completed');
      }
      
      const referral = referralResult.rows[0];
      
      // Update referral status
      await client.query(`
        UPDATE referrals 
        SET status = 'COMPLETED', 
            points_awarded = $2, 
            completion_date = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [referralId, pointsAwarded]);
      
      // Award points to referrer
      const LoyaltyProfile = require('./LoyaltyProfile');
      await LoyaltyProfile.updatePoints(
        referral.referrer_id,
        pointsAwarded,
        'EARN',
        'REFERRAL',
        `Referral bonus for successful referral`,
        referralId
      );
      
      await client.query('COMMIT');
      return referral;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getReferralsByUser(userId, status = null) {
    let query = `
      SELECT r.*, 
             ru.first_name as referee_first_name, 
             ru.last_name as referee_last_name,
             ru.email as referee_email
      FROM referrals r
      JOIN users ru ON r.referee_id = ru.id
      WHERE r.referrer_id = $1
    `;
    
    const params = [userId];
    
    if (status) {
      query += ` AND r.status = $2`;
      params.push(status);
    }
    
    query += ` ORDER BY r.created_at DESC`;
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  static async getReferralStats(userId) {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_referrals,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as successful_referrals,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_referrals,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN points_awarded ELSE 0 END), 0) as total_points_earned
      FROM referrals 
      WHERE referrer_id = $1
    `, [userId]);
    
    return result.rows[0];
  }

  static async processQualifyingActivity(userId, activityType, activityValue = null) {
    // Define qualifying activities for referrals
    const qualifyingActivities = ['FIRST_PURCHASE', 'ACCOUNT_VERIFICATION', 'PROFILE_COMPLETION'];
    
    if (!qualifyingActivities.includes(activityType)) {
      return null;
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Find pending referrals for this user as referee
      const pendingReferrals = await client.query(`
        SELECT * FROM referrals 
        WHERE referee_id = $1 AND status = 'PENDING'
      `, [userId]);
      
      const referralBonusPoints = parseInt(process.env.REFERRAL_BONUS_POINTS) || 500;
      const completedReferrals = [];
      
      for (const referral of pendingReferrals.rows) {
        // Complete the referral
        await this.completeReferral(referral.id, referralBonusPoints);
        completedReferrals.push(referral);
      }
      
      await client.query('COMMIT');
      return completedReferrals;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async validateReferralCode(referralCode, excludeUserId = null) {
    let query = `
      SELECT lp.*, u.first_name, u.last_name, u.email
      FROM loyalty_profiles lp
      JOIN users u ON lp.user_id = u.id
      WHERE lp.referral_code = $1 AND lp.status = 'ACTIVE'
    `;
    
    const params = [referralCode];
    
    if (excludeUserId) {
      query += ` AND lp.user_id != $2`;
      params.push(excludeUserId);
    }
    
    const result = await pool.query(query, params);
    return result.rows[0];
  }

  static async getLeaderboard(limit = 10) {
    const result = await pool.query(`
      SELECT 
        u.first_name,
        u.last_name,
        u.email,
        COUNT(r.id) as total_referrals,
        COUNT(CASE WHEN r.status = 'COMPLETED' THEN 1 END) as successful_referrals,
        COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN r.points_awarded ELSE 0 END), 0) as total_points_earned
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id
      GROUP BY u.id, u.first_name, u.last_name, u.email
      HAVING COUNT(r.id) > 0
      ORDER BY successful_referrals DESC, total_points_earned DESC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  }
}

module.exports = Referral;