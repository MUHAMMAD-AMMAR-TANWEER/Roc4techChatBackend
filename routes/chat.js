const express = require('express');
const { authenticateToken, requireClientOrTechnician } = require('../middleware/auth');
const router = express.Router();

// Get database pool from app locals
const getPool = (req) => req.app.locals.pool;

// Sync/Create task from your system
router.post('/tasks/sync', async (req, res) => {
  try {
    const {
      internal_task_id,
      task_name,
      description,
      external_data = {}
    } = req.body;

    const pool = getPool(req);

    if (!internal_task_id || !task_name) {
      return res.status(400).json({ 
        error: 'Missing required fields: internal_task_id, task_name' 
      });
    }

    const result = await pool.query(`
      INSERT INTO tasks (internal_task_id, task_name, description, external_data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (internal_task_id)
      DO UPDATE SET
        task_name = EXCLUDED.task_name,
        description = EXCLUDED.description,
        external_data = EXCLUDED.external_data
      RETURNING *
    `, [internal_task_id, task_name, description, JSON.stringify(external_data)]);

    res.json({
      success: true,
      task: result.rows[0],
      message: 'Task synced successfully'
    });

  } catch (error) {
    console.error('Error syncing task:', error);
    res.status(500).json({ error: 'Failed to sync task' });
  }
});

// Bulk sync tasks
router.post('/tasks/bulk-sync', async (req, res) => {
  try {
    const { tasks } = req.body;
    const pool = getPool(req);

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array is required' });
    }

    const results = [];
    const errors = [];

    for (const taskData of tasks) {
      try {
        const {
          internal_task_id,
          task_name,
          description,
          external_data = {}
        } = taskData;

        if (!internal_task_id || !task_name) {
          errors.push({
            task: taskData,
            error: 'Missing required fields: internal_task_id, task_name'
          });
          continue;
        }

        const result = await pool.query(`
          INSERT INTO tasks (internal_task_id, task_name, description, external_data)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (internal_task_id)
          DO UPDATE SET
            task_name = EXCLUDED.task_name,
            description = EXCLUDED.description,
            external_data = EXCLUDED.external_data
          RETURNING id, internal_task_id, task_name
        `, [internal_task_id, task_name, description, JSON.stringify(external_data)]);

        results.push(result.rows[0]);

      } catch (error) {
        errors.push({
          task: taskData,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      synced_count: results.length,
      error_count: errors.length,
      synced_tasks: results,
      errors: errors
    });

  } catch (error) {
    console.error('Error bulk syncing tasks:', error);
    res.status(500).json({ error: 'Failed to bulk sync tasks' });
  }
});

// Get task by internal ID
router.get('/tasks/:internal_task_id', async (req, res) => {
  try {
    const { internal_task_id } = req.params;
    const pool = getPool(req);

    const result = await pool.query(
      'SELECT * FROM tasks WHERE internal_task_id = $1',
      [internal_task_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      success: true,
      task: result.rows[0]
    });

  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Create or get chat room using internal IDs
router.post('/rooms/create', async (req, res) => {
  try {
    const {
      client_internal_id,
      technician_internal_id,
      task_internal_id
    } = req.body;

    const pool = getPool(req);

    if (!client_internal_id || !technician_internal_id || !task_internal_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: client_internal_id, technician_internal_id, task_internal_id' 
      });
    }

    // Get internal IDs converted to our database IDs
    const clientResult = await pool.query(
      'SELECT id, username, full_name FROM users WHERE internal_user_id = $1 AND user_type = $2 AND is_active = true',
      [client_internal_id, 'client']
    );

    const techResult = await pool.query(
      'SELECT id, username, full_name FROM users WHERE internal_user_id = $1 AND user_type = $2 AND is_active = true',
      [technician_internal_id, 'technician']
    );

    const taskResult = await pool.query(
      'SELECT id, task_name FROM tasks WHERE internal_task_id = $1',
      [task_internal_id]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found or not active' });
    }
    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found or not active' });
    }
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const clientId = clientResult.rows[0].id;
    const technicianId = techResult.rows[0].id;
    const taskId = taskResult.rows[0].id;

    // Create or get existing room
    const roomResult = await pool.query(`
      INSERT INTO chat_rooms (client_id, technician_id, task_id, room_name, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (client_id, technician_id, task_id)
      DO UPDATE SET 
        updated_at = CURRENT_TIMESTAMP,
        is_active = true
      RETURNING *
    `, [clientId, technicianId, taskId, `${taskResult.rows[0].task_name} - ${clientResult.rows[0].username} & ${techResult.rows[0].username}`]);

    // Get room with user and task details
    const roomDetailsResult = await pool.query(`
      SELECT 
        cr.*,
        client.username as client_username,
        client.full_name as client_name,
        client.internal_user_id as client_internal_id,
        tech.username as technician_username,
        tech.full_name as technician_name,
        tech.internal_user_id as technician_internal_id,
        t.task_name,
        t.internal_task_id
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE cr.id = $1
    `, [roomResult.rows[0].id]);

    res.json({
      success: true,
      room: roomDetailsResult.rows[0],
      message: 'Chat room created/retrieved successfully'
    });

  } catch (error) {
    console.error('Error creating chat room:', error);
    res.status(500).json({ error: 'Failed to create chat room' });
  }
});

// Get user's chat rooms
router.get('/rooms', requireClientOrTechnician, async (req, res) => {
  try {
    const pool = getPool(req);
    const userId = req.user.id;

    const roomsResult = await pool.query(`
      SELECT 
        cr.*,
        CASE 
          WHEN cr.client_id = $1 THEN tech.username
          ELSE client.username
        END as other_user_username,
        CASE 
          WHEN cr.client_id = $1 THEN tech.full_name
          ELSE client.full_name
        END as other_user_name,
        CASE 
          WHEN cr.client_id = $1 THEN tech.avatar_url
          ELSE client.avatar_url
        END as other_user_avatar,
        CASE 
          WHEN cr.client_id = $1 THEN tech.is_online
          ELSE client.is_online
        END as other_user_online,
        t.task_name,
        t.internal_task_id,
        latest_msg.message_text as last_message,
        latest_msg.message_type as last_message_type,
        latest_msg.created_at as last_message_time,
        latest_msg.sender_id as last_message_sender_id,
        (SELECT COUNT(*) FROM messages WHERE room_id = cr.id AND sender_id != $1 AND is_read = false) as unread_count
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      LEFT JOIN LATERAL (
        SELECT message_text, message_type, created_at, sender_id
        FROM messages 
        WHERE room_id = cr.id 
        ORDER BY created_at DESC 
        LIMIT 1
      ) latest_msg ON true
      WHERE (cr.client_id = $1 OR cr.technician_id = $1) AND cr.is_active = true
      ORDER BY COALESCE(cr.last_message_at, cr.created_at) DESC
    `, [userId]);

    res.json({
      success: true,
      rooms: roomsResult.rows
    });

  } catch (error) {
    console.error('Error fetching user rooms:', error);
    res.status(500).json({ error: 'Failed to fetch chat rooms' });
  }
});

// Get messages for a specific room
router.get('/rooms/:roomId/messages', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pool = getPool(req);
    const userId = `${req.query.id}`;
    const offset = (page - 1) * limit;

    // Verify user has access to this room
    const accessCheck = await pool.query(
      'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [roomId, userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this chat room' });
    }

    // Get messages with sender details
    const messagesResult = await pool.query(`
      SELECT 
        m.*,
        u.username as sender_username,
        u.full_name as sender_name,
        u.avatar_url as sender_avatar,
        u.user_type as sender_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `, [roomId, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE room_id = $1',
      [roomId]
    );

    // Mark messages as read for current user
    await pool.query(`
      INSERT INTO message_reads (message_id, user_id)
      SELECT id, $2 FROM messages 
      WHERE room_id = $1 AND sender_id != $2 AND is_read = false
      ON CONFLICT (message_id, user_id) DO NOTHING
    `, [roomId, userId]);

    // Update messages as read
    await pool.query(
      'UPDATE messages SET is_read = true WHERE room_id = $1 AND sender_id != $2',
      [roomId, userId]
    );

    res.json({
      success: true,
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

// Send a message
router.post('/messages', requireClientOrTechnician, async (req, res) => {
  try {
    const {
      room_id,
      message_text,
      message_type = 'text',
      file_url,
      file_name,
      file_size,
      quoted_message_id
    } = req.body;

    const pool = getPool(req);
    const userId = req.user.id;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    // Verify user has access to this room
    const accessCheck = await pool.query(
      'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [room_id, userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this chat room' });
    }

    // Validate quoted message if provided
    if (quoted_message_id) {
      const quotedResult = await pool.query(
        'SELECT id FROM messages WHERE id = $1 AND room_id = $2',
        [quoted_message_id, room_id]
      );

      if (quotedResult.rows.length === 0) {
        return res.status(404).json({ error: 'Quoted message not found in this room' });
      }
    }

    // Insert message
    const messageResult = await pool.query(`
      INSERT INTO messages (
        room_id, sender_id, message_text, message_type, 
        file_url, file_name, file_size, quoted_message_id
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `, [room_id, userId, message_text, message_type, file_url, file_name, file_size, quoted_message_id]);

    const message = messageResult.rows[0];

    // Get full message details with sender info
    const fullMessageResult = await pool.query(`
      SELECT 
        m.*,
        u.username as sender_username,
        u.full_name as sender_name,
        u.avatar_url as sender_avatar,
        u.user_type as sender_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = $1
    `, [message.id]);

    res.json({
      success: true,
      message: fullMessageResult.rows[0]
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get message details for quoting
router.get('/messages/:messageId/quote', requireClientOrTechnician, async (req, res) => {
  try {
    const { messageId } = req.params;
    const pool = getPool(req);
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT 
        m.id,
        m.message_text,
        m.message_type,
        m.file_name,
        m.room_id,
        u.username as sender_name,
        u.full_name as sender_full_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN chat_rooms cr ON m.room_id = cr.id
      WHERE m.id = $1 AND (cr.client_id = $2 OR cr.technician_id = $2)
    `, [messageId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or access denied' });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });

  } catch (error) {
    console.error('Error getting message for quote:', error);
    res.status(500).json({ error: 'Failed to get message details' });
  }
});

// Mark messages as read
router.post('/messages/read', requireClientOrTechnician, async (req, res) => {
  try {
    const { room_id, message_ids } = req.body;
    const pool = getPool(req);
    const userId = req.user.id;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    // Verify user has access to this room
    const accessCheck = await pool.query(
      'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [room_id, userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this chat room' });
    }

    if (message_ids && Array.isArray(message_ids) && message_ids.length > 0) {
      // Mark specific messages as read
      const placeholders = message_ids.map((_, index) => `${index + 3}`).join(',');
      
      await pool.query(`
        INSERT INTO message_reads (message_id, user_id)
        SELECT id, $2 FROM messages 
        WHERE room_id = $1 AND id IN (${placeholders}) AND sender_id != $2
        ON CONFLICT (message_id, user_id) DO NOTHING
      `, [room_id, userId, ...message_ids]);

      await pool.query(`
        UPDATE messages 
        SET is_read = true 
        WHERE room_id = $1 AND id IN (${placeholders}) AND sender_id != $2
      `, [room_id, userId, ...message_ids]);

    } else {
      // Mark all unread messages in room as read
      await pool.query(`
        INSERT INTO message_reads (message_id, user_id)
        SELECT id, $2 FROM messages 
        WHERE room_id = $1 AND sender_id != $2 AND is_read = false
        ON CONFLICT (message_id, user_id) DO NOTHING
      `, [room_id, userId]);

      await pool.query(
        'UPDATE messages SET is_read = true WHERE room_id = $1 AND sender_id != $2',
        [room_id, userId]
      );
    }

    res.json({
      success: true,
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Get unread message count for user
router.get('/unread-count', requireClientOrTechnician, async (req, res) => {
  try {
    const pool = getPool(req);
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_unread,
        COUNT(DISTINCT m.room_id) as rooms_with_unread
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      WHERE (cr.client_id = $1 OR cr.technician_id = $1) 
        AND m.sender_id != $1 
        AND m.is_read = false
        AND cr.is_active = true
    `, [userId]);

    // Get unread count per room
    const roomUnreadResult = await pool.query(`
      SELECT 
        cr.id as room_id,
        cr.room_name,
        COUNT(m.id) as unread_count
      FROM chat_rooms cr
      LEFT JOIN messages m ON cr.id = m.room_id AND m.sender_id != $1 AND m.is_read = false
      WHERE (cr.client_id = $1 OR cr.technician_id = $1) AND cr.is_active = true
      GROUP BY cr.id, cr.room_name
      HAVING COUNT(m.id) > 0
      ORDER BY unread_count DESC
    `, [userId]);

    res.json({
      success: true,
      total_unread: parseInt(result.rows[0].total_unread),
      rooms_with_unread: parseInt(result.rows[0].rooms_with_unread),
      unread_by_room: roomUnreadResult.rows
    });

  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Search messages in user's rooms
router.get('/search', requireClientOrTechnician, async (req, res) => {
  try {
    const { query, room_id, message_type, start_date, end_date, page = 1, limit = 20 } = req.query;
    const pool = getPool(req);
    const userId = req.user.id;
    const offset = (page - 1) * limit;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    let whereConditions = [
      '(cr.client_id = $1 OR cr.technician_id = $1)',
      'm.message_text ILIKE $2'
    ];
    let queryParams = [userId, `%${query}%`];
    let paramCount = 2;

    if (room_id) {
      paramCount++;
      whereConditions.push(`m.room_id = ${paramCount}`);
      queryParams.push(room_id);
    }

    if (message_type) {
      paramCount++;
      whereConditions.push(`m.message_type = ${paramCount}`);
      queryParams.push(message_type);
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

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    paramCount++;
    queryParams.push(limit);
    paramCount++;
    queryParams.push(offset);

    const searchResult = await pool.query(`
      SELECT 
        m.*,
        u.username as sender_username,
        u.full_name as sender_name,
        cr.room_name,
        t.task_name
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN users u ON m.sender_id = u.id
      JOIN tasks t ON cr.task_id = t.id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ${paramCount-1} OFFSET ${paramCount}
    `, queryParams);

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
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

module.exports = router;