const express = require('express');
const router = express.Router();
const Referral = require('../models/Referral');
const { authenticateToken } = require('../middleware/auth');

// Get user's referral information
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profile = await LoyaltyProfile.getByUserId(req.user.id);
    const stats = await Referral.getReferralStats(req.user.id);
    const referrals = await Referral.getReferralsByUser(req.user.id);

    res.json({
      success: true,
      data: {
        referral_code: profile.referral_code,
        stats,
        referrals
      }
    });
  } catch (error) {
    console.error('Referral profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral information',
      error: error.message
    });
  }
});

// Get referral history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const status = req.query.status || null;
    const referrals = await Referral.getReferralsByUser(req.user.id, status);

    res.json({
      success: true,
      data: referrals
    });
  } catch (error) {
    console.error('Referral history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral history',
      error: error.message
    });
  }
});

// Get referral statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await Referral.getReferralStats(req.user.id);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Referral stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral statistics',
      error: error.message
    });
  }
});

// Process qualifying activity (internal endpoint)
router.post('/process-activity', async (req, res) => {
  try {
    const { user_id, activity_type, activity_value } = req.body;

    if (!user_id || !activity_type) {
      return res.status(400).json({
        success: false,
        message: 'user_id and activity_type are required'
      });
    }

    const completedReferrals = await Referral.processQualifyingActivity(
      user_id,
      activity_type,
      activity_value
    );

    res.json({
      success: true,
      message: 'Activity processed successfully',
      data: {
        completed_referrals: completedReferrals || [],
        referrals_completed: completedReferrals ? completedReferrals.length : 0
      }
    });
  } catch (error) {
    console.error('Process activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process qualifying activity',
      error: error.message
    });
  }
});

// Get referral leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await Referral.getLeaderboard(limit);

    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    console.error('Referral leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral leaderboard',
      error: error.message
    });
  }
});

// Manually complete referral (admin endpoint)
router.post('/:referralId/complete', async (req, res) => {
  try {
    const { referralId } = req.params;
    const { points_awarded } = req.body;

    const pointsToAward = points_awarded || parseInt(process.env.REFERRAL_BONUS_POINTS) || 500;
    
    const completedReferral = await Referral.completeReferral(referralId, pointsToAward);

    res.json({
      success: true,
      message: 'Referral completed successfully',
      data: completedReferral
    });
  } catch (error) {
    console.error('Complete referral error:', error);
    
    if (error.message === 'Referral not found or already completed') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to complete referral',
      error: error.message
    });
  }
});

// Generate shareable referral link
router.get('/share-link', authenticateToken, async (req, res) => {
  try {
    const LoyaltyProfile = require('../models/LoyaltyProfile');
    const profile = await LoyaltyProfile.getByUserId(req.user.id);
    
    const baseUrl = req.get('origin') || 'https://yourdomain.com';
    const shareLink = `${baseUrl}/register?ref=${profile.referral_code}`;
    
    const shareText = `Join me on our loyalty program and we both get rewarded! Use my referral code: ${profile.referral_code}`;

    res.json({
      success: true,
      data: {
        referral_code: profile.referral_code,
        share_link: shareLink,
        share_text: shareText,
        social_links: {
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink)}`,
          twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareLink)}`,
          whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareLink)}`,
          email: `mailto:?subject=Join our loyalty program&body=${encodeURIComponent(shareText + '\n\n' + shareLink)}`
        }
      }
    });
  } catch (error) {
    console.error('Share link error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate share link',
      error: error.message
    });
  }
});

module.exports = router;