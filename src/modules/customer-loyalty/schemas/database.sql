-- Customer Loyalty System Database Schema
-- Comprehensive loyalty program with all requested features

-- Enhanced customer profiles table
CREATE TABLE IF NOT EXISTS customer_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    gender ENUM('male', 'female', 'other', 'prefer_not_to_say'),
    
    -- Address information
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'US',
    
    -- Loyalty information
    current_tier ENUM('bronze', 'silver', 'gold', 'platinum') DEFAULT 'bronze',
    total_points INT DEFAULT 0,
    available_points INT DEFAULT 0,
    lifetime_points INT DEFAULT 0,
    tier_points INT DEFAULT 0,
    
    -- Engagement metrics
    total_purchases INT DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0.00,
    average_order_value DECIMAL(10,2) DEFAULT 0.00,
    last_purchase_date DATETIME,
    enrollment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Preferences
    communication_preferences JSON,
    interests JSON,
    preferred_categories JSON,
    
    -- Mobile app integration
    mobile_app_installed BOOLEAN DEFAULT FALSE,
    push_notifications_enabled BOOLEAN DEFAULT TRUE,
    location_services_enabled BOOLEAN DEFAULT FALSE,
    
    -- Social and referral
    referral_code VARCHAR(20) UNIQUE,
    referred_by VARCHAR(50),
    total_referrals INT DEFAULT 0,
    successful_referrals INT DEFAULT 0,
    
    -- Gamification
    achievement_badges JSON,
    engagement_score INT DEFAULT 0,
    streak_days INT DEFAULT 0,
    last_streak_date DATE,
    
    -- System fields
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_customer_email (email),
    INDEX idx_customer_tier (current_tier),
    INDEX idx_customer_points (available_points),
    INDEX idx_referral_code (referral_code),
    INDEX idx_last_activity (last_activity_date)
);

-- Points transactions table
CREATE TABLE IF NOT EXISTS points_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_id VARCHAR(50) UNIQUE NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    transaction_type ENUM('earn', 'redeem', 'expire', 'adjustment') NOT NULL,
    points_amount INT NOT NULL,
    balance_after INT NOT NULL,
    
    -- Transaction context
    event_type VARCHAR(50),
    order_id VARCHAR(50),
    campaign_id VARCHAR(50),
    multiplier DECIMAL(3,2) DEFAULT 1.00,
    
    -- Details
    description TEXT,
    metadata JSON,
    
    -- Expiration
    expires_at DATETIME,
    expired BOOLEAN DEFAULT FALSE,
    
    -- System fields
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    INDEX idx_customer_transactions (customer_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_event_type (event_type),
    INDEX idx_expiration (expires_at, expired),
    INDEX idx_created_date (created_at)
);

-- Rewards catalog table
CREATE TABLE IF NOT EXISTS rewards_catalog (
    id INT PRIMARY KEY AUTO_INCREMENT,
    reward_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    reward_type ENUM('discount', 'free_product', 'free_shipping', 'cash_back', 'gift_card', 'exclusive_access', 'experience') NOT NULL,
    
    -- Cost and availability
    points_cost INT NOT NULL,
    cash_value DECIMAL(10,2),
    tier_requirement ENUM('bronze', 'silver', 'gold', 'platinum'),
    
    -- Product/service details
    product_id VARCHAR(50),
    discount_percentage DECIMAL(5,2),
    discount_amount DECIMAL(10,2),
    minimum_purchase DECIMAL(10,2),
    
    -- Availability
    total_quantity INT,
    available_quantity INT,
    max_per_customer INT DEFAULT 1,
    
    -- Validity
    valid_from DATETIME,
    valid_until DATETIME,
    
    -- Categories and targeting
    categories JSON,
    applicable_products JSON,
    excluded_products JSON,
    
    -- Status and metadata
    status ENUM('active', 'inactive', 'draft') DEFAULT 'active',
    featured BOOLEAN DEFAULT FALSE,
    image_url VARCHAR(500),
    terms_conditions TEXT,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_reward_type (reward_type),
    INDEX idx_points_cost (points_cost),
    INDEX idx_tier_requirement (tier_requirement),
    INDEX idx_status (status),
    INDEX idx_validity (valid_from, valid_until)
);

-- Reward redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    redemption_id VARCHAR(50) UNIQUE NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    reward_id VARCHAR(50) NOT NULL,
    
    -- Redemption details
    points_used INT NOT NULL,
    cash_value DECIMAL(10,2),
    
    -- Usage
    redemption_code VARCHAR(50) UNIQUE,
    used BOOLEAN DEFAULT FALSE,
    used_at DATETIME,
    used_order_id VARCHAR(50),
    
    -- Validity
    expires_at DATETIME,
    
    -- Status
    status ENUM('active', 'used', 'expired', 'cancelled') DEFAULT 'active',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (reward_id) REFERENCES rewards_catalog(reward_id) ON DELETE RESTRICT,
    INDEX idx_customer_redemptions (customer_id),
    INDEX idx_redemption_code (redemption_code),
    INDEX idx_status (status),
    INDEX idx_expiration (expires_at)
);

-- Purchase history table (enhanced for loyalty tracking)
CREATE TABLE IF NOT EXISTS customer_purchase_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    purchase_id VARCHAR(50) UNIQUE NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    order_id VARCHAR(50),
    
    -- Purchase details
    purchase_date DATETIME NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(10,2),
    shipping_amount DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    
    -- Loyalty related
    points_earned INT DEFAULT 0,
    tier_at_purchase ENUM('bronze', 'silver', 'gold', 'platinum'),
    multiplier_applied DECIMAL(3,2) DEFAULT 1.00,
    campaign_bonuses JSON,
    
    -- Product details
    items JSON,
    categories JSON,
    
    -- Redemptions used
    redemptions_applied JSON,
    
    -- Source and channel
    purchase_channel ENUM('online', 'mobile_app', 'in_store', 'phone') DEFAULT 'online',
    source_campaign VARCHAR(100),
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    INDEX idx_customer_purchases (customer_id),
    INDEX idx_purchase_date (purchase_date),
    INDEX idx_purchase_channel (purchase_channel),
    INDEX idx_points_earned (points_earned)
);

-- Referral program table
CREATE TABLE IF NOT EXISTS customer_referrals (
    id INT PRIMARY KEY AUTO_INCREMENT,
    referral_id VARCHAR(50) UNIQUE NOT NULL,
    referrer_customer_id VARCHAR(50) NOT NULL,
    referee_customer_id VARCHAR(50),
    
    -- Referral details
    referral_code VARCHAR(20) NOT NULL,
    referee_email VARCHAR(255),
    referee_phone VARCHAR(20),
    
    -- Status and rewards
    status ENUM('pending', 'completed', 'expired') DEFAULT 'pending',
    referrer_points_awarded INT DEFAULT 0,
    referee_points_awarded INT DEFAULT 0,
    referrer_reward_id VARCHAR(50),
    referee_reward_id VARCHAR(50),
    
    -- Tracking
    referral_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    signup_date DATETIME,
    first_purchase_date DATETIME,
    completed_date DATETIME,
    expires_at DATETIME,
    
    -- Metadata
    referral_source VARCHAR(100),
    campaign_id VARCHAR(50),
    
    FOREIGN KEY (referrer_customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (referee_customer_id) REFERENCES customer_profiles(customer_id) ON DELETE SET NULL,
    INDEX idx_referrer (referrer_customer_id),
    INDEX idx_referral_code (referral_code),
    INDEX idx_status (status),
    INDEX idx_referral_date (referral_date)
);

-- Birthday rewards table
CREATE TABLE IF NOT EXISTS birthday_rewards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id VARCHAR(50) NOT NULL,
    birthday_year YEAR NOT NULL,
    
    -- Reward details
    points_awarded INT DEFAULT 0,
    reward_id VARCHAR(50),
    
    -- Status
    awarded BOOLEAN DEFAULT FALSE,
    awarded_date DATETIME,
    redeemed BOOLEAN DEFAULT FALSE,
    redeemed_date DATETIME,
    
    -- Validity
    expires_at DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_year (customer_id, birthday_year),
    INDEX idx_birthday_year (birthday_year),
    INDEX idx_awarded_status (awarded)
);

-- Achievements and gamification table
CREATE TABLE IF NOT EXISTS customer_achievements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id VARCHAR(50) NOT NULL,
    achievement_id VARCHAR(50) NOT NULL,
    achievement_type VARCHAR(50) NOT NULL,
    
    -- Achievement details
    title VARCHAR(200) NOT NULL,
    description TEXT,
    badge_icon VARCHAR(500),
    points_awarded INT DEFAULT 0,
    
    -- Progress
    target_value INT,
    current_value INT,
    completed BOOLEAN DEFAULT FALSE,
    
    -- Dates
    unlocked_date DATETIME,
    completed_date DATETIME,
    
    -- Metadata
    metadata JSON,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_achievement (customer_id, achievement_id),
    INDEX idx_achievement_type (achievement_type),
    INDEX idx_completed (completed),
    INDEX idx_unlocked_date (unlocked_date)
);

-- Loyalty campaigns table
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    campaign_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    campaign_type ENUM('double_points', 'bonus_points', 'tier_accelerator', 'cashback_boost', 'exclusive_rewards') NOT NULL,
    
    -- Campaign parameters
    multiplier DECIMAL(3,2) DEFAULT 1.00,
    bonus_points INT DEFAULT 0,
    minimum_purchase DECIMAL(10,2),
    maximum_bonus INT,
    
    -- Targeting
    target_tiers JSON,
    target_customers JSON,
    applicable_categories JSON,
    excluded_categories JSON,
    
    -- Validity
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    
    -- Limits
    max_participants INT,
    current_participants INT DEFAULT 0,
    max_uses_per_customer INT DEFAULT 1,
    total_budget DECIMAL(12,2),
    used_budget DECIMAL(12,2) DEFAULT 0.00,
    
    -- Status
    status ENUM('draft', 'active', 'paused', 'completed', 'cancelled') DEFAULT 'draft',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_campaign_type (campaign_type),
    INDEX idx_status (status),
    INDEX idx_validity (start_date, end_date)
);

-- Campaign participation tracking
CREATE TABLE IF NOT EXISTS campaign_participations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id VARCHAR(50) NOT NULL,
    campaign_id VARCHAR(50) NOT NULL,
    
    -- Participation details
    participation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    bonus_points_earned INT DEFAULT 0,
    purchases_count INT DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0.00,
    
    -- Status
    active BOOLEAN DEFAULT TRUE,
    completed BOOLEAN DEFAULT FALSE,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES loyalty_campaigns(campaign_id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_campaign (customer_id, campaign_id),
    INDEX idx_participation_date (participation_date),
    INDEX idx_active_campaigns (active)
);

-- Customer notifications table
CREATE TABLE IF NOT EXISTS customer_notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    notification_id VARCHAR(50) UNIQUE NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    
    -- Notification content
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    
    -- Delivery
    channels JSON, -- email, push, sms, in_app
    sent BOOLEAN DEFAULT FALSE,
    sent_at DATETIME,
    
    -- Engagement
    opened BOOLEAN DEFAULT FALSE,
    opened_at DATETIME,
    clicked BOOLEAN DEFAULT FALSE,
    clicked_at DATETIME,
    
    -- Action
    action_url VARCHAR(500),
    action_taken BOOLEAN DEFAULT FALSE,
    action_taken_at DATETIME,
    
    -- Metadata
    metadata JSON,
    expires_at DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    INDEX idx_customer_notifications (customer_id),
    INDEX idx_notification_type (notification_type),
    INDEX idx_sent_status (sent),
    INDEX idx_created_date (created_at)
);

-- Mobile app integration events
CREATE TABLE IF NOT EXISTS mobile_app_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(50) UNIQUE NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    points_earned INT DEFAULT 0,
    
    -- Location (if applicable)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name VARCHAR(200),
    
    -- Device info
    device_type VARCHAR(50),
    app_version VARCHAR(20),
    os_version VARCHAR(50),
    
    -- Timestamps
    event_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    
    FOREIGN KEY (customer_id) REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
    INDEX idx_customer_events (customer_id),
    INDEX idx_event_type (event_type),
    INDEX idx_event_timestamp (event_timestamp),
    INDEX idx_location (latitude, longitude)
);

-- Analytics and reporting views
CREATE OR REPLACE VIEW customer_loyalty_summary AS
SELECT 
    cp.customer_id,
    cp.email,
    cp.first_name,
    cp.last_name,
    cp.current_tier,
    cp.total_points,
    cp.available_points,
    cp.lifetime_points,
    cp.total_purchases,
    cp.total_spent,
    cp.average_order_value,
    cp.last_purchase_date,
    cp.enrollment_date,
    cp.successful_referrals,
    cp.engagement_score,
    
    -- Recent activity
    DATEDIFF(NOW(), cp.last_activity_date) as days_since_last_activity,
    
    -- Point activity (last 30 days)
    COALESCE(recent_points.points_earned_30d, 0) as points_earned_30d,
    COALESCE(recent_points.points_redeemed_30d, 0) as points_redeemed_30d,
    
    -- Tier progress
    CASE 
        WHEN cp.current_tier = 'platinum' THEN 100
        WHEN cp.current_tier = 'gold' THEN ROUND((cp.tier_points / 15000) * 100, 2)
        WHEN cp.current_tier = 'silver' THEN ROUND((cp.tier_points / 5000) * 100, 2)
        ELSE ROUND((cp.tier_points / 1000) * 100, 2)
    END as tier_progress_percentage

FROM customer_profiles cp
LEFT JOIN (
    SELECT 
        customer_id,
        SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END) as points_earned_30d,
        SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END) as points_redeemed_30d
    FROM points_transactions 
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY customer_id
) recent_points ON cp.customer_id = recent_points.customer_id;

-- Indexes for performance optimization
CREATE INDEX idx_customer_profiles_tier_points ON customer_profiles(current_tier, tier_points);
CREATE INDEX idx_points_transactions_customer_date ON points_transactions(customer_id, created_at);
CREATE INDEX idx_purchase_history_customer_date ON customer_purchase_history(customer_id, purchase_date);
CREATE INDEX idx_rewards_catalog_active ON rewards_catalog(status, tier_requirement, points_cost);