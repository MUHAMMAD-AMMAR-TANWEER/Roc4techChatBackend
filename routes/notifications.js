const express = require('express');
const router = express.Router();

// GET notifications by internal_id (with pagination)
// GET /api/notifications/:internal_id?page=1&limit=20
router.get('/:internal_id', async (req, res) => {
  try {
    const { internal_id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pool = req.app.locals.pool;

    console.log(`\n========================================`);
    console.log(`📥 [GET-NOTIFICATIONS] Fetching notifications for user: ${internal_id}`);
    console.log(`📄 [GET-NOTIFICATIONS] Pagination: page=${page}, limit=${limit}`);
    console.log(`========================================`);

    if (!internal_id) {
      console.log('❌ [GET-NOTIFICATIONS] Error: internal_id is required');
      return res.status(400).json({
        error: 'internal_id is required'
      });
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // First, get total count (for pagination info)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM (
        SELECT DISTINCT n.title, n.body, n.type, n.created_at
        FROM user_notifications n
        WHERE n.internal_id = $1
      ) as unique_notifications
    `;
    const countResult = await pool.query(countQuery, [internal_id]);
    const totalCount = parseInt(countResult.rows[0].total);

    // Get unwatched count
    const unwatchedQuery = `
      SELECT COUNT(*) as unwatched
      FROM (
        SELECT
          n.title, n.body, n.type, n.created_at,
          BOOL_OR(n.watched) as watched
        FROM user_notifications n
        WHERE n.internal_id = $1
        GROUP BY n.title, n.body, n.type, n.created_at
        HAVING BOOL_OR(n.watched) = false
      ) as unwatched_notifications
    `;
    const unwatchedResult = await pool.query(unwatchedQuery, [internal_id]);
    const unwatchedCount = parseInt(unwatchedResult.rows[0].unwatched);

    // Query notifications for the user, deduplicating across devices with pagination
    // Show notification as watched if ANY device has marked it as watched
    const query = `
      SELECT
        MIN(n.id) as id,
        n.title,
        n.body,
        n.type,
        MAX(n.message_type) as message_type,
        MAX(n.internal_task_id) as internal_task_id,
        BOOL_OR(n.watched) as watched,
        n.created_at,
        MAX(n.watched_at) as watched_at,
        COUNT(*) as device_count
      FROM user_notifications n
      WHERE n.internal_id = $1
      GROUP BY n.title, n.body, n.type, n.created_at
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [internal_id, limitNum, offset]);

    console.log(`✅ [GET-NOTIFICATIONS] Found ${totalCount} total unique notification(s)`);
    console.log(`   - Total: ${totalCount}`);
    console.log(`   - Unwatched: ${unwatchedCount}`);
    console.log(`   - Watched: ${totalCount - unwatchedCount}`);
    console.log(`   - Returning page ${pageNum} with ${result.rows.length} results`);

    if (result.rows.length > 0) {
      console.log(`\n📋 [GET-NOTIFICATIONS] Notification list (page ${pageNum}):`);
      result.rows.forEach((notif, index) => {
        console.log(`   ${index + 1}. ID: ${notif.id}, Title: "${notif.title}", Type: ${notif.type}, Watched: ${notif.watched}, Devices: ${notif.device_count}`);
      });
    }
    console.log(`========================================\n`);

    res.json({
      success: true,
      internal_id: internal_id,
      total_count: totalCount,
      unwatched_count: unwatchedCount,
      notifications: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum),
        has_next: pageNum < Math.ceil(totalCount / limitNum),
        has_previous: pageNum > 1
      }
    });

  } catch (error) {
    console.error('[GET-NOTIFICATIONS] ❌ Error fetching notifications:', error);
    res.status(500).json({
      error: 'Failed to fetch notifications',
      message: error.message
    });
  }
});

// PUT mark notification as watched
// PUT /api/notifications/:id/watched
router.put('/:id/watched', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = req.app.locals.pool;

    console.log(`\n========================================`);
    console.log(`📝 [MARK-WATCHED] Marking notification ID: ${id} as watched`);
    console.log(`========================================`);

    if (!id) {
      console.log('❌ [MARK-WATCHED] Error: notification id is required');
      return res.status(400).json({
        error: 'notification id is required'
      });
    }

    // First, get the notification details to find all related notifications
    console.log(`🔍 [MARK-WATCHED] Fetching notification details for ID: ${id}`);
    const getNotification = await pool.query(
      'SELECT internal_id, title, body, type, created_at FROM user_notifications WHERE id = $1',
      [id]
    );

    if (getNotification.rows.length === 0) {
      console.log(`❌ [MARK-WATCHED] Notification ID ${id} not found`);
      return res.status(404).json({
        error: 'Notification not found'
      });
    }

    const { internal_id, title, body, type, created_at } = getNotification.rows[0];
    console.log(`✅ [MARK-WATCHED] Found notification:`);
    console.log(`   - internal_id: ${internal_id}`);
    console.log(`   - title: ${title}`);
    console.log(`   - body: ${body.substring(0, 50)}...`);
    console.log(`   - type: ${type}`);
    console.log(`   - created_at: ${created_at}`);

    // Update ALL notifications for this user with matching title, body, and type
    // This ensures all devices see the notification as watched
    console.log(`\n🔄 [MARK-WATCHED] Updating all matching notifications for user ${internal_id}...`);

    // Use ABS and EXTRACT to match within 1 second window to handle timestamp precision issues
    const query = `
      UPDATE user_notifications
      SET watched = true,
          watched_at = CURRENT_TIMESTAMP
      WHERE internal_id = $1
        AND title = $2
        AND body = $3
        AND type = $4
        AND ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamp))) < 1
        AND watched = false
      RETURNING id, title, watched, watched_at, fcm_token, device_id
    `;

    const result = await pool.query(query, [internal_id, title, body, type, created_at]);

    console.log(`✅ [MARK-WATCHED] Updated ${result.rows.length} notification record(s)`);
    if (result.rows.length > 0) {
      console.log(`📱 [MARK-WATCHED] Updated notifications:`);
      result.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ID: ${row.id}, Device: ${row.device_id || 'unknown'}, FCM: ${row.fcm_token ? row.fcm_token.substring(0, 20) + '...' : 'none'}`);
      });
    } else {
      console.log(`⚠️ [MARK-WATCHED] No unwatched notifications found to update (may already be watched)`);
    }
    console.log(`========================================\n`);

    res.json({
      success: true,
      message: `Notification marked as watched across ${result.rows.length} device(s)`,
      updated_count: result.rows.length,
      notifications: result.rows
    });

  } catch (error) {
    console.error('[MARK-WATCHED] ❌ Error marking notification as watched:', error);
    res.status(500).json({
      error: 'Failed to update notification',
      message: error.message
    });
  }
});

// Bulk mark multiple notifications as watched
// PUT /api/notifications/bulk/watched
router.put('/bulk/watched', async (req, res) => {
  try {
    const { notification_ids } = req.body;
    const pool = req.app.locals.pool;

    if (!notification_ids || !Array.isArray(notification_ids) || notification_ids.length === 0) {
      return res.status(400).json({
        error: 'notification_ids array is required'
      });
    }

    // Get all notification details to find related notifications across devices
    const getNotifications = await pool.query(
      'SELECT DISTINCT internal_id, title, body, type, created_at FROM user_notifications WHERE id = ANY($1::int[])',
      [notification_ids]
    );

    if (getNotifications.rows.length === 0) {
      return res.status(404).json({
        error: 'No notifications found'
      });
    }

    let totalUpdated = 0;
    const allUpdatedNotifications = [];

    // For each unique notification, update all devices
    for (const notif of getNotifications.rows) {
      const result = await pool.query(`
        UPDATE user_notifications
        SET watched = true,
            watched_at = CURRENT_TIMESTAMP
        WHERE internal_id = $1
          AND title = $2
          AND body = $3
          AND type = $4
          AND ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamp))) < 1
          AND watched = false
        RETURNING id, title, watched, watched_at
      `, [notif.internal_id, notif.title, notif.body, notif.type, notif.created_at]);

      totalUpdated += result.rows.length;
      allUpdatedNotifications.push(...result.rows);
    }

    res.json({
      success: true,
      message: `${totalUpdated} notifications marked as watched across all devices`,
      updated_count: totalUpdated,
      unique_notifications: getNotifications.rows.length,
      notifications: allUpdatedNotifications
    });

  } catch (error) {
    console.error('[NOTIFICATIONS] Error bulk marking notifications:', error);
    res.status(500).json({
      error: 'Failed to update notifications',
      message: error.message
    });
  }
});

// Mark all notifications as watched for a user
// PUT /api/notifications/:internal_id/mark-all-watched
router.put('/:internal_id/mark-all-watched', async (req, res) => {
  try {
    const { internal_id } = req.params;
    const pool = req.app.locals.pool;

    if (!internal_id) {
      return res.status(400).json({
        error: 'internal_id is required'
      });
    }

    // Update all unwatched notifications for the user
    const query = `
      UPDATE user_notifications
      SET watched = true,
          watched_at = CURRENT_TIMESTAMP
      WHERE internal_id = $1 AND watched = false
      RETURNING id
    `;

    const result = await pool.query(query, [internal_id]);

    res.json({
      success: true,
      message: `All notifications marked as watched`,
      updated_count: result.rows.length,
      internal_id: internal_id
    });

  } catch (error) {
    console.error('[NOTIFICATIONS] Error marking all notifications as watched:', error);
    res.status(500).json({
      error: 'Failed to update notifications',
      message: error.message
    });
  }
});

// DELETE notification by id
// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = req.app.locals.pool;

    console.log(`\n========================================`);
    console.log(`🗑️ [DELETE-NOTIFICATION] Deleting notification ID: ${id}`);
    console.log(`========================================`);

    if (!id) {
      console.log('❌ [DELETE-NOTIFICATION] Error: notification id is required');
      return res.status(400).json({
        error: 'notification id is required'
      });
    }

    // First, get the notification details to find all related notifications across devices
    console.log(`🔍 [DELETE-NOTIFICATION] Fetching notification details for ID: ${id}`);
    const getNotification = await pool.query(
      'SELECT internal_id, title, body, type, created_at FROM user_notifications WHERE id = $1',
      [id]
    );

    if (getNotification.rows.length === 0) {
      console.log(`❌ [DELETE-NOTIFICATION] Notification ID ${id} not found`);
      return res.status(404).json({
        error: 'Notification not found'
      });
    }

    const { internal_id, title, body, type, created_at } = getNotification.rows[0];
    console.log(`✅ [DELETE-NOTIFICATION] Found notification:`);
    console.log(`   - internal_id: ${internal_id}`);
    console.log(`   - title: ${title}`);
    console.log(`   - type: ${type}`);

    // Delete ALL notifications for this user with matching title, body, type, and created_at
    // This ensures the notification is deleted across all devices
    console.log(`\n🗑️ [DELETE-NOTIFICATION] Deleting all matching notifications for user ${internal_id}...`);
    const query = `
      DELETE FROM user_notifications
      WHERE internal_id = $1
        AND title = $2
        AND body = $3
        AND type = $4
        AND ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamp))) < 1
      RETURNING id, device_id, fcm_token
    `;

    const result = await pool.query(query, [internal_id, title, body, type, created_at]);

    console.log(`✅ [DELETE-NOTIFICATION] Deleted ${result.rows.length} notification record(s)`);
    if (result.rows.length > 0) {
      console.log(`📱 [DELETE-NOTIFICATION] Deleted from devices:`);
      result.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ID: ${row.id}, Device: ${row.device_id || 'unknown'}`);
      });
    }
    console.log(`========================================\n`);

    res.json({
      success: true,
      message: `Notification deleted from ${result.rows.length} device(s)`,
      deleted_count: result.rows.length,
      deleted_records: result.rows
    });

  } catch (error) {
    console.error('[DELETE-NOTIFICATION] ❌ Error deleting notification:', error);
    res.status(500).json({
      error: 'Failed to delete notification',
      message: error.message
    });
  }
});

// Bulk DELETE notifications
// DELETE /api/notifications/bulk/delete
router.delete('/bulk/delete', async (req, res) => {
  try {
    const { notification_ids } = req.body;
    const pool = req.app.locals.pool;

    console.log(`\n========================================`);
    console.log(`🗑️ [BULK-DELETE] Deleting notifications: ${notification_ids}`);
    console.log(`========================================`);

    if (!notification_ids || !Array.isArray(notification_ids) || notification_ids.length === 0) {
      console.log('❌ [BULK-DELETE] Error: notification_ids array is required');
      return res.status(400).json({
        error: 'notification_ids array is required'
      });
    }

    // Get all notification details to find related notifications across devices
    const getNotifications = await pool.query(
      'SELECT DISTINCT internal_id, title, body, type, created_at FROM user_notifications WHERE id = ANY($1::int[])',
      [notification_ids]
    );

    if (getNotifications.rows.length === 0) {
      console.log('❌ [BULK-DELETE] No notifications found');
      return res.status(404).json({
        error: 'No notifications found'
      });
    }

    let totalDeleted = 0;
    const allDeletedRecords = [];

    // For each unique notification, delete all device records
    for (const notif of getNotifications.rows) {
      const result = await pool.query(`
        DELETE FROM user_notifications
        WHERE internal_id = $1
          AND title = $2
          AND body = $3
          AND type = $4
          AND ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamp))) < 1
        RETURNING id, device_id
      `, [notif.internal_id, notif.title, notif.body, notif.type, notif.created_at]);

      totalDeleted += result.rows.length;
      allDeletedRecords.push(...result.rows);
    }

    console.log(`✅ [BULK-DELETE] Deleted ${totalDeleted} notification record(s)`);
    console.log(`========================================\n`);

    res.json({
      success: true,
      message: `${totalDeleted} notifications deleted across all devices`,
      deleted_count: totalDeleted,
      unique_notifications: getNotifications.rows.length,
      deleted_records: allDeletedRecords
    });

  } catch (error) {
    console.error('[BULK-DELETE] ❌ Error deleting notifications:', error);
    res.status(500).json({
      error: 'Failed to delete notifications',
      message: error.message
    });
  }
});

module.exports = router;
