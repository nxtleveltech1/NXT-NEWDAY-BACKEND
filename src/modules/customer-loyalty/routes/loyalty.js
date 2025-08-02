const express = require('express');
const router = express.Router();
const LoyaltyProfile = require('../models/LoyaltyProfile');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest, schemas } = require('../middleware/validation');

// Get loyalty profile and points summary
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profile = await LoyaltyProfile.getByUserId(req.user.id);
    const summary = await LoyaltyProfile.getPointsSummary(req.user.id);
    const benefits = await LoyaltyProfile.getTierBenefits(profile.tier);

    res.json({
      success: true,
      data: {
        profile,
        summary,
        benefits,
        tier_thresholds: {
          BRONZE: parseInt(process.env.TIER_UPGRADE_THRESHOLD_BRONZE) || 1000,
          SILVER: parseInt(process.env.TIER_UPGRADE_THRESHOLD_SILVER) || 5000,
          GOLD: parseInt(process.env.TIER_UPGRADE_THRESHOLD_GOLD) || 15000,
          PLATINUM: parseInt(process.env.TIER_UPGRADE_THRESHOLD_PLATINUM) || 50000
        }
      }
    });
  } catch (error) {
    console.error('Loyalty profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loyalty profile',
      error: error.message
    });
  }
});

// Get points transaction history
router.get('/points/history', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const transactions = await LoyaltyProfile.getPointsHistory(req.user.id, limit, offset);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          has_more: transactions.length === limit
        }
      }
    });
  } catch (error) {
    console.error('Points history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch points history',
      error: error.message
    });
  }
});

// Award points (admin/system endpoint)
router.post('/points/award', validateRequest(schemas.awardPoints), async (req, res) => {
  try {
    const { user_id, points, source, description, reference_id } = req.body;

    const result = await LoyaltyProfile.updatePoints(
      user_id,
      points,
      'EARN',
      source,
      description,
      reference_id
    );

    res.json({
      success: true,
      message: 'Points awarded successfully',
      data: result
    });
  } catch (error) {
    console.error('Award points error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to award points',
      error: error.message
    });
  }
});

// Redeem points
router.post('/points/redeem', authenticateToken, validateRequest(schemas.redeemPoints), async (req, res) => {
  try {
    const { points, reward_id, description } = req.body;

    const result = await LoyaltyProfile.updatePoints(
      req.user.id,
      points,
      'REDEEM',
      'MANUAL_REDEMPTION',
      description || 'Manual points redemption',
      reward_id
    );

    res.json({
      success: true,
      message: 'Points redeemed successfully',
      data: result
    });
  } catch (error) {
    console.error('Redeem points error:', error);
    
    if (error.message === 'Insufficient points for redemption') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to redeem points',
      error: error.message
    });
  }
});

// Simulate purchase to earn points
router.post('/purchase/simulate', authenticateToken, async (req, res) => {
  try {
    const { amount, order_id } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid purchase amount is required'
      });
    }

    const pointsPerDollar = parseInt(process.env.DEFAULT_POINTS_PER_DOLLAR) || 10;
    const pointsToEarn = Math.floor(amount * pointsPerDollar);

    // Get user's tier for potential multiplier
    const profile = await LoyaltyProfile.getByUserId(req.user.id);
    const benefits = await LoyaltyProfile.getTierBenefits(profile.tier);
    
    // Find points multiplier benefit
    const multiplierBenefit = benefits.find(b => b.benefit_type === 'POINTS_MULTIPLIER');
    const multiplier = multiplierBenefit ? multiplierBenefit.benefit_value.multiplier : 1.0;
    
    const finalPoints = Math.floor(pointsToEarn * multiplier);

    const result = await LoyaltyProfile.updatePoints(
      req.user.id,
      finalPoints,
      'EARN',
      'PURCHASE',
      `Purchase reward - $${amount} (${pointsPerDollar} pts/$1, ${multiplier}x tier bonus)`,
      order_id || null
    );

    res.json({
      success: true,
      message: 'Purchase processed and points awarded',
      data: {
        ...result,
        purchase_amount: amount,
        base_points: pointsToEarn,
        tier_multiplier: multiplier,
        final_points: finalPoints
      }
    });
  } catch (error) {
    console.error('Purchase simulation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process purchase',
      error: error.message
    });
  }
});

// Get tier benefits
router.get('/tiers/:tier/benefits', async (req, res) => {
  try {
    const { tier } = req.params;
    
    if (!['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].includes(tier)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tier specified'
      });
    }

    const benefits = await LoyaltyProfile.getTierBenefits(tier);

    res.json({
      success: true,
      data: {
        tier,
        benefits
      }
    });
  } catch (error) {
    console.error('Tier benefits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tier benefits',
      error: error.message
    });
  }
});

// Get all tier information
router.get('/tiers', async (req, res) => {
  try {
    const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const tierData = {};

    for (const tier of tiers) {
      const benefits = await LoyaltyProfile.getTierBenefits(tier);
      tierData[tier] = {
        name: tier,
        benefits,
        threshold: parseInt(process.env[`TIER_UPGRADE_THRESHOLD_${tier}`]) || 0
      };
    }

    res.json({
      success: true,
      data: tierData
    });
  } catch (error) {
    console.error('Tiers information error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tier information',
      error: error.message
    });
  }
});

// Admin endpoint to adjust points
router.post('/points/adjust', async (req, res) => {
  try {
    const { user_id, points, reason, admin_id } = req.body;

    if (!user_id || !points || !reason) {
      return res.status(400).json({
        success: false,
        message: 'user_id, points, and reason are required'
      });
    }

    const result = await LoyaltyProfile.updatePoints(
      user_id,
      points,
      'ADJUSTMENT',
      'ADMIN_ADJUSTMENT',
      `Admin adjustment: ${reason}`,
      admin_id
    );

    res.json({
      success: true,
      message: 'Points adjusted successfully',
      data: result
    });
  } catch (error) {
    console.error('Points adjustment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to adjust points',
      error: error.message
    });
  }
});

module.exports = router;