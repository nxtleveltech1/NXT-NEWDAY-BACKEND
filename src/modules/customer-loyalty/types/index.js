/**
 * Customer Loyalty System Type Definitions
 * Comprehensive types for customer management and loyalty programs
 */

// Customer tier levels
export const CUSTOMER_TIERS = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum'
};

// Point earning events
export const POINT_EVENTS = {
  PURCHASE: 'purchase',
  REFERRAL: 'referral',
  BIRTHDAY: 'birthday',
  REVIEW: 'review',
  SOCIAL_SHARE: 'social_share',
  SIGNUP_BONUS: 'signup_bonus',
  MILESTONE: 'milestone',
  PROMOTION: 'promotion'
};

// Reward types
export const REWARD_TYPES = {
  DISCOUNT: 'discount',
  FREE_PRODUCT: 'free_product',
  FREE_SHIPPING: 'free_shipping',
  CASH_BACK: 'cash_back',
  GIFT_CARD: 'gift_card',
  EXCLUSIVE_ACCESS: 'exclusive_access',
  EXPERIENCE: 'experience'
};

// Transaction types
export const TRANSACTION_TYPES = {
  EARN: 'earn',
  REDEEM: 'redeem',
  EXPIRE: 'expire',
  ADJUSTMENT: 'adjustment'
};

// Referral status
export const REFERRAL_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  EXPIRED: 'expired'
};

// Achievement types for gamification
export const ACHIEVEMENT_TYPES = {
  PURCHASE_MILESTONES: 'purchase_milestones',
  LOYALTY_DURATION: 'loyalty_duration',
  REFERRAL_COUNT: 'referral_count',
  REVIEW_COUNT: 'review_count',
  SPENDING_THRESHOLD: 'spending_threshold',
  STREAK_BONUS: 'streak_bonus'
};

// Notification types
export const NOTIFICATION_TYPES = {
  POINTS_EARNED: 'points_earned',
  TIER_UPGRADE: 'tier_upgrade',
  REWARD_AVAILABLE: 'reward_available',
  POINTS_EXPIRING: 'points_expiring',
  BIRTHDAY_BONUS: 'birthday_bonus',
  REFERRAL_SUCCESS: 'referral_success',
  ACHIEVEMENT_UNLOCKED: 'achievement_unlocked'
};

// Campaign types
export const CAMPAIGN_TYPES = {
  DOUBLE_POINTS: 'double_points',
  BONUS_POINTS: 'bonus_points',
  TIER_ACCELERATOR: 'tier_accelerator',
  CASHBACK_BOOST: 'cashback_boost',
  EXCLUSIVE_REWARDS: 'exclusive_rewards'
};

// Mobile app integration events
export const MOBILE_EVENTS = {
  APP_INSTALL: 'app_install',
  PUSH_NOTIFICATION_OPENED: 'push_notification_opened',
  LOCATION_CHECK_IN: 'location_check_in',
  QR_CODE_SCAN: 'qr_code_scan',
  AR_FEATURE_USED: 'ar_feature_used'
};

// Analytics metrics
export const ANALYTICS_METRICS = {
  CUSTOMER_LIFETIME_VALUE: 'customer_lifetime_value',
  CHURN_RATE: 'churn_rate',
  ENGAGEMENT_SCORE: 'engagement_score',
  REDEMPTION_RATE: 'redemption_rate',
  REFERRAL_RATE: 'referral_rate',
  TIER_DISTRIBUTION: 'tier_distribution'
};

// Tier requirements (points needed to reach each tier)
export const TIER_REQUIREMENTS = {
  [CUSTOMER_TIERS.BRONZE]: 0,
  [CUSTOMER_TIERS.SILVER]: 1000,
  [CUSTOMER_TIERS.GOLD]: 5000,
  [CUSTOMER_TIERS.PLATINUM]: 15000
};

// Tier benefits multipliers
export const TIER_MULTIPLIERS = {
  [CUSTOMER_TIERS.BRONZE]: 1.0,
  [CUSTOMER_TIERS.SILVER]: 1.2,
  [CUSTOMER_TIERS.GOLD]: 1.5,
  [CUSTOMER_TIERS.PLATINUM]: 2.0
};

// Default point values for different events
export const DEFAULT_POINT_VALUES = {
  [POINT_EVENTS.PURCHASE]: 1, // 1 point per dollar spent
  [POINT_EVENTS.REFERRAL]: 500,
  [POINT_EVENTS.BIRTHDAY]: 200,
  [POINT_EVENTS.REVIEW]: 50,
  [POINT_EVENTS.SOCIAL_SHARE]: 25,
  [POINT_EVENTS.SIGNUP_BONUS]: 100,
  [MOBILE_EVENTS.APP_INSTALL]: 150,
  [MOBILE_EVENTS.LOCATION_CHECK_IN]: 10,
  [MOBILE_EVENTS.QR_CODE_SCAN]: 5
};

// Point expiration periods (in days)
export const POINT_EXPIRATION = {
  [POINT_EVENTS.PURCHASE]: 365,
  [POINT_EVENTS.REFERRAL]: 180,
  [POINT_EVENTS.BIRTHDAY]: 90,
  [POINT_EVENTS.PROMOTION]: 60,
  DEFAULT: 365
};

export default {
  CUSTOMER_TIERS,
  POINT_EVENTS,
  REWARD_TYPES,
  TRANSACTION_TYPES,
  REFERRAL_STATUS,
  ACHIEVEMENT_TYPES,
  NOTIFICATION_TYPES,
  CAMPAIGN_TYPES,
  MOBILE_EVENTS,
  ANALYTICS_METRICS,
  TIER_REQUIREMENTS,
  TIER_MULTIPLIERS,
  DEFAULT_POINT_VALUES,
  POINT_EXPIRATION
};