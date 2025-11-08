-- ==========================================
-- Add Message Type and Internal Task ID to Notifications
-- ==========================================

BEGIN;

-- Add message_type and internal_task_id columns
ALTER TABLE user_notifications
ADD COLUMN IF NOT EXISTS message_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS internal_task_id VARCHAR(50);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_message_type
ON user_notifications(message_type);

CREATE INDEX IF NOT EXISTS idx_notifications_internal_task_id
ON user_notifications(internal_task_id);

-- Add comments for clarity
COMMENT ON COLUMN user_notifications.message_type IS 'Determines routing behavior in mobile app: task_notification, admin_broadcast, broadcast_internal, targeted_broadcast';
COMMENT ON COLUMN user_notifications.internal_task_id IS 'Task ID for routing to task details (only for task-related notifications)';

COMMIT;

-- Verification query
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_notifications'
  AND column_name IN ('message_type', 'internal_task_id')
ORDER BY ordinal_position;

-- Show sample data
SELECT id, type, message_type, internal_task_id, title
FROM user_notifications
LIMIT 5;
