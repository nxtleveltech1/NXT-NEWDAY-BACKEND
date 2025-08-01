/**
 * Referral Controller
 * Handles HTTP requests for referral program management
 */

import ReferralService from '../services/referral.service.js';
import { connectDB } from '../../../config/database.js';

class ReferralController {
  constructor() {
    this.referralService = new ReferralService(connectDB());
  }

  /**
   * Create a referral invitation
   * POST /api/customer-loyalty/referrals/invite
   */
  async createReferral(req, res) {
    try {
      const { referrer_customer_id, referee_email, metadata = {} } = req.body;
      
      if (!referrer_customer_id || !referee_email) {
        return res.status(400).json({
          success: false,
          message: 'Referrer customer ID and referee email are required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(referee_email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      const result = await this.referralService.createReferral(
        referrer_customer_id, 
        referee_email, 
        metadata
      );
      
      res.status(201).json(result);
    } catch (error) {
      console.error('Error creating referral:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create referral'
      });
    }
  }

  /**
   * Process referral signup
   * POST /api/customer-loyalty/referrals/signup
   */
  async processSignup(req, res) {
    try {
      const { referee_customer_id, referral_code } = req.body;
      
      if (!referee_customer_id || !referral_code) {
        return res.status(400).json({
          success: false,
          message: 'Referee customer ID and referral code are required'
        });
      }

      const result = await this.referralService.processReferralSignup(
        referee_customer_id, 
        referral_code
      );
      
      res.json(result);
    } catch (error) {
      console.error('Error processing referral signup:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to process referral signup'
      });
    }
  }

  /**
   * Complete referral on first purchase
   * POST /api/customer-loyalty/referrals/complete
   */
  async completeReferral(req, res) {
    try {
      const { referee_customer_id, purchase_amount } = req.body;
      
      if (!referee_customer_id || !purchase_amount) {
        return res.status(400).json({
          success: false,
          message: 'Referee customer ID and purchase amount are required'
        });
      }

      const result = await this.referralService.completeReferral(
        referee_customer_id, 
        parseFloat(purchase_amount)
      );
      
      res.json(result);
    } catch (error) {
      console.error('Error completing referral:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to complete referral'
      });
    }
  }

  /**
   * Get referral statistics for customer
   * GET /api/customer-loyalty/referrals/:customerId/stats
   */
  async getReferralStats(req, res) {
    try {
      const { customerId } = req.params;
      
      const stats = await this.referralService.getReferralStats(customerId);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting referral stats:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get referral stats'
      });
    }
  }

  /**
   * Get referral leaderboard
   * GET /api/customer-loyalty/referrals/leaderboard
   */
  async getLeaderboard(req, res) {
    try {
      const { 
        limit = 50, 
        timeframe = 'all_time' 
      } = req.query;
      
      const leaderboard = await this.referralService.getReferralLeaderboard(
        parseInt(limit), 
        timeframe
      );
      
      res.json({
        success: true,
        data: leaderboard,
        timeframe: timeframe
      });
    } catch (error) {
      console.error('Error getting referral leaderboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get referral leaderboard'
      });
    }
  }

  /**
   * Generate referral link for sharing
   * GET /api/customer-loyalty/referrals/:customerId/link
   */
  async generateLink(req, res) {
    try {
      const { customerId } = req.params;
      const { source = 'app' } = req.query;
      
      const linkData = await this.referralService.generateReferralLink(customerId, source);
      
      res.json({
        success: true,
        data: linkData
      });
    } catch (error) {
      console.error('Error generating referral link:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to generate referral link'
      });
    }
  }

  /**
   * Validate referral code
   * GET /api/customer-loyalty/referrals/validate/:referralCode
   */
  async validateCode(req, res) {
    try {
      const { referralCode } = req.params;
      
      const validation = await this.referralService.validateReferralCode(referralCode);
      
      res.json({
        success: true,
        data: validation
      });
    } catch (error) {
      console.error('Error validating referral code:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to validate referral code'
      });
    }
  }

  /**
   * Get referral analytics (admin)
   * GET /api/customer-loyalty/referrals/admin/analytics
   */
  async getAnalytics(req, res) {
    try {
      const { timeframe = 'all_time' } = req.query;
      
      const analytics = await this.referralService.getReferralAnalytics(timeframe);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      console.error('Error getting referral analytics:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get referral analytics'
      });
    }
  }

  /**
   * Get customer's sent referrals
   * GET /api/customer-loyalty/referrals/:customerId/sent
   */
  async getSentReferrals(req, res) {
    try {
      const { customerId } = req.params;
      const { 
        status, 
        limit = 20, 
        offset = 0 
      } = req.query;
      
      const stats = await this.referralService.getReferralStats(customerId);
      const referrals = stats.recent_referrals.slice(
        parseInt(offset), 
        parseInt(offset) + parseInt(limit)
      );
      
      // Filter by status if provided
      const filteredReferrals = status ? 
        referrals.filter(r => r.status === status) : 
        referrals;
      
      res.json({
        success: true,
        data: filteredReferrals,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: stats.recent_referrals.length,
          has_more: parseInt(offset) + parseInt(limit) < stats.recent_referrals.length
        }
      });
    } catch (error) {
      console.error('Error getting sent referrals:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get sent referrals'
      });
    }
  }

  /**
   * Get referral program info
   * GET /api/customer-loyalty/referrals/program-info
   */
  async getProgramInfo(req, res) {
    try {
      const programInfo = {
        benefits: this.referralService.getReferralBenefits(),
        terms: {
          expiration_days: 30,
          minimum_purchase: 0,
          maximum_referrals_per_month: 50,
          referrer_requirements: [
            'Must be an active customer',
            'Account must be in good standing',
            'Cannot refer yourself'
          ],
          referee_requirements: [
            'Must be a new customer',
            'Cannot already have an account',
            'Must complete first purchase within 30 days'
          ]
        },
        how_it_works: [
          'Share your unique referral link with friends',
          'Friend signs up using your link',
          'Friend makes their first purchase',
          'Both you and your friend receive rewards'
        ],
        faqs: [
          {
            question: 'How long does my referral link last?',
            answer: 'Referral links never expire, but individual referral invitations expire after 30 days.'
          },
          {
            question: 'When do I receive my referral rewards?',
            answer: 'You receive rewards immediately after your friend completes their first purchase.'
          },
          {
            question: 'Is there a limit to how many people I can refer?',
            answer: 'You can refer up to 50 people per month. Contact support if you need a higher limit.'
          },
          {
            question: 'Can I refer family members?',
            answer: 'Yes, you can refer family members as long as they don\'t already have an account.'
          }
        ]
      };
      
      res.json({
        success: true,
        data: programInfo
      });
    } catch (error) {
      console.error('Error getting program info:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get program info'
      });
    }
  }
}

export default ReferralController;