const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { validateRequest, schemas } = require('../middleware/validation');
const LoyaltyProfile = require('../models/LoyaltyProfile');

// Get all available rewards
router.get('/', optionalAuth, async (req, res) => {
  try {
    const category = req.query.category;
    const minTier = req.user ? req.user.tier || 'BRONZE' : 'BRONZE';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT * FROM rewards 
      WHERE is_active = true
    `;
    const params = [];

    // Filter by category if provided
    if (category) {
      query += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    // Filter by user's tier eligibility
    const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const userTierIndex = tierOrder.indexOf(minTier);
    const eligibleTiers = tierOrder.slice(0, userTierIndex + 1);
    
    query += ` AND min_tier = ANY($${params.length + 1})`;
    params.push(eligibleTiers);

    query += ` ORDER BY points_required ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        rewards: result.rows,
        pagination: {
          page,
          limit,
          has_more: result.rows.length === limit
        },
        user_tier: minTier
      }
    });
  } catch (error) {
    console.error('Get rewards error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rewards',
      error: error.message
    });
  }
});

// Get reward categories
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category, COUNT(*) as count
      FROM rewards 
      WHERE is_active = true
      GROUP BY category
      ORDER BY category
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reward categories',
      error: error.message
    });
  }
});

// Get single reward details
router.get('/:rewardId', optionalAuth, async (req, res) => {
  try {
    const { rewardId } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM rewards WHERE id = $1 AND is_active = true
    `, [rewardId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }

    const reward = result.rows[0];
    
    // Check if user is eligible
    let isEligible = true;
    let eligibilityReason = null;
    
    if (req.user) {
      const userTier = req.user.tier || 'BRONZE';
      const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
      const userTierIndex = tierOrder.indexOf(userTier);
      const requiredTierIndex = tierOrder.indexOf(reward.min_tier);
      
      if (userTierIndex < requiredTierIndex) {
        isEligible = false;
        eligibilityReason = `Requires ${reward.min_tier} tier or higher`;
      } else if (req.user.current_points < reward.points_required) {
        isEligible = false;
        eligibilityReason = `Need ${reward.points_required - req.user.current_points} more points`;
      }
    }

    res.json({
      success: true,
      data: {
        ...reward,
        is_eligible: isEligible,
        eligibility_reason: eligibilityReason
      }
    });
  } catch (error) {
    console.error('Get reward details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reward details',
      error: error.message
    });
  }
});

// Redeem a reward
router.post('/:rewardId/redeem', authenticateToken, async (req, res) => {
  try {
    const { rewardId } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get reward details
      const rewardResult = await client.query(`
        SELECT * FROM rewards WHERE id = $1 AND is_active = true
      `, [rewardId]);
      
      if (rewardResult.rows.length === 0) {
        throw new Error('Reward not found or inactive');
      }
      
      const reward = rewardResult.rows[0];
      
      // Check stock
      if (reward.stock_quantity !== null && reward.stock_quantity <= 0) {
        throw new Error('Reward is out of stock');
      }
      
      // Check user eligibility
      const userTier = req.user.tier || 'BRONZE';
      const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
      const userTierIndex = tierOrder.indexOf(userTier);
      const requiredTierIndex = tierOrder.indexOf(reward.min_tier);
      
      if (userTierIndex < requiredTierIndex) {
        throw new Error(`Requires ${reward.min_tier} tier or higher`);
      }
      
      // Check points
      if (req.user.current_points < reward.points_required) {
        throw new Error('Insufficient points for this reward');
      }
      
      // Generate redemption code
      const redemptionCode = 'RED-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Create redemption record
      const redemptionResult = await client.query(`
        INSERT INTO reward_redemptions (user_id, reward_id, points_used, redemption_code, status)
        VALUES ($1, $2, $3, $4, 'PENDING')
        RETURNING *
      `, [req.user.id, rewardId, reward.points_required, redemptionCode]);
      
      // Deduct points
      await LoyaltyProfile.updatePoints(
        req.user.id,
        reward.points_required,
        'REDEEM',
        'REWARD_REDEMPTION',
        `Redeemed: ${reward.name}`,
        redemptionResult.rows[0].id
      );
      
      // Update stock if applicable
      if (reward.stock_quantity !== null) {
        await client.query(`
          UPDATE rewards SET stock_quantity = stock_quantity - 1 WHERE id = $1
        `, [rewardId]);
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Reward redeemed successfully',
        data: {
          redemption: redemptionResult.rows[0],
          reward: {
            name: reward.name,
            description: reward.description,
            points_used: reward.points_required
          }
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reward redemption error:', error);
    
    const errorMessages = {
      'Reward not found or inactive': 404,
      'Reward is out of stock': 400,
      'Insufficient points for this reward': 400
    };
    
    const statusCode = errorMessages[error.message] || 500;
    
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to redeem reward'
    });
  }
});

// Get user's redemption history
router.get('/redemptions/history', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT rr.*, r.name as reward_name, r.description as reward_description,
             r.category as reward_category
      FROM reward_redemptions rr
      JOIN rewards r ON rr.reward_id = r.id
      WHERE rr.user_id = $1
      ORDER BY rr.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    res.json({
      success: true,
      data: {
        redemptions: result.rows,
        pagination: {
          page,
          limit,
          has_more: result.rows.length === limit
        }
      }
    });
  } catch (error) {
    console.error('Redemption history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch redemption history',
      error: error.message
    });
  }
});

// Create new reward (admin endpoint)
router.post('/', validateRequest(schemas.createReward), async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO rewards (name, description, points_required, category, image_url, terms_conditions, stock_quantity, min_tier)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.body.name,
      req.body.description,
      req.body.points_required,
      req.body.category,
      req.body.image_url,
      req.body.terms_conditions,
      req.body.stock_quantity,
      req.body.min_tier
    ]);

    res.status(201).json({
      success: true,
      message: 'Reward created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create reward error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create reward',
      error: error.message
    });
  }
});

// Update reward (admin endpoint)
router.put('/:rewardId', validateRequest(schemas.updateReward), async (req, res) => {
  try {
    const { rewardId } = req.params;
    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    // Dynamically build update query
    Object.keys(req.body).forEach(key => {
      updateFields.push(`${key} = $${paramCounter}`);
      updateValues.push(req.body[key]);
      paramCounter++;
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const query = `
      UPDATE rewards 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *
    `;
    updateValues.push(rewardId);

    const result = await pool.query(query, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }

    res.json({
      success: true,
      message: 'Reward updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update reward error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reward',
      error: error.message
    });
  }
});

module.exports = router;