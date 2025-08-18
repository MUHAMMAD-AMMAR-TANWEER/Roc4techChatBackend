// ===== ROUTES/ADMIN.JS =====
const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Get database pool from app locals
const getPool = (req) => req.app.locals.pool;

// Get all active chat rooms with latest message info
router.get('/rooms', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const pool = getPool(req);
    const offset = (page - 1) * limit;

    let whereClause = '';
    let queryParams = [limit, offset];
    
    if (search) {
      whereClause = `WHERE (cr.room_name ILIKE $3 OR client.username ILIKE $3 OR tech.username ILIKE $3 OR t.task_name ILIKE $3)`;
      queryParams = [limit, offset, `%${search}%`];
    }

    const result = await pool.query(`
      SELECT 
        cr.id as room_id,
        cr.room_name,
        cr.created_at as room_created,
        cr.last_message_at,
        cr.is_active,
        client.internal_user_id as client_internal_id,
        client.username as client_username,
        client.full_name as client_name,
        client.is_online as client_online,
        tech.internal_user_id as technician_internal_id,
        tech.username as technician_username,
        tech.full_name as technician_name,
        tech.is_online as technician_online,
        t.task_name,
        t.internal_task_id,
        latest_msg.message_text as last_message,
        latest_msg.message_type as last_message_type,
        latest_msg.created_at as last_message_time,
        sender.username as last_sender,
        (SELECT COUNT(*) FROM messages WHERE room_id = cr.id) as total_messages,
        (SELECT COUNT(*) FROM messages WHERE room_id = cr.id AND is_read = false) as unread_messages
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      LEFT JOIN LATERAL (
        SELECT m.message_text, m.message_type, m.created_at, m.sender_id
        FROM messages m 
        WHERE m.room_id = cr.id 
        ORDER BY m.created_at DESC 
        LIMIT 1
      ) latest_msg ON true
      LEFT JOIN users sender ON latest_msg.sender_id = sender.id
      ${whereClause}
      ORDER BY cr.last_message_at DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `, queryParams);

    // Get total count
    const countQuery = search 
      ? `SELECT COUNT(*) FROM chat_rooms cr 
         JOIN users client ON cr.client_id = client.id
         JOIN users tech ON cr.technician_id = tech.id
         JOIN tasks t ON cr.task_id = t.id
         WHERE (cr.room_name ILIKE $1 OR client.username ILIKE $1 OR tech.username ILIKE $1 OR t.task_name ILIKE $1)`
      : `SELECT COUNT(*) FROM chat_rooms`;
    
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      rooms: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch chat rooms' });
  }
});

// Get messages for a specific room

/** */
router.get('/rooms/:roomId/messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pool = getPool(req);
    const offset = (page - 1) * limit;

    // Get room info first
    const roomInfo = await pool.query(`
      SELECT 
        cr.*,
        client.internal_user_id as client_internal_id,
        client.username as client_username,
        client.full_name as client_name,
        tech.internal_user_id as technician_internal_id,
        tech.username as technician_username,
        tech.full_name as technician_name,
        t.task_name,
        t.internal_task_id
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE cr.id = $1
    `, [roomId]);

    if (roomInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get messages with quoted message details
    const messagesResult = await pool.query(`
      SELECT 
        m.*,
        u.username,
        u.full_name,
        u.avatar_url,
        u.user_type,
        (
          SELECT COUNT(*) 
          FROM message_reads mr 
          WHERE mr.message_id = m.id
        ) as read_count
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `, [roomId, limit, offset]);

    // Get total message count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE room_id = $1',
      [roomId]
    );

    res.json({
      success: true,
      room_info: roomInfo.rows[0],
      messages: messagesResult.rows.reverse(), // Reverse to get chronological order
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search messages across all rooms
router.get('/search', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      query, 
      client_internal_id, 
      technician_internal_id, 
      task_internal_id, 
      start_date, 
      end_date,
      message_type,
      page = 1,
      limit = 20 
    } = req.query;

    const pool = getPool(req);
    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 0;

    if (query) {
      paramCount++;
      whereConditions.push(`m.message_text ILIKE ${paramCount}`);
      queryParams.push(`%${query}%`);
    }

    if (client_internal_id) {
      paramCount++;
      whereConditions.push(`client.internal_user_id = ${paramCount}`);
      queryParams.push(client_internal_id);
    }

    if (technician_internal_id) {
      paramCount++;
      whereConditions.push(`tech.internal_user_id = ${paramCount}`);
      queryParams.push(technician_internal_id);
    }

    if (task_internal_id) {
      paramCount++;
      whereConditions.push(`t.internal_task_id = ${paramCount}`);
      queryParams.push(task_internal_id);
    }

    if (start_date) {
      paramCount++;
      whereConditions.push(`m.created_at >= ${paramCount}`);
      queryParams.push(start_date);
    }

    if (end_date) {
      paramCount++;
      whereConditions.push(`m.created_at <= ${paramCount}`);
      queryParams.push(end_date);
    }

    if (message_type) {
      paramCount++;
      whereConditions.push(`m.message_type = ${paramCount}`);
      queryParams.push(message_type);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    paramCount++;
    queryParams.push(limit);
    paramCount++;
    queryParams.push(offset);

    const searchResult = await pool.query(`
      SELECT 
        m.*,
        sender.username as sender_username,
        sender.full_name as sender_name,
        sender.user_type as sender_type,
        client.internal_user_id as client_internal_id,
        client.username as client_username,
        client.full_name as client_name,
        tech.internal_user_id as technician_internal_id,
        tech.username as technician_username,
        tech.full_name as technician_name,
        t.task_name,
        t.internal_task_id,
        cr.room_name
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN users sender ON m.sender_id = sender.id
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ${paramCount-1} OFFSET ${paramCount}
    `, queryParams);

    // Get count for pagination
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN users sender ON m.sender_id = sender.id
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      ${whereClause}
    `, queryParams.slice(0, -2));

    res.json({
      success: true,
      messages: searchResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get chat statistics
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = getPool(req);

    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM chat_rooms WHERE is_active = true) as active_rooms,
        (SELECT COUNT(*) FROM chat_rooms) as total_rooms,
        (SELECT COUNT(*) FROM messages WHERE created_at >= CURRENT_DATE) as messages_today,
        (SELECT COUNT(*) FROM messages WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as messages_this_week,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM users WHERE user_type = 'client' AND is_online = true) as online_clients,
        (SELECT COUNT(*) FROM users WHERE user_type = 'technician' AND is_online = true) as online_technicians,
        (SELECT COUNT(*) FROM users WHERE user_type = 'client' AND is_active = true) as total_clients,
        (SELECT COUNT(*) FROM users WHERE user_type = 'technician' AND is_active = true) as total_technicians,
        (SELECT COUNT(*) FROM tasks) as total_tasks
    `);

    // Get most active rooms today
    const activeRooms = await pool.query(`
      SELECT 
        cr.id,
        cr.room_name,
        client.username as client_username,
        tech.username as technician_username,
        t.task_name,
        COUNT(m.id) as message_count_today
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      LEFT JOIN messages m ON cr.id = m.room_id AND m.created_at >= CURRENT_DATE
      GROUP BY cr.id, cr.room_name, client.username, tech.username, t.task_name
      HAVING COUNT(m.id) > 0
      ORDER BY message_count_today DESC
      LIMIT 10
    `);

    // Get hourly message distribution for today
    const hourlyStats = await pool.query(`
      SELECT 
        EXTRACT(hour FROM created_at) as hour,
        COUNT(*) as message_count
      FROM messages 
      WHERE created_at >= CURRENT_DATE
      GROUP BY EXTRACT(hour FROM created_at)
      ORDER BY hour
    `);

    res.json({
      success: true,
      stats: stats.rows[0],
      most_active_rooms_today: activeRooms.rows,
      hourly_distribution: hourlyStats.rows
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get user activity report
router.get('/users/activity', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const pool = getPool(req);

    const userActivity = await pool.query(`
      SELECT 
        u.internal_user_id,
        u.username,
        u.full_name,
        u.user_type,
        u.is_online,
        u.last_seen,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN m.created_at >= CURRENT_DATE - INTERVAL '${days} days' THEN 1 END) as recent_messages,
        MAX(m.created_at) as last_message_time,
        COUNT(DISTINCT cr.id) as active_rooms
      FROM users u
      LEFT JOIN messages m ON u.id = m.sender_id
      LEFT JOIN chat_rooms cr ON (u.id = cr.client_id OR u.id = cr.technician_id)
      WHERE u.user_type IN ('client', 'technician')
      GROUP BY u.id, u.internal_user_id, u.username, u.full_name, u.user_type, u.is_online, u.last_seen
      ORDER BY recent_messages DESC, total_messages DESC
    `);

    res.json({
      success: true,
      user_activity: userActivity.rows,
      period_days: parseInt(days)
    });

  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

// Export messages to CSV
router.get('/export/:roomId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { roomId } = req.params;
    const pool = getPool(req);
    
    const result = await pool.query(`
      SELECT 
        m.created_at as timestamp,
        u.full_name as sender_name,
        u.user_type as sender_type,
        m.message_text,
        m.message_type,
        m.file_name,
        m.quoted_message_text,
        m.quoted_sender_name,
        cr.room_name,
        t.task_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE m.room_id = $1
      ORDER BY m.created_at ASC
    `, [roomId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No messages found for this room' });
    }

    // Convert to CSV
    const csvHeader = 'Timestamp,Room,Task,Sender Name,Sender Type,Message,Type,File Name,Quoted Message,Quoted Sender\n';
    const csvRows = result.rows.map(row => {
      return [
        new Date(row.timestamp).toISOString(),
        `"${(row.room_name || '').replace(/"/g, '""')}"`,
        `"${(row.task_name || '').replace(/"/g, '""')}"`,
        `"${(row.sender_name || '').replace(/"/g, '""')}"`,
        row.sender_type,
        `"${(row.message_text || '').replace(/"/g, '""')}"`,
        row.message_type,
        `"${(row.file_name || '').replace(/"/g, '""')}"`,
        `"${(row.quoted_message_text || '').replace(/"/g, '""')}"`,
        `"${(row.quoted_sender_name || '').replace(/"/g, '""')}"`,
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="chat_export_room_${roomId}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvHeader + csvRows);

  } catch (error) {
    console.error('Error exporting messages:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Export all messages for a date range
router.get('/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { start_date, end_date, format = 'csv' } = req.query;
    const pool = getPool(req);

    let dateFilter = '';
    let queryParams = [];

    if (start_date && end_date) {
      dateFilter = 'WHERE m.created_at >= $1 AND m.created_at <= $2';
      queryParams = [start_date, end_date];
    } else if (start_date) {
      dateFilter = 'WHERE m.created_at >= $1';
      queryParams = [start_date];
    } else if (end_date) {
      dateFilter = 'WHERE m.created_at <= $1';
      queryParams = [end_date];
    }

    const result = await pool.query(`
      SELECT 
        m.created_at as timestamp,
        cr.room_name,
        t.task_name,
        t.internal_task_id,
        client.username as client_username,
        tech.username as technician_username,
        u.full_name as sender_name,
        u.user_type as sender_type,
        m.message_text,
        m.message_type,
        m.file_name,
        m.quoted_message_text,
        m.quoted_sender_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN tasks t ON cr.task_id = t.id
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      ${dateFilter}
      ORDER BY m.created_at ASC
    `, queryParams);

    if (format === 'json') {
      res.json({
        success: true,
        messages: result.rows,
        count: result.rows.length
      });
    } else {
      // CSV export
      const csvHeader = 'Timestamp,Room,Task ID,Task Name,Client,Technician,Sender Name,Sender Type,Message,Type,File Name,Quoted Message,Quoted Sender\n';
      const csvRows = result.rows.map(row => {
        return [
          new Date(row.timestamp).toISOString(),
          `"${(row.room_name || '').replace(/"/g, '""')}"`,
          row.internal_task_id,
          `"${(row.task_name || '').replace(/"/g, '""')}"`,
          row.client_username,
          row.technician_username,
          `"${(row.sender_name || '').replace(/"/g, '""')}"`,
          row.sender_type,
          `"${(row.message_text || '').replace(/"/g, '""')}"`,
          row.message_type,
          `"${(row.file_name || '').replace(/"/g, '""')}"`,
          `"${(row.quoted_message_text || '').replace(/"/g, '""')}"`,
          `"${(row.quoted_sender_name || '').replace(/"/g, '""')}"`,
        ].join(',');
      }).join('\n');

      const dateStr = start_date || end_date || new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="chat_export_${dateStr}.csv"`);
      res.send(csvHeader + csvRows);
    }

  } catch (error) {
    console.error('Error exporting messages:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Delete a message (admin only)
router.delete('/messages/:messageId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { messageId } = req.params;
    const pool = getPool(req);

    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 RETURNING *',
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
      deleted_message: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Get tasks (for admin dashboard)
router.get('/tasks', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const pool = getPool(req);
    const offset = (page - 1) * limit;

    let whereClause = '';
    let queryParams = [limit, offset];

    if (search) {
      whereClause = 'WHERE task_name ILIKE $3 OR internal_task_id ILIKE $3 OR description ILIKE $3';
      queryParams = [limit, offset, `%${search}%`];
    }

    const result = await pool.query(`
      SELECT 
        t.*,
        COUNT(cr.id) as chat_rooms_count,
        COUNT(m.id) as total_messages
      FROM tasks t
      LEFT JOIN chat_rooms cr ON t.id = cr.task_id
      LEFT JOIN messages m ON cr.id = m.room_id
      ${whereClause}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `, queryParams);

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM tasks t ${whereClause}
    `, queryParams.slice(2));

    res.json({
      success: true,
      tasks: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});


// Test push notification endpoint
router.post('/test-notification' , async (req, res) => {
  try {
    const { fcmToken, title, body } = req.body;
    
    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    const { sendTestNotification } = require('../services/pushNotification');
    
    const result = await sendTestNotification(fcmToken);
    
    if (result && result.success) {
      res.json({ 
        success: true, 
        message: 'Test notification sent successfully',
        messageId: result.messageId
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to send notification',
        details: result ? result.error : 'Unknown error'
      });
    }

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

module.exports = router;