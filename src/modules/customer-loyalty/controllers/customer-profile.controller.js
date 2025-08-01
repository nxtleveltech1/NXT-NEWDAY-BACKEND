/**
 * Customer Profile Controller
 * Handles HTTP requests for customer profile management
 */

import CustomerProfileService from '../services/customer-profile.service.js';
import { connectDB } from '../../../config/database.js';

class CustomerProfileController {
  constructor() {
    this.customerProfileService = new CustomerProfileService(connectDB());
  }

  /**
   * Create new customer profile
   * POST /api/customer-loyalty/profiles
   */
  async createProfile(req, res) {
    try {
      const customerData = req.body;
      
      // Validate required fields
      if (!customerData.email || !customerData.first_name || !customerData.last_name) {
        return res.status(400).json({
          success: false,
          message: 'Email, first name, and last name are required'
        });
      }

      const result = await this.customerProfileService.createCustomerProfile(customerData);
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error creating customer profile:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create customer profile'
      });
    }
  }

  /**
   * Get customer profile with loyalty summary
   * GET /api/customer-loyalty/profiles/:customerId
   */
  async getProfile(req, res) {
    try {
      const { customerId } = req.params;
      
      const profile = await this.customerProfileService.getCustomerProfile(customerId);
      
      res.json({
        success: true,
        data: profile
      });
    } catch (error) {
      console.error('Error getting customer profile:', error);
      res.status(404).json({
        success: false,
        message: error.message || 'Customer not found'
      });
    }
  }

  /**
   * Update customer profile
   * PUT /api/customer-loyalty/profiles/:customerId
   */
  async updateProfile(req, res) {
    try {
      const { customerId } = req.params;
      const updateData = req.body;
      
      const updatedProfile = await this.customerProfileService.updateCustomerProfile(
        customerId, 
        updateData
      );
      
      res.json({
        success: true,
        data: updatedProfile
      });
    } catch (error) {
      console.error('Error updating customer profile:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update customer profile'
      });
    }
  }

  /**
   * Update customer tier manually (admin only)
   * PUT /api/customer-loyalty/profiles/:customerId/tier
   */
  async updateTier(req, res) {
    try {
      const { customerId } = req.params;
      
      const result = await this.customerProfileService.updateCustomerTier(customerId);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error updating customer tier:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update customer tier'
      });
    }
  }

  /**
   * Calculate customer engagement score
   * GET /api/customer-loyalty/profiles/:customerId/engagement
   */
  async getEngagementScore(req, res) {
    try {
      const { customerId } = req.params;
      
      const score = await this.customerProfileService.calculateEngagementScore(customerId);
      
      res.json({
        success: true,
        data: {
          customer_id: customerId,
          engagement_score: score,
          updated_at: new Date()
        }
      });
    } catch (error) {
      console.error('Error calculating engagement score:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to calculate engagement score'
      });
    }
  }

  /**
   * Get customer analytics
   * GET /api/customer-loyalty/profiles/:customerId/analytics
   */
  async getAnalytics(req, res) {
    try {
      const { customerId } = req.params;
      
      const analytics = await this.customerProfileService.getCustomerAnalytics(customerId);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      console.error('Error getting customer analytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get customer analytics'
      });
    }
  }

  /**
   * Get customer loyalty summary
   * GET /api/customer-loyalty/profiles/:customerId/summary
   */
  async getLoyaltySummary(req, res) {
    try {
      const { customerId } = req.params;
      
      const profile = await this.customerProfileService.getCustomerProfile(customerId);
      
      const summary = {
        customer_id: customerId,
        current_tier: profile.current_tier,
        available_points: profile.available_points,
        lifetime_points: profile.lifetime_points,
        tier_progress: {
          current_tier_points: profile.tier_points,
          next_tier: profile.next_tier,
          points_to_next_tier: profile.points_to_next_tier,
          progress_percentage: profile.tier_progress_percentage
        },
        engagement: {
          score: profile.engagement_score,
          last_activity: profile.last_activity_date,
          days_since_last_activity: profile.days_since_last_activity
        },
        recent_achievements: profile.recent_achievements,
        active_rewards: profile.active_rewards,
        tier_benefits: profile.tier_benefits
      };
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error getting loyalty summary:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get loyalty summary'
      });
    }
  }
}

export default CustomerProfileController;