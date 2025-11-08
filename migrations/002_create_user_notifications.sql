-- ==========================================
-- User Notifications Table Migration v1.0
-- ==========================================

BEGIN;

-- Create user_notifications table
CREATE TABLE IF NOT EXISTS user_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  internal_id VARCHAR(50),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'broadcast',
  watched BOOLEAN DEFAULT FALSE,
  fcm_token TEXT,
  device_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  watched_at TIMESTAMP NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
ON user_notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_internal_id
ON user_notifications(internal_id);

CREATE INDEX IF NOT EXISTS idx_notifications_watched
ON user_notifications(watched);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON user_notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type
ON user_notifications(type);

COMMIT;

-- Verification query
SELECT
    'user_notifications' as table_name,
    COUNT(*) as total_records
FROM user_notifications;

-- Show table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_notifications'
ORDER BY ordinal_position;
