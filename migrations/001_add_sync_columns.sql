-- ==========================================
-- Chat Sync System Migration v1.0
-- ==========================================

BEGIN;

-- Add internal ID columns for Odoo mapping
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS sender_internal_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS receiver_internal_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS synced_to_odoo BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'mobile';

-- Add composite text columns for quoted messages
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS quoted_message_text TEXT,
ADD COLUMN IF NOT EXISTS quoted_sender_name VARCHAR(255);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_sender_internal 
ON messages(sender_internal_id);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_internal 
ON messages(receiver_internal_id);

CREATE INDEX IF NOT EXISTS idx_messages_sync_status 
ON messages(synced_to_odoo);

CREATE INDEX IF NOT EXISTS idx_messages_source 
ON messages(source);

-- Backfill existing messages with internal IDs
UPDATE messages m
SET 
  sender_internal_id = (SELECT internal_user_id FROM users WHERE id = m.sender_id),
  receiver_internal_id = (
    SELECT 
      CASE 
        WHEN cr.client_id = m.sender_id THEN tech.internal_user_id
        ELSE client.internal_user_id
      END
    FROM chat_rooms cr
    LEFT JOIN users client ON cr.client_id = client.id
    LEFT JOIN users tech ON cr.technician_id = tech.id
    WHERE cr.id = m.room_id
  )
WHERE sender_internal_id IS NULL;

COMMIT;

-- Verification query
SELECT 
    'Messages' as table_name,
    COUNT(*) as total_records,
    COUNT(sender_internal_id) as with_sender_id,
    COUNT(receiver_internal_id) as with_receiver_id,
    COUNT(*) FILTER (WHERE synced_to_odoo = true) as synced_count
FROM messages;

-- Show new columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
  AND column_name IN (
    'sender_internal_id', 
    'receiver_internal_id', 
    'synced_to_odoo', 
    'synced_at', 
    'source',
    'quoted_message_text',
    'quoted_sender_name'
  )
ORDER BY ordinal_position;