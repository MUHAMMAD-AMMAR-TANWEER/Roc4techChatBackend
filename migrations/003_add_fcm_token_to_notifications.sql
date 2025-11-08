-- ==========================================
-- Add FCM Token to Notifications Table
-- ==========================================

BEGIN;

-- Add fcm_token and device_id columns to user_notifications table
ALTER TABLE user_notifications
ADD COLUMN IF NOT EXISTS fcm_token TEXT,
ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);

-- Create index for fcm_token for performance
CREATE INDEX IF NOT EXISTS idx_notifications_fcm_token
ON user_notifications(fcm_token);

CREATE INDEX IF NOT EXISTS idx_notifications_device_id
ON user_notifications(device_id);

COMMIT;

-- Verification query
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_notifications'
  AND column_name IN ('fcm_token', 'device_id')
ORDER BY ordinal_position;
