/**
 * Points Controller
 * Handles HTTP requests for points management
 */

import PointsService from '../services/points.service.js';
import { connectDB } from '../../../config/database.js';

class PointsController {
  constructor() {
    this.pointsService = new PointsService(connectDB());
  }

  /**
   * Award points to customer
   * POST /api/customer-loyalty/points/award
   */
  async awardPoints(req, res) {
    try {
      const { customer_id, event_type, amount, metadata = {} } = req.body;
      
      if (!customer_id || !event_type) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and event type are required'
        });
      }

      const result = await this.pointsService.awardPoints(
        customer_id, 
        event_type, 
        amount, 
        metadata
      );
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error awarding points:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to award points'
      });
    }
  }

  /**
   * Redeem points
   * POST /api/customer-loyalty/points/redeem
   */
  async redeemPoints(req, res) {
    try {
      const { customer_id, points_amount, reward_id, metadata = {} } = req.body;
      
      if (!customer_id || !points_amount) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and points amount are required'
        });
      }

      const result = await this.pointsService.redeemPoints(
        customer_id, 
        points_amount, 
        reward_id, 
        metadata
      );
      
      res.json(result);
    } catch (error) {
      console.error('Error redeeming points:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to redeem points'
      });
    }
  }

  /**
   * Process purchase and award points
   * POST /api/customer-loyalty/points/purchase
   */
  async processPurchase(req, res) {
    try {
      const { customer_id, purchase_data } = req.body;
      
      if (!customer_id || !purchase_data) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and purchase data are required'
        });
      }

      const result = await this.pointsService.processPurchase(customer_id, purchase_data);
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error processing purchase:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to process purchase'
      });
    }
  }

  /**
   * Calculate points for potential purchase
   * POST /api/customer-loyalty/points/calculate
   */
  async calculatePoints(req, res) {
    try {
      const { 
        customer_id, 
        purchase_amount, 
        categories = [], 
        campaign_id = null 
      } = req.body;
      
      if (!customer_id || !purchase_amount) {
        return res.status(400).json({
          success: false,
          message: 'Customer ID and purchase amount are required'
        });
      }

      const calculation = await this.pointsService.calculatePurchasePoints(
        customer_id, 
        purchase_amount, 
        categories, 
        campaign_id
      );
      
      res.json({
        success: true,
        data: calculation
      });
    } catch (error) {
      console.error('Error calculating points:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to calculate points'
      });
    }
  }

  /**
   * Get points balance
   * GET /api/customer-loyalty/points/:customerId/balance
   */
  async getBalance(req, res) {
    try {
      const { customerId } = req.params;
      
      const balance = await this.pointsService.getPointsBalance(customerId);
      
      res.json({
        success: true,
        data: balance
      });
    } catch (error) {
      console.error('Error getting points balance:', error);
      res.status(404).json({
        success: false,
        message: error.message || 'Customer not found'
      });
    }
  }

  /**
   * Get points transaction history
   * GET /api/customer-loyalty/points/:customerId/history
   */
  async getHistory(req, res) {
    try {
      const { customerId } = req.params;
      const {
        limit = 50,
        offset = 0,
        transaction_type,
        event_type,
        start_date,
        end_date
      } = req.query;

      const options = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        transaction_type,
        event_type,
        start_date,
        end_date
      };

      const history = await this.pointsService.getPointsHistory(customerId, options);
      
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
      console.error('Error getting points history:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get points history'
      });
    }
  }

  /**
   * Expire old points (admin endpoint)
   * POST /api/customer-loyalty/points/expire
   */
  async expirePoints(req, res) {
    try {
      const result = await this.pointsService.expirePoints();
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error expiring points:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to expire points'
      });
    }
  }

  /**
   * Get points summary with analytics
   * GET /api/customer-loyalty/points/:customerId/summary
   */
  async getPointsSummary(req, res) {
    try {
      const { customerId } = req.params;
      const { days = 30 } = req.query;
      
      const balance = await this.pointsService.getPointsBalance(customerId);
      const recentHistory = await this.pointsService.getPointsHistory(customerId, {
        limit: 10,
        start_date: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      });

      // Calculate trends
      const earnTransactions = recentHistory.filter(t => t.transaction_type === 'earn');
      const redeemTransactions = recentHistory.filter(t => t.transaction_type === 'redeem');
      
      const summary = {
        balance: {
          available: balance.available_points,
          total: balance.total_points,
          lifetime: balance.lifetime_points,
          expiring_soon: balance.points_expiring_soon
        },
        activity: {
          [`points_earned_${days}d`]: balance[`points_earned_${days}d`] || 0,
          [`points_redeemed_${days}d`]: balance[`points_redeemed_${days}d`] || 0,
          recent_earn_transactions: earnTransactions.length,
          recent_redeem_transactions: redeemTransactions.length,
          last_transaction: recentHistory[0] || null
        },
        lifetime_stats: {
          total_earned: balance.lifetime_points_earned,
          total_redeemed: balance.lifetime_points_redeemed,
          net_points: balance.lifetime_points_earned - balance.lifetime_points_redeemed
        }
      };
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error getting points summary:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get points summary'
      });
    }
  }
}

export default PointsController;