import express from 'express';
const router = express.Router();

// Import customer loyalty routes (dynamic imports for compatibility)
let authRoutes, loyaltyRoutes, referralRoutes, rewardRoutes;

// Initialize and mount customer loyalty routes
async function initializeRoutes() {
  try {
    if (!authRoutes) {
      // Dynamic imports for CommonJS modules
      authRoutes = (await import('../modules/customer-loyalty/routes/auth.js')).default;
      loyaltyRoutes = (await import('../modules/customer-loyalty/routes/loyalty.js')).default;
      referralRoutes = (await import('../modules/customer-loyalty/routes/referrals.js')).default;
      rewardRoutes = (await import('../modules/customer-loyalty/routes/rewards.js')).default;
    }
    
    router.use('/auth', authRoutes);
    router.use('/loyalty', loyaltyRoutes);
    router.use('/referrals', referralRoutes);
    router.use('/rewards', rewardRoutes);
  } catch (error) {
    console.warn('Customer loyalty routes initialization error:', error.message);
  }
}

// Initialize routes when module loads
initializeRoutes();

// Customer loyalty system health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Customer Loyalty System integrated and running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      authentication: '/api/customer-loyalty/auth/*',
      loyalty: '/api/customer-loyalty/loyalty/*',
      referrals: '/api/customer-loyalty/referrals/*',
      rewards: '/api/customer-loyalty/rewards/*'
    }
  });
});

export default router;