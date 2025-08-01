/**
 * Rewards Controller
 * Handles HTTP requests for rewards catalog and redemption management
 */

import RewardsService from '../services/rewards.service.js';
import { connectDB } from '../../../config/database.js';

class RewardsController {
  constructor() {
    this.rewardsService = new RewardsService(connectDB());
  }

  /**
   * Get rewards catalog with filtering
   * GET /api/customer-loyalty/rewards/catalog
   */
  async getCatalog(req, res) {
    try {
      const { customer_id } = req.query;
      const filters = {
        reward_type: req.query.reward_type,
        tier_requirement: req.query.tier_requirement,
        max_points_cost: req.query.max_points_cost ? parseInt(req.query.max_points_cost) : null,
        min_points_cost: req.query.min_points_cost ? parseInt(req.query.min_points_cost) : null,
        featured_only: req.query.featured_only === 'true',
        category: req.query.category,
        limit: req.query.limit ? parseInt(req.query.limit) : 50,
        offset: req.query.offset ? parseInt(req.query.offset) : 0
      };

      const rewards = await this.rewardsService.getRewardsCatalog(customer_id, filters);
      
      res.json({
        success: true,
        data: rewards,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          has_more: rewards.length === filters.limit
        }
      });
    } catch (error) {
      console.error('Error getting rewards catalog:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get rewards catalog'
      });
    }
  }

  /**
   * Get personalized reward recommendations
   * GET /api/customer-loyalty/rewards/:customerId/recommendations
   */
  async getRecommendations(req, res) {
    try {
      const { customerId } = req.params;
      const { limit = 10 } = req.query;
      
      const recommendations = await this.rewardsService.getPersonalizedRewards(
        customerId, 
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: recommendations
      });
    } catch (error) {
      console.error('Error getting reward recommendations:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reward recommendations'
      });
    }
  }

  /**
   * Redeem a reward
   * POST /api/customer-loyalty/rewards/redeem
   */
  async redeemReward(req, res) {
    try {
      const { customer_id, reward_id, metadata = {} } = req.body;
      
      if (!customer_id || !reward_id) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and reward ID are required'
        });
      }

      const result = await this.rewardsService.redeemReward(
        customer_id, 
        reward_id, 
        metadata
      );
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error redeeming reward:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to redeem reward'
      });
    }
  }

  /**
   * Get customer's redemption history
   * GET /api/customer-loyalty/rewards/:customerId/redemptions
   */
  async getRedemptionHistory(req, res) {
    try {
      const { customerId } = req.params;
      const {
        status,
        limit = 20,
        offset = 0
      } = req.query;

      const options = {
        status,
        limit: parseInt(limit),
        offset: parseInt(offset)
      };

      const history = await this.rewardsService.getRedemptionHistory(customerId, options);
      
      res.json({
        success: true,
        data: history,
        pagination: {
          limit: options.limit,
          offset: options.offset,
          has_more: history.length === options.limit
        }
      });
    } catch (error) {
      console.error('Error getting redemption history:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get redemption history'
      });
    }
  }

  /**
   * Use a redemption code
   * POST /api/customer-loyalty/rewards/use
   */
  async useRedemption(req, res) {
    try {
      const { redemption_code, order_id } = req.body;
      
      if (!redemption_code) {
        return res.status(400).json({
          success: false,
          message: 'Redemption code is required'
        });
      }

      const result = await this.rewardsService.useRedemption(redemption_code, order_id);
      
      res.json(result);
    } catch (error) {
      console.error('Error using redemption:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to use redemption'
      });
    }
  }

  /**
   * Create or update reward (admin only)
   * POST /api/customer-loyalty/rewards/admin/create
   */
  async createReward(req, res) {
    try {
      const rewardData = req.body;
      
      if (!rewardData.title || !rewardData.reward_type || !rewardData.points_cost) {
        return res.status(400).json({
          success: false,
          message: 'Title, reward type, and points cost are required'
        });
      }

      const result = await this.rewardsService.createReward(rewardData);
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error creating reward:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create reward'
      });
    }
  }

  /**
   * Get reward analytics (admin only)
   * GET /api/customer-loyalty/rewards/admin/analytics
   */
  async getAnalytics(req, res) {
    try {
      const { reward_id } = req.query;
      
      const analytics = await this.rewardsService.getRewardAnalytics(reward_id);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      console.error('Error getting reward analytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reward analytics'
      });
    }
  }

  /**
   * Get single reward details
   * GET /api/customer-loyalty/rewards/:rewardId
   */
  async getRewardDetails(req, res) {
    try {
      const { rewardId } = req.params;
      const { customer_id } = req.query;
      
      const rewards = await this.rewardsService.getRewardsCatalog(customer_id, {
        limit: 1,
        offset: 0
      });
      
      const reward = rewards.find(r => r.reward_id === rewardId);
      
      if (!reward) {
        return res.status(404).json({
          success: false,
          message: 'Reward not found'
        });
      }
      
      res.json({
        success: true,
        data: reward
      });
    } catch (error) {
      console.error('Error getting reward details:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reward details'
      });
    }
  }

  /**
   * Get featured rewards
   * GET /api/customer-loyalty/rewards/featured
   */
  async getFeaturedRewards(req, res) {
    try {
      const { customer_id, limit = 6 } = req.query;
      
      const rewards = await this.rewardsService.getRewardsCatalog(customer_id, {
        featured_only: true,
        limit: parseInt(limit),
        offset: 0
      });
      
      res.json({
        success: true,
        data: rewards
      });
    } catch (error) {
      console.error('Error getting featured rewards:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get featured rewards'
      });
    }
  }

  /**
   * Validate redemption code
   * GET /api/customer-loyalty/rewards/validate/:redemptionCode
   */
  async validateRedemptionCode(req, res) {
    try {
      const { redemptionCode } = req.params;
      
      // This is a simple validation - in a real system you might want more complex validation
      const rewards = await this.rewardsService.getRedemptionHistory(null, { limit: 1000 });
      const redemption = rewards.find(r => r.redemption_code === redemptionCode);
      
      if (!redemption) {
        return res.json({
          success: false,
          valid: false,
          message: 'Invalid redemption code'
        });
      }
      
      const isValid = !redemption.used && 
                     redemption.status === 'active' && 
                     new Date(redemption.expires_at) > new Date();
      
      res.json({
        success: true,
        valid: isValid,
        data: isValid ? {
          reward_title: redemption.title,
          points_used: redemption.points_used,
          cash_value: redemption.cash_value,
          expires_at: redemption.expires_at
        } : null,
        message: isValid ? 'Valid redemption code' : 'Redemption code is expired or already used'
      });
    } catch (error) {
      console.error('Error validating redemption code:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to validate redemption code'
      });
    }
  }
}

export default RewardsController;