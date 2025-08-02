const pool = require('../../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { email, password, first_name, last_name, phone, date_of_birth } = userData;
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Create user
      const userResult = await client.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, phone, date_of_birth)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [email, password_hash, first_name, last_name, phone, date_of_birth]);
      
      const user = userResult.rows[0];
      
      // Create loyalty profile
      const loyaltyNumber = 'LOY' + Date.now().toString().slice(-8) + Math.random().toString(36).substring(2, 6).toUpperCase();
      const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      await client.query(`
        INSERT INTO loyalty_profiles (user_id, loyalty_number, referral_code)
        VALUES ($1, $2, $3)
      `, [user.id, loyaltyNumber, referralCode]);
      
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findByEmail(email) {
    const result = await pool.query(`
      SELECT u.*, lp.loyalty_number, lp.current_points, lp.lifetime_points, 
             lp.tier, lp.referral_code, lp.status as loyalty_status
      FROM users u
      LEFT JOIN loyalty_profiles lp ON u.id = lp.user_id
      WHERE u.email = $1
    `, [email]);
    
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`
      SELECT u.*, lp.loyalty_number, lp.current_points, lp.lifetime_points, 
             lp.tier, lp.referral_code, lp.status as loyalty_status
      FROM users u
      LEFT JOIN loyalty_profiles lp ON u.id = lp.user_id
      WHERE u.id = $1
    `, [id]);
    
    return result.rows[0];
  }

  static async validatePassword(user, password) {
    return await bcrypt.compare(password, user.password_hash);
  }

  static async updateProfile(userId, updateData) {
    const { first_name, last_name, phone, date_of_birth } = updateData;
    
    const result = await pool.query(`
      UPDATE users 
      SET first_name = COALESCE($2, first_name),
          last_name = COALESCE($3, last_name),
          phone = COALESCE($4, phone),
          date_of_birth = COALESCE($5, date_of_birth)
      WHERE id = $1
      RETURNING *
    `, [userId, first_name, last_name, phone, date_of_birth]);
    
    return result.rows[0];
  }

  static async changePassword(userId, newPassword) {
    const password_hash = await bcrypt.hash(newPassword, 12);
    
    await pool.query(`
      UPDATE users 
      SET password_hash = $2
      WHERE id = $1
    `, [userId, password_hash]);
    
    return true;
  }

  static async getAllUsers(limit = 50, offset = 0) {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at,
             lp.loyalty_number, lp.current_points, lp.lifetime_points, lp.tier,
             lp.status as loyalty_status
      FROM users u
      LEFT JOIN loyalty_profiles lp ON u.id = lp.user_id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    return result.rows;
  }
}

module.exports = User;