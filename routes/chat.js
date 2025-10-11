const express = require('express');
const { authenticateToken, requireClientOrTechnician } = require('../middleware/auth');
const router = express.Router();

// Get database pool from app locals
const getPool = (req) => req.app.locals.pool;



router.post('/api/send_message_from_odoo', async (req, res) => {
  try {
    const { 
      roomId,
      senderInternalId,
      senderName, 
      messageText, 
      messageType = 'text',
      userType = 'technician',
      source = 'odoo'
    } = req.body;
    
    console.log('[ODOO→CHAT] Received:', {
      roomId,
      senderInternalId,
      senderName,
      messageLength: messageText?.length
    });
    
    if (!roomId || !senderInternalId || !messageText) {
      return res.status(400).json({ 
        error: 'Missing required fields: roomId, senderInternalId, messageText' 
      });
    }
    
    const pool = getPool(req);
    const io = req.app.locals.io;
    
    // Find chat user by internal ID
    const userResult = await pool.query(
      'SELECT id FROM users WHERE internal_user_id = $1',
      [senderInternalId.toString()]
    );
    
    let chatUserId;
    if (userResult.rows.length > 0) {
      chatUserId = userResult.rows[0].id;
    } else {
      // Create user if doesn't exist
      console.log(`[ODOO→CHAT] Creating user for internal_id ${senderInternalId}`);
      const newUser = await pool.query(`
        INSERT INTO users (internal_user_id, username, full_name, user_type, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id
      `, [senderInternalId.toString(), senderName, senderName, userType]);
      chatUserId = newUser.rows[0].id;
    }
    
    // Get room details
    const room = await pool.query(`
      SELECT 
        cr.id,
        cr.client_id,
        cr.technician_id,
        client.internal_user_id as client_internal_id,
        tech.internal_user_id as technician_internal_id
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      WHERE cr.id = $1
    `, [roomId]);
    
    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const roomData = room.rows[0];
    
    // Determine receiver
    const receiverChatId = roomData.client_id === chatUserId
      ? roomData.technician_id
      : roomData.client_id;
    
    const receiverInternalId = roomData.client_id === chatUserId
      ? roomData.technician_internal_id
      : roomData.client_internal_id;
    
    // Save message
    const message = await pool.query(`
      INSERT INTO messages (
        room_id, 
        sender_id, 
        sender_internal_id,
        receiver_id,
        receiver_internal_id,
        message_text, 
        message_type,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      roomId, 
      chatUserId, 
      senderInternalId.toString(),
      receiverChatId,
      receiverInternalId,
      messageText, 
      messageType,
      source
    ]);
    
    // Get full message with sender details
    const fullMessage = await pool.query(`
      SELECT 
        m.*,
        u.username as sender_username,
        u.full_name as sender_name,
        u.avatar_url as sender_avatar,
        u.user_type as sender_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = $1
    `, [message.rows[0].id]);
    
    // Broadcast via Socket.IO
    io.to(`room_${roomId}`).emit('new_message', fullMessage.rows[0]);
    
    // Send push notification to receiver
    const receiverResult = await pool.query(
      'SELECT id, fcm_token, username, is_online FROM users WHERE id = $1',
      [receiverChatId]
    );
    
    if (receiverResult.rows.length > 0) {
      const receiver = receiverResult.rows[0];
      
      if (!receiver.is_online) {
        try {
          

          const devicesResult = await pool.query(`
           SELECT fcm_token, device_name, id
             FROM user_devices
             WHERE user_id = $1 AND is_active = true AND fcm_token IS NOT NULL
           `, [receiver.id]);
          console.log(`[ODOO→PUSH] Sending to ${devicesResult.rows.length} device(s)`);

      for (const device of devicesResult.rows){


        const { sendPushNotification } = require('../services/pushNotification');

        const result = await sendPushNotification(
          device.fcm_token,
          `💬 ${senderName}`,
          messageText,
          { 
            roomId: String(roomId), 
            messageId: String(message.rows[0].id),
            type: 'new_message',
            senderName: senderName,
            senderId: String(chatUserId),
            source: 'odoo'
          }
        );

        if (result && result.shouldRemoveToken) {
          await pool.query(
            'UPDATE user_devices SET is_active = false WHERE id = $1',
            [device.id]
          );
        }



      }
          
        } catch (notificationError) {
          console.error(`Failed to send push notification:`, notificationError);
        }
      }
    }
    
    console.log(`[ODOO→CHAT] ✅ Message saved and broadcasted to room ${roomId}`);
    
    res.json({ 
      success: true, 
      message_id: message.rows[0].id,
      room_id: roomId
    });
    
  } catch (error) {
    console.error('[ODOO→CHAT] ❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create multiple rooms for task
router.post('/api/chat/rooms/create-for-task', async (req, res) => {
  try {
    const {
      client_internal_id,
      technician_internal_ids,
      task_internal_id,
      admin_internal_id
    } = req.body;

    const pool = getPool(req);

    console.log('[ROOM CREATE] Request:', {
      client_internal_id,
      technician_internal_ids,
      task_internal_id,
      admin_internal_id
    });

    if (!client_internal_id || !technician_internal_ids || !task_internal_id) {
      return res.status(400).json({ 
        error: 'client_internal_id, technician_internal_ids array, and task_internal_id required' 
      });
    }

    if (!Array.isArray(technician_internal_ids)) {
      return res.status(400).json({ error: 'technician_internal_ids must be an array' });
    }

    // Get client
    const clientResult = await pool.query(
      'SELECT id, username, full_name, internal_user_id FROM users WHERE internal_user_id = $1 AND user_type = $2',
      [client_internal_id.toString(), 'client']
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const clientId = clientResult.rows[0].id;

    // Get task
    const taskResult = await pool.query(
      'SELECT id, task_name, internal_task_id FROM tasks WHERE internal_task_id = $1',
      [task_internal_id.toString()]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const taskId = taskResult.rows[0].id;
    const taskName = taskResult.rows[0].task_name;

    const createdRooms = [];
    const failedTechnicians = [];

    // Create room for each technician
    for (const tech_internal_id of technician_internal_ids) {
      try {
        const techResult = await pool.query(
          'SELECT id, username, full_name, internal_user_id, user_type FROM users WHERE internal_user_id = $1',
          [tech_internal_id.toString()]
        );

        if (techResult.rows.length === 0) {
          failedTechnicians.push({ 
            technician_internal_id: tech_internal_id, 
            reason: 'Not found' 
          });
          continue;
        }

        const techId = techResult.rows[0].id;
        const techName = techResult.rows[0].full_name;

        const roomResult = await pool.query(`
          INSERT INTO chat_rooms (
            client_id, 
            technician_id, 
            task_id,
            room_name,
            room_type
          )
          VALUES ($1, $2, $3, $4, 'task_chat')
          ON CONFLICT (client_id, technician_id, task_id)
          DO UPDATE SET 
            updated_at = CURRENT_TIMESTAMP,
            is_active = true
          RETURNING *
        `, [clientId, techId, taskId, `${taskName} - ${techName}`]);

        createdRooms.push({
          room_id: roomResult.rows[0].id,
          technician_name: techName,
          technician_internal_id: tech_internal_id,
          client_name: clientResult.rows[0].full_name
        });

      } catch (error) {
        failedTechnicians.push({ 
          technician_internal_id: tech_internal_id, 
          reason: error.message 
        });
      }
    }

    // Create admin room if provided
    if (admin_internal_id) {
      try {
        const adminResult = await pool.query(
          'SELECT id, username, full_name, internal_user_id FROM users WHERE internal_user_id = $1',
          [admin_internal_id.toString()]
        );

        if (adminResult.rows.length > 0) {
          const adminId = adminResult.rows[0].id;
          const adminName = adminResult.rows[0].full_name;

          const roomResult = await pool.query(`
            INSERT INTO chat_rooms (
              client_id, 
              technician_id, 
              task_id,
              room_name,
              room_type
            )
            VALUES ($1, $2, $3, $4, 'task_chat')
            ON CONFLICT (client_id, technician_id, task_id)
            DO UPDATE SET 
              updated_at = CURRENT_TIMESTAMP,
              is_active = true
            RETURNING *
          `, [clientId, adminId, taskId, `${taskName} - ${adminName} (Admin)`]);

          createdRooms.push({
            room_id: roomResult.rows[0].id,
            technician_name: `${adminName} (Admin)`,
            technician_internal_id: admin_internal_id,
            is_admin: true
          });
        }
      } catch (error) {
        console.error('Failed to create admin room:', error);
      }
    }

    console.log(`[ROOM CREATE] ✅ Created ${createdRooms.length} rooms for task ${task_internal_id}`);

    res.json({
      success: true,
      task_internal_id: task_internal_id,
      task_name: taskName,
      rooms_created: createdRooms.length,
      rooms: createdRooms,
      failed: failedTechnicians
    });

  } catch (error) {
    console.error('[ROOM CREATE] Error:', error);
    res.status(500).json({ error: 'Failed to create task rooms' });
  }
});

// Get rooms grouped by task
router.get('/api/chat/rooms/grouped', async (req, res) => {
  try {
    const { internal_user_id, user_type } = req.query;
    const pool = getPool(req);

    if (!internal_user_id || !user_type) {
      return res.status(400).json({ 
        error: 'internal_user_id and user_type required' 
      });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE internal_user_id = $1 AND user_type = $2',
      [internal_user_id, user_type]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get rooms grouped by task
    const roomsResult = await pool.query(`
      SELECT 
        t.internal_task_id,
        t.task_name,
        json_agg(
          json_build_object(
            'room_id', cr.id,
            'other_user_id', 
              CASE WHEN cr.client_id = $1 THEN cr.technician_id ELSE cr.client_id END,
            'other_user_name',
              CASE WHEN cr.client_id = $1 THEN tech.full_name ELSE client.full_name END,
            'other_user_username',
              CASE WHEN cr.client_id = $1 THEN tech.username ELSE client.username END,
            'other_user_type',
              CASE WHEN cr.client_id = $1 THEN tech.user_type ELSE client.user_type END,
            'other_user_internal_id',
              CASE WHEN cr.client_id = $1 THEN tech.internal_user_id ELSE client.internal_user_id END,
            'other_user_online',
              CASE WHEN cr.client_id = $1 THEN tech.is_online ELSE client.is_online END,
            'unread_count',
              (SELECT COUNT(*) FROM messages 
               WHERE room_id = cr.id AND sender_id != $1 AND is_read = false),
            'last_message',
              (SELECT message_text FROM messages 
               WHERE room_id = cr.id 
               ORDER BY created_at DESC LIMIT 1),
            'last_message_time',
              (SELECT created_at FROM messages 
               WHERE room_id = cr.id 
               ORDER BY created_at DESC LIMIT 1),
            'last_message_sender',
              (SELECT u.username FROM messages m
               JOIN users u ON m.sender_id = u.id
               WHERE m.room_id = cr.id 
               ORDER BY m.created_at DESC LIMIT 1)
          ) ORDER BY cr.created_at
        ) as rooms
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE (cr.client_id = $1 OR cr.technician_id = $1) AND cr.is_active = true
      GROUP BY t.internal_task_id, t.task_name
      ORDER BY MAX(COALESCE(
        (SELECT created_at FROM messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1),
        cr.created_at
      )) DESC
    `, [userId]);

    res.json({
      success: true,
      user_type: user_type,
      tasks_count: roomsResult.rows.length,
      tasks: roomsResult.rows
    });

  } catch (error) {
    console.error('Error fetching grouped rooms:', error);
    res.status(500).json({ error: 'Failed to fetch grouped rooms' });
  }
});

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
// ========== 🔧 UPDATED: Fully backward compatible room creation ==========
router.post('/rooms/create', async (req, res) => {
  try {
    const {
      client_internal_id,
      technician_internal_id,
      task_internal_id,
      additional_participants = []  // 🆕 OPTIONAL - Mobile doesn't need to send this
    } = req.body;

    const pool = getPool(req);

    if (!client_internal_id || !technician_internal_id || !task_internal_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: client_internal_id, technician_internal_id, task_internal_id' 
      });
    }

    console.log('Looking for client with internal_user_id:', client_internal_id);
    console.log('Looking for technician with internal_user_id:', technician_internal_id);

    // Get client
    const clientResult = await pool.query(
      'SELECT id, username, full_name, internal_user_id FROM users WHERE internal_user_id = $1 AND is_active = true',
      [Number(client_internal_id)]
    );

    // Get technician
    const techResult = await pool.query(
      'SELECT id, username, full_name, internal_user_id FROM users WHERE internal_user_id = $1 AND is_active = true',
      [Number(technician_internal_id)]
    );

    // Get task
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

    // ✅ SAME AS BEFORE - Mobile compatibility maintained
    const roomResult = await pool.query(`
      INSERT INTO chat_rooms (client_id, technician_id, task_id, room_name, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (client_id, technician_id, task_id)
      DO UPDATE SET 
        updated_at = CURRENT_TIMESTAMP,
        is_active = true
      RETURNING *
    `, [clientId, technicianId, taskId, `${taskResult.rows[0].task_name} - ${clientResult.rows[0].username} & ${techResult.rows[0].username}`]);

    const room = roomResult.rows[0];

    // 🆕 NEW: Add additional participants (if any) - Mobile doesn't send this, only Odoo does
    if (additional_participants && additional_participants.length > 0) {
      for (const internal_user_id of additional_participants) {
        try {
          // Get user's chat ID
          const userResult = await pool.query(
            'SELECT id FROM users WHERE internal_user_id = $1 AND is_active = true',
            [Number(internal_user_id)]
          );
          
          if (userResult.rows.length > 0) {
            const userId = userResult.rows[0].id;
            
            // Don't add if already client or technician
            if (userId !== clientId && userId !== technicianId) {
              await pool.query(`
                INSERT INTO room_participants (room_id, user_id, role)
                VALUES ($1, $2, 'admin')
                ON CONFLICT (room_id, user_id) DO UPDATE SET is_active = true
              `, [room.id, userId]);
              
              console.log(`[ROOM] Added additional participant: ${internal_user_id}`);
            }
          }
        } catch (err) {
          console.error(`[ROOM] Failed to add participant ${internal_user_id}:`, err);
        }
      }
    }

    // ✅ SAME RESPONSE FORMAT - Mobile compatibility maintained
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
    `, [room.id]);

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
router.get('/rooms', async (req, res) => {
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


// Get chat rooms for specific user (by internal_user_id and user_type)
router.get('/rooms/user', async (req, res) => {
  try {
    const { internal_user_id, user_type } = req.query;
    const pool = getPool(req);

    // Validate required parameters
    if (!internal_user_id || !user_type) {
      return res.status(400).json({ 
        error: 'Missing required parameters: internal_user_id and user_type' 
      });
    }

    // Validate user_type
    if (!['client', 'technician'].includes(user_type)) {
      return res.status(400).json({ 
        error: 'Invalid user_type. Must be: client or technician' 
      });
    }

    // Get user from internal_user_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE internal_user_id = $1 AND user_type = $2 AND is_active = true',
      [internal_user_id, user_type]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const userId = userResult.rows[0].id;

    // Get chat rooms based on user type
    let roomsQuery = '';
    if (user_type === 'client') {
 roomsQuery = `
  SELECT 
    cr.*,
    tech.username as other_user_username,
    tech.full_name as other_user_name,
    tech.internal_user_id as other_user_internal_id,
    tech.avatar_url as other_user_avatar,
    tech.is_online as other_user_online,
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
  WHERE (
    cr.client_id = $1 
    OR cr.technician_id = $1
    OR EXISTS (
      SELECT 1 FROM room_participants rp 
      WHERE rp.room_id = cr.id 
      AND rp.user_id = $1 
      AND rp.is_active = true
    )
  ) 
  AND cr.is_active = true
  ORDER BY COALESCE(cr.last_message_at, cr.created_at) DESC
`;
    } else { // technician
      roomsQuery = `
  SELECT 
    cr.*,
    tech.username as other_user_username,
    tech.full_name as other_user_name,
    tech.internal_user_id as other_user_internal_id,
    tech.avatar_url as other_user_avatar,
    tech.is_online as other_user_online,
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
  WHERE (
    cr.client_id = $1 
    OR cr.technician_id = $1
    OR EXISTS (
      SELECT 1 FROM room_participants rp 
      WHERE rp.room_id = cr.id 
      AND rp.user_id = $1 
      AND rp.is_active = true
    )
  ) 
  AND cr.is_active = true
  ORDER BY COALESCE(cr.last_message_at, cr.created_at) DESC
`;
    }

    const roomsResult = await pool.query(roomsQuery, [userId]);

    res.json({
      success: true,
      user_info: {
        internal_user_id: internal_user_id,
        user_type: user_type
      },
      rooms_count: roomsResult.rows.length,
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
    const userId = req.query.id;
    const offset = (page - 1) * limit;

    // Verify user has access to this room and get room details
    const accessCheck = await pool.query(
      'SELECT id, client_id, technician_id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [roomId, userId]
    );
    
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this chat room' });
    }

    const room = accessCheck.rows[0];

    // Get messages with sender details and receiver ID
    const messagesResult = await pool.query(`
      SELECT 
        m.*,
        u.username as sender_username,
        u.full_name as sender_name,
        u.avatar_url as sender_avatar,
        u.user_type as sender_type,
        CASE 
          WHEN m.sender_id = $4 THEN $5
          ELSE $4
        END as receiver_id
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `, [roomId, limit, offset, room.client_id, room.technician_id]);

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

    // Determine sender and receiver for this conversation
    const senderId = parseInt(userId);
    const receiverId = senderId === room.client_id ? room.technician_id : room.client_id;

    res.json({
      success: true,
      sender_id: senderId,
      receiver_id: receiverId,
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


router.post('/rooms/:roomId/participants/add', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { internal_user_id, role = 'observer' } = req.body;
    
    const pool = getPool(req);

    if (!internal_user_id) {
      return res.status(400).json({ error: 'internal_user_id is required' });
    }

    // Verify room exists
    const roomCheck = await pool.query(
      'SELECT id, room_name FROM chat_rooms WHERE id = $1',
      [roomId]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT id, username, full_name, user_type FROM users WHERE internal_user_id = $1 AND is_active = true',
      [Number(internal_user_id)]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const user = userResult.rows[0];

    // Check if already a primary participant (client or technician)
    const isPrimaryCheck = await pool.query(
      'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [roomId, user.id]
    );

    if (isPrimaryCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'User is already a primary participant (client or technician) in this room' 
      });
    }

    // Add participant
    await pool.query(`
      INSERT INTO room_participants (room_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (room_id, user_id) 
      DO UPDATE SET is_active = true, role = EXCLUDED.role
    `, [roomId, user.id, role]);

    console.log(`[ROOM] ✅ Added ${user.username} to room ${roomId}`);

    // Get updated participant list
    const participantsResult = await pool.query(`
      SELECT 
        u.id,
        u.internal_user_id,
        u.username,
        u.full_name,
        u.user_type,
        rp.role,
        rp.joined_at
      FROM room_participants rp
      JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = $1 AND rp.is_active = true
    `, [roomId]);

    // Notify the added user
    const { sendPushNotification } = require('../services/pushNotification');
    const devicesResult = await pool.query(
      'SELECT fcm_token, device_name FROM user_devices WHERE user_id = $1 AND is_active = true',
      [user.id]
    );

    for (const device of devicesResult.rows) {
      try {
        await sendPushNotification(
          device.fcm_token,
          '💬 Added to Chat',
          `You've been added to: ${roomCheck.rows[0].room_name}`,
          { 
            roomId: String(roomId), 
            type: 'added_to_room',
            action: 'open_room'
          }
        );
      } catch (err) {
        console.error('[ROOM] Notification failed:', err);
      }
    }

    res.json({
      success: true,
      message: `${user.username} added to room successfully`,
      room_id: roomId,
      added_user: {
        internal_user_id: user.internal_user_id,
        username: user.username,
        full_name: user.full_name,
        role: role
      },
      total_additional_participants: participantsResult.rows.length
    });

  } catch (error) {
    console.error('[ROOM] Error adding participant:', error);
    res.status(500).json({ error: 'Failed to add participant' });
  }
});

// ========== 🆕 Remove participant from room ==========
router.delete('/rooms/:roomId/participants/:internal_user_id', async (req, res) => {
  try {
    const { roomId, internal_user_id } = req.params;
    const pool = getPool(req);

    // Get user
    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE internal_user_id = $1',
      [Number(internal_user_id)]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if user is primary participant
    const isPrimaryCheck = await pool.query(
      'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
      [roomId, user.id]
    );

    if (isPrimaryCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot remove primary participants (client or technician). Deactivate the room instead.' 
      });
    }

    // Remove participant (soft delete)
    const result = await pool.query(`
      UPDATE room_participants 
      SET is_active = false 
      WHERE room_id = $1 AND user_id = $2
      RETURNING *
    `, [roomId, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'User is not an additional participant in this room' 
      });
    }

    console.log(`[ROOM] ✅ Removed ${user.username} from room ${roomId}`);

    res.json({
      success: true,
      message: `${user.username} removed from room successfully`,
      room_id: roomId,
      removed_user: {
        internal_user_id: internal_user_id,
        username: user.username
      }
    });

  } catch (error) {
    console.error('[ROOM] Error removing participant:', error);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
});

// ========== 🆕 Get all participants in a room ==========
router.get('/rooms/:roomId/participants', async (req, res) => {
  try {
    const { roomId } = req.params;
    const pool = getPool(req);

    // Verify room exists and get primary participants
    const roomResult = await pool.query(`
      SELECT 
        cr.id,
        cr.room_name,
        cr.client_id,
        cr.technician_id,
        client.internal_user_id as client_internal_id,
        client.username as client_username,
        client.full_name as client_name,
        client.user_type as client_type,
        tech.internal_user_id as tech_internal_id,
        tech.username as tech_username,
        tech.full_name as tech_name,
        tech.user_type as tech_type
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      WHERE cr.id = $1
    `, [roomId]);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    // Get additional participants
    const additionalResult = await pool.query(`
      SELECT 
        u.id,
        u.internal_user_id,
        u.username,
        u.full_name,
        u.user_type,
        rp.role,
        rp.joined_at
      FROM room_participants rp
      JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = $1 AND rp.is_active = true
      ORDER BY rp.joined_at ASC
    `, [roomId]);

    // Build response
    const primaryParticipants = [
      {
        id: room.client_id,
        internal_user_id: room.client_internal_id,
        username: room.client_username,
        full_name: room.client_name,
        user_type: room.client_type,
        role: 'client',
        is_primary: true
      },
      {
        id: room.technician_id,
        internal_user_id: room.tech_internal_id,
        username: room.tech_username,
        full_name: room.tech_name,
        user_type: room.tech_type,
        role: 'technician',
        is_primary: true
      }
    ];

    const additionalParticipants = additionalResult.rows.map(p => ({
      id: p.id,
      internal_user_id: p.internal_user_id,
      username: p.username,
      full_name: p.full_name,
      user_type: p.user_type,
      role: p.role,
      joined_at: p.joined_at,
      is_primary: false
    }));

    res.json({
      success: true,
      room_id: roomId,
      room_name: room.room_name,
      total_participants: primaryParticipants.length + additionalParticipants.length,
      primary_participants: primaryParticipants,
      additional_participants: additionalParticipants,
      all_participants: [...primaryParticipants, ...additionalParticipants]
    });

  } catch (error) {
    console.error('[ROOM] Error getting participants:', error);
    res.status(500).json({ error: 'Failed to get participants' });
  }
});


module.exports = router;