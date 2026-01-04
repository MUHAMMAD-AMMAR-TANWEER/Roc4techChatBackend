const express = require('express');
const { authenticateToken, requireClientOrTechnician } = require('../middleware/auth');
const router = express.Router();

// Get database pool from app locals
const getPool = (req) => req.app.locals.pool;

// DEBUG ENDPOINT - Check task and room data with user verification
router.get('/debug/task/:task_internal_id/user/:sender_internal_id', async (req, res) => {
  try {
    const { task_internal_id, sender_internal_id } = req.params;
    const pool = getPool(req);

    // Check if sender user exists
    const senderResult = await pool.query(
      'SELECT id, internal_user_id, username, full_name, user_type FROM users WHERE internal_user_id = $1',
      [sender_internal_id]
    );

    // Check if task exists
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE internal_task_id = $1',
      [task_internal_id]
    );

    // Get all rooms for this task with detailed participant info
    const roomsResult = await pool.query(`
      SELECT
        cr.id as room_id,
        cr.room_name,
        cr.client_id,
        cr.technician_id,
        client.id as client_db_id,
        client.internal_user_id as client_internal_id,
        client.username as client_username,
        client.full_name as client_full_name,
        tech.id as tech_db_id,
        tech.internal_user_id as tech_internal_id,
        tech.username as tech_username,
        tech.full_name as tech_full_name,
        t.internal_task_id,
        t.task_name
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE t.internal_task_id = $1
    `, [task_internal_id]);

    // Check if sender is a participant in any room for this task
    let senderParticipation = [];
    if (senderResult.rows.length > 0) {
      const senderDbId = senderResult.rows[0].id;

      senderParticipation = roomsResult.rows.map(room => ({
        room_id: room.room_id,
        room_name: room.room_name,
        is_client: room.client_db_id === senderDbId,
        is_technician: room.tech_db_id === senderDbId,
        is_participant: room.client_db_id === senderDbId || room.tech_db_id === senderDbId
      }));
    }

    res.json({
      task_internal_id: task_internal_id,
      sender_internal_id: sender_internal_id,

      // Sender info
      sender_exists: senderResult.rows.length > 0,
      sender_data: senderResult.rows[0] || null,

      // Task info
      task_exists: taskResult.rows.length > 0,
      task_data: taskResult.rows[0] || null,

      // Rooms info
      rooms_count: roomsResult.rows.length,
      rooms: roomsResult.rows,

      // Sender participation
      sender_participation: senderParticipation,
      can_send_message: senderParticipation.some(p => p.is_participant),

      // Summary
      summary: {
        sender_found: senderResult.rows.length > 0,
        task_found: taskResult.rows.length > 0,
        rooms_found: roomsResult.rows.length,
        sender_in_any_room: senderParticipation.some(p => p.is_participant)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



router.post('/api/send_message_from_odoo', async (req, res) => {
  try {
    const {
      task_internal_id,
      senderInternalId,
      senderName,
      messageText,
      messageType = 'text',
      fileUrl,
      fileName,
      fileSize,
      userType = 'technician',
      source = 'odoo',
      message_id  // 🆕 Optional: message ID from mobile to prevent duplicates
    } = req.body;

    console.log('[ODOO→CHAT] Received:', {
      task_internal_id,
      senderInternalId,
      senderName,
      messageType,
      messageLength: messageText?.length,
      hasFile: !!fileUrl,
      message_id: message_id
    });

    // Validate: Either messageText or fileUrl must be provided
    if (!task_internal_id || !senderInternalId) {
      return res.status(400).json({
        error: 'Missing required fields: task_internal_id, senderInternalId'
      });
    }

    if (!messageText && !fileUrl) {
      return res.status(400).json({
        error: 'Either messageText or fileUrl must be provided'
      });
    }

    const pool = getPool(req);
    const io = req.app.locals.io;

    // 🆕 Check if this message already exists (prevent duplicates from sync loop)
    if (message_id) {
      const existingMessage = await pool.query(
        'SELECT id FROM messages WHERE id = $1',
        [message_id]
      );

      if (existingMessage.rows.length > 0) {
        console.log(`[ODOO→CHAT] ⚠️ Message ${message_id} already exists, skipping duplicate`);
        return res.json({
          success: true,
          message_id: message_id,
          skipped: true,
          reason: 'Message already exists (originated from mobile)'
        });
      }
    }

    // Find chat user by internal ID
    const userResult = await pool.query(
      'SELECT id, user_type FROM users WHERE internal_user_id = $1',
      [senderInternalId.toString()]
    );

    let chatUserId;
    let senderUserType;

    if (userResult.rows.length > 0) {
      chatUserId = userResult.rows[0].id;
      senderUserType = userResult.rows[0].user_type;
      console.log(`[ODOO→CHAT] Found existing user: ${senderInternalId} (${senderUserType})`);
    } else {
      // Create user if doesn't exist - use provided userType or default to 'technician'
      console.log(`[ODOO→CHAT] Creating new user for internal_id ${senderInternalId}`);
      const newUser = await pool.query(`
        INSERT INTO users (internal_user_id, username, full_name, user_type, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id, user_type
      `, [senderInternalId.toString(), senderName, senderName, userType]);
      chatUserId = newUser.rows[0].id;
      senderUserType = newUser.rows[0].user_type;
      console.log(`[ODOO→CHAT] Created new user: ${senderInternalId} (${senderUserType})`);
    }

    // Find the room where the sender is a participant for this task
    console.log(`[ODOO→CHAT] 🔍 Searching for room with task_internal_id: ${task_internal_id}, chatUserId: ${chatUserId}`);

    let room = await pool.query(`
      SELECT
        cr.id,
        cr.client_id,
        cr.technician_id,
        client.internal_user_id as client_internal_id,
        tech.internal_user_id as technician_internal_id,
        t.internal_task_id
      FROM chat_rooms cr
      JOIN users client ON cr.client_id = client.id
      JOIN users tech ON cr.technician_id = tech.id
      JOIN tasks t ON cr.task_id = t.id
      WHERE t.internal_task_id = $1
        AND (cr.client_id = $2 OR cr.technician_id = $2)
      LIMIT 1
    `, [task_internal_id.toString(), chatUserId]);

    console.log(`[ODOO→CHAT] 📊 Room query returned ${room.rows.length} rows`);

    // If sender is not a primary participant, check if any room exists for this task
    if (room.rows.length === 0) {
      console.log(`[ODOO→CHAT] 🔍 Sender not a primary participant. Checking for any room for this task...`);

      const anyRoom = await pool.query(`
        SELECT
          cr.id,
          cr.client_id,
          cr.technician_id,
          client.internal_user_id as client_internal_id,
          tech.internal_user_id as technician_internal_id,
          t.internal_task_id
        FROM chat_rooms cr
        JOIN users client ON cr.client_id = client.id
        JOIN users tech ON cr.technician_id = tech.id
        JOIN tasks t ON cr.task_id = t.id
        WHERE t.internal_task_id = $1
        LIMIT 1
      `, [task_internal_id.toString()]);

      if (anyRoom.rows.length > 0) {
        // Room exists but sender is not a participant - add them as a participant
        const existingRoom = anyRoom.rows[0];
        console.log(`[ODOO→CHAT] ✅ Found room ${existingRoom.id}. Adding sender as participant...`);

        // Add sender as an additional participant (observer role)
        await pool.query(`
          INSERT INTO room_participants (room_id, user_id, role)
          VALUES ($1, $2, 'observer')
          ON CONFLICT (room_id, user_id)
          DO UPDATE SET is_active = true
        `, [existingRoom.id, chatUserId]);

        console.log(`[ODOO→CHAT] ✅ Added sender ${senderInternalId} as observer to room ${existingRoom.id}`);

        // Update room variable to use this room
        room = anyRoom;
      } else {
        // No room exists at all for this task
        console.error(`[ODOO→CHAT] ❌ No room found for task_internal_id: ${task_internal_id}`);
        return res.status(404).json({
          error: 'No chat room exists for this task. Please create a room first.',
          debug: {
            task_internal_id: task_internal_id,
            sender_internal_id: senderInternalId,
            chat_user_id: chatUserId
          }
        });
      }
    }

    const roomData = room.rows[0];
    const roomId = roomData.id;

    console.log(`[ODOO→CHAT] ✅ Found room ${roomId} for task ${task_internal_id}`);

    // Determine receiver
    const receiverChatId = roomData.client_id === chatUserId
      ? roomData.technician_id
      : roomData.client_id;

    const receiverInternalId = roomData.client_id === chatUserId
      ? roomData.technician_internal_id
      : roomData.client_internal_id;

    console.log(`[ODOO→CHAT] 👥 Sender: ${chatUserId} (internal: ${senderInternalId}), Receiver: ${receiverChatId} (internal: ${receiverInternalId})`);
    
    // Save message
    console.log(`[ODOO→CHAT] 💾 Inserting message into database...`);

    const message = await pool.query(`
      INSERT INTO messages (
        room_id,
        sender_id,
        sender_internal_id,
        receiver_id,
        receiver_internal_id,
        message_text,
        message_type,
        file_url,
        file_name,
        file_size,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      roomId,
      chatUserId,
      senderInternalId.toString(),
      receiverChatId,
      receiverInternalId,
      messageText,
      messageType,
      fileUrl,
      fileName,
      fileSize,
      source
    ]);

    console.log(`[ODOO→CHAT] ✅ Message saved with ID: ${message.rows[0].id}`);

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

    console.log(`[ODOO→CHAT] 📡 Broadcasting to room_${roomId} via Socket.IO`);

    // Broadcast via Socket.IO
    io.to(`room_${roomId}`).emit('new_message', fullMessage.rows[0]);

    console.log(`[ODOO→CHAT] ✅ Broadcasted message to Socket.IO room`);
    
    // Send push notification to receiver
    console.log(`[ODOO→CHAT] 🔔 Checking receiver for push notifications (receiverChatId: ${receiverChatId})`);

    const receiverResult = await pool.query(
      'SELECT id, fcm_token, username, is_online FROM users WHERE id = $1',
      [receiverChatId]
    );

    console.log(`[ODOO→CHAT] 📊 Receiver query returned ${receiverResult.rows.length} rows`);

    if (receiverResult.rows.length > 0) {
      const receiver = receiverResult.rows[0];
      console.log(`[ODOO→CHAT] 👤 Receiver: ${receiver.username}, Online: ${receiver.is_online}`);

      if (!receiver.is_online) {
        try {
          const devicesResult = await pool.query(`
           SELECT fcm_token, device_name, id
             FROM user_devices
             WHERE user_id = $1 AND is_active = true AND fcm_token IS NOT NULL
           `, [receiver.id]);

          console.log(`[ODOO→PUSH] 📱 Receiver has ${devicesResult.rows.length} active device(s)`);

          const { sendPushNotification } = require('../services/pushNotification');

          for (const device of devicesResult.rows){
            console.log(`[ODOO→PUSH] 📤 Sending push to device: ${device.device_name || 'Unknown'}`);

            const result = await sendPushNotification(
              device.fcm_token,
              `💬 ${senderName || 'New Message'}`,
              messageText || 'Sent a file',
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
              console.log(`[ODOO→PUSH] 🗑️ Removing invalid token for device ${device.id}`);
              await pool.query(
                'UPDATE user_devices SET is_active = false WHERE id = $1',
                [device.id]
              );
            } else {
              console.log(`[ODOO→PUSH] ✅ Push notification sent successfully to ${device.device_name || 'device'}`);
            }
          }

        } catch (notificationError) {
          console.error(`[ODOO→PUSH] ❌ Failed to send push notification:`, notificationError);
        }
      } else {
        console.log(`[ODOO→PUSH] ⏭️ Skipping push notification - user is online`);
      }
    } else {
      console.log(`[ODOO→PUSH] ⚠️ Receiver not found`);
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
        (SELECT COUNT(*)
         FROM messages m
         WHERE m.room_id = cr.id
         AND m.sender_id != $1
         AND NOT EXISTS (
           SELECT 1 FROM message_reads mr
           WHERE mr.message_id = m.id
           AND mr.user_id = $1
         )) as unread_count
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


// Get chat rooms for specific user (by internal_user_id)
router.get('/rooms/user', async (req, res) => {
  try {
    const { internal_user_id } = req.query;
    const pool = getPool(req);

    // Validate required parameters
    if (!internal_user_id) {
      return res.status(400).json({
        error: 'Missing required parameter: internal_user_id'
      });
    }

    // Get user from internal_user_id (don't require user_type match - observers can see rooms too)
    const userResult = await pool.query(
      'SELECT id, user_type FROM users WHERE internal_user_id = $1 AND is_active = true',
      [internal_user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const userId = userResult.rows[0].id;
    const actualUserType = userResult.rows[0].user_type;

    // Get all chat rooms where user is a participant (client, technician, or additional participant)
    // Query works for all user types including observers
    const roomsQuery = `
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
          WHEN cr.client_id = $1 THEN tech.internal_user_id
          ELSE client.internal_user_id
        END as other_user_internal_id,
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
        (SELECT COUNT(*)
         FROM messages m
         WHERE m.room_id = cr.id
         AND m.sender_id != $1
         AND NOT EXISTS (
           SELECT 1 FROM message_reads mr
           WHERE mr.message_id = m.id
           AND mr.user_id = $1
         )) as unread_count
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

    const roomsResult = await pool.query(roomsQuery, [userId]);

    res.json({
      success: true,
      user_info: {
        internal_user_id: internal_user_id,
        user_type: actualUserType,
        partner_id: userId  // Database user ID (partner_id)
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

    // Mark messages as read for current user (per-user tracking)
    await pool.query(`
      INSERT INTO message_reads (message_id, user_id)
      SELECT id, $2 FROM messages
      WHERE room_id = $1 AND sender_id != $2
      AND NOT EXISTS (
        SELECT 1 FROM message_reads mr
        WHERE mr.message_id = messages.id
        AND mr.user_id = $2
      )
      ON CONFLICT (message_id, user_id) DO NOTHING
    `, [roomId, userId]);

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

    // 🔧 FIX: Use per-user read tracking (message_reads table)
    // Do NOT update the global is_read flag - use message_reads for per-user tracking
    if (message_ids && Array.isArray(message_ids) && message_ids.length > 0) {
      // Mark specific messages as read for THIS user only
      const placeholders = message_ids.map((_, index) => `$${index + 3}`).join(',');

      await pool.query(`
        INSERT INTO message_reads (message_id, user_id)
        SELECT id, $2 FROM messages
        WHERE room_id = $1 AND id IN (${placeholders}) AND sender_id != $2
        ON CONFLICT (message_id, user_id) DO NOTHING
      `, [room_id, userId, ...message_ids]);

    } else {
      // Mark all unread messages in room as read for THIS user only
      await pool.query(`
        INSERT INTO message_reads (message_id, user_id)
        SELECT id, $2 FROM messages
        WHERE room_id = $1 AND sender_id != $2
        AND NOT EXISTS (
          SELECT 1 FROM message_reads mr
          WHERE mr.message_id = messages.id
          AND mr.user_id = $2
        )
        ON CONFLICT (message_id, user_id) DO NOTHING
      `, [room_id, userId]);
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
        AND NOT EXISTS (
          SELECT 1 FROM message_reads mr
          WHERE mr.message_id = m.id
          AND mr.user_id = $1
        )
        AND cr.is_active = true
    `, [userId]);

    // Get unread count per room
    const roomUnreadResult = await pool.query(`
      SELECT
        cr.id as room_id,
        cr.room_name,
        COUNT(m.id) as unread_count
      FROM chat_rooms cr
      LEFT JOIN messages m ON cr.id = m.room_id
        AND m.sender_id != $1
        AND NOT EXISTS (
          SELECT 1 FROM message_reads mr
          WHERE mr.message_id = m.id
          AND mr.user_id = $1
        )
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


// Simple API: Add user to any room for a task (just 2 parameters)
router.post('/rooms/add-user-to-task', async (req, res) => {
  try {
    const {
      task_internal_id,
      user_internal_id,
      role = 'observer'
    } = req.body;

    const pool = getPool(req);

    console.log('[ADD-USER-TO-TASK] Received:', {
      task_internal_id,
      user_internal_id,
      role
    });

    // Validate required fields
    if (!task_internal_id || !user_internal_id) {
      return res.status(400).json({
        error: 'Missing required fields: task_internal_id, user_internal_id'
      });
    }

    // Get the user
    const userResult = await pool.query(
      'SELECT id, username, full_name, user_type FROM users WHERE internal_user_id = $1 AND is_active = true',
      [user_internal_id.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found or inactive',
        user_internal_id: user_internal_id
      });
    }

    const user = userResult.rows[0];

    // Find ANY room for this task
    const roomResult = await pool.query(`
      SELECT
        cr.id,
        cr.room_name,
        cr.client_id,
        cr.technician_id,
        t.internal_task_id,
        t.task_name
      FROM chat_rooms cr
      JOIN tasks t ON cr.task_id = t.id
      WHERE t.internal_task_id = $1
      LIMIT 1
    `, [task_internal_id.toString()]);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No chat room exists for this task',
        task_internal_id: task_internal_id
      });
    }

    const room = roomResult.rows[0];

    // Check if already a primary participant (client or technician)
    if (user.id === room.client_id || user.id === room.technician_id) {
      return res.json({
        success: true,
        message: `User ${user.username} is already a primary participant in this room`,
        already_participant: true,
        room_id: room.id,
        task_internal_id: task_internal_id,
        task_name: room.task_name,
        user: {
          internal_user_id: user_internal_id,
          username: user.username,
          full_name: user.full_name,
          role: user.id === room.client_id ? 'client' : 'technician'
        }
      });
    }

    // Check if already an additional participant
    const existingParticipant = await pool.query(
      'SELECT role FROM room_participants WHERE room_id = $1 AND user_id = $2 AND is_active = true',
      [room.id, user.id]
    );

    if (existingParticipant.rows.length > 0) {
      return res.json({
        success: true,
        message: `User ${user.username} is already a participant in this room`,
        already_participant: true,
        room_id: room.id,
        task_internal_id: task_internal_id,
        task_name: room.task_name,
        user: {
          internal_user_id: user_internal_id,
          username: user.username,
          full_name: user.full_name,
          role: existingParticipant.rows[0].role
        }
      });
    }

    // Add user as an additional participant
    await pool.query(`
      INSERT INTO room_participants (room_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (room_id, user_id)
      DO UPDATE SET is_active = true, role = EXCLUDED.role
    `, [room.id, user.id, role]);

    console.log(`[ADD-USER-TO-TASK] ✅ Added ${user.username} to room ${room.id} (Task: ${task_internal_id})`);

    // Get total participant count
    const participantsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM room_participants
      WHERE room_id = $1 AND is_active = true
    `, [room.id]);

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
          `You've been added to: ${room.room_name}`,
          {
            roomId: String(room.id),
            type: 'added_to_room',
            action: 'open_room',
            task_internal_id: String(task_internal_id)
          }
        );
      } catch (err) {
        console.error('[ADD-USER-TO-TASK] Notification failed:', err);
      }
    }

    res.json({
      success: true,
      message: `${user.username} added to room successfully`,
      already_participant: false,
      room_id: room.id,
      task_internal_id: task_internal_id,
      task_name: room.task_name,
      user: {
        internal_user_id: user_internal_id,
        username: user.username,
        full_name: user.full_name,
        role: role
      },
      total_additional_participants: parseInt(participantsResult.rows[0].count)
    });

  } catch (error) {
    console.error('[ADD-USER-TO-TASK] Error:', error);
    res.status(500).json({ error: 'Failed to add user to task' });
  }
});

// Simple API: Remove user from any room for a task (just 2 parameters)
router.post('/rooms/remove-user-from-task', async (req, res) => {
  try {
    const {
      task_internal_id,
      user_internal_id
    } = req.body;

    const pool = getPool(req);

    console.log('[REMOVE-USER-FROM-TASK] Received:', {
      task_internal_id,
      user_internal_id
    });

    // Validate required fields
    if (!task_internal_id || !user_internal_id) {
      return res.status(400).json({
        error: 'Missing required fields: task_internal_id, user_internal_id'
      });
    }

    // Get the user
    const userResult = await pool.query(
      'SELECT id, username, full_name FROM users WHERE internal_user_id = $1',
      [user_internal_id.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        user_internal_id: user_internal_id
      });
    }

    const user = userResult.rows[0];

    // Find ANY room for this task
    const roomResult = await pool.query(`
      SELECT
        cr.id,
        cr.room_name,
        cr.client_id,
        cr.technician_id,
        t.internal_task_id,
        t.task_name
      FROM chat_rooms cr
      JOIN tasks t ON cr.task_id = t.id
      WHERE t.internal_task_id = $1
      LIMIT 1
    `, [task_internal_id.toString()]);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No chat room exists for this task',
        task_internal_id: task_internal_id
      });
    }

    const room = roomResult.rows[0];

    // Check if user is primary participant (client or technician)
    if (user.id === room.client_id || user.id === room.technician_id) {
      return res.status(400).json({
        error: 'Cannot remove primary participants (client or technician). User is a core member of this room.',
        user_role: user.id === room.client_id ? 'client' : 'technician'
      });
    }

    // Remove participant (soft delete)
    const result = await pool.query(`
      UPDATE room_participants
      SET is_active = false
      WHERE room_id = $1 AND user_id = $2 AND is_active = true
      RETURNING *
    `, [room.id, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User is not a participant in this room',
        user_internal_id: user_internal_id,
        task_internal_id: task_internal_id
      });
    }

    console.log(`[REMOVE-USER-FROM-TASK] ✅ Removed ${user.username} from room ${room.id} (Task: ${task_internal_id})`);

    // Get remaining participant count
    const participantsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM room_participants
      WHERE room_id = $1 AND is_active = true
    `, [room.id]);

    // Notify the removed user
    const { sendPushNotification } = require('../services/pushNotification');
    const devicesResult = await pool.query(
      'SELECT fcm_token, device_name FROM user_devices WHERE user_id = $1 AND is_active = true',
      [user.id]
    );

    for (const device of devicesResult.rows) {
      try {
        await sendPushNotification(
          device.fcm_token,
          '💬 Removed from Chat',
          `You've been removed from: ${room.room_name}`,
          {
            roomId: String(room.id),
            type: 'removed_from_room',
            task_internal_id: String(task_internal_id)
          }
        );
      } catch (err) {
        console.error('[REMOVE-USER-FROM-TASK] Notification failed:', err);
      }
    }

    res.json({
      success: true,
      message: `${user.username} removed from room successfully`,
      room_id: room.id,
      task_internal_id: task_internal_id,
      task_name: room.task_name,
      removed_user: {
        internal_user_id: user_internal_id,
        username: user.username,
        full_name: user.full_name
      },
      remaining_additional_participants: parseInt(participantsResult.rows[0].count)
    });

  } catch (error) {
    console.error('[REMOVE-USER-FROM-TASK] Error:', error);
    res.status(500).json({ error: 'Failed to remove user from task' });
  }
});

// Add participant to room using task_internal_id
router.post('/rooms/participants/add-by-task', async (req, res) => {
  try {
    const {
      task_internal_id,
      client_internal_id,
      technician_internal_id,
      participant_internal_id,
      role = 'observer'
    } = req.body;

    const pool = getPool(req);

    console.log('[ADD-PARTICIPANT] Received:', {
      task_internal_id,
      client_internal_id,
      technician_internal_id,
      participant_internal_id,
      role
    });

    // Validate required fields
    if (!task_internal_id || !participant_internal_id) {
      return res.status(400).json({
        error: 'Missing required fields: task_internal_id, participant_internal_id'
      });
    }

    // At least one of client or technician must be provided to identify the room
    if (!client_internal_id && !technician_internal_id) {
      return res.status(400).json({
        error: 'Either client_internal_id or technician_internal_id must be provided to identify the room'
      });
    }

    // Get the participant user
    const participantResult = await pool.query(
      'SELECT id, username, full_name, user_type FROM users WHERE internal_user_id = $1 AND is_active = true',
      [participant_internal_id.toString()]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Participant user not found or inactive' });
    }

    const participant = participantResult.rows[0];

    // Find the room based on task_internal_id and provided identifiers
    let roomQuery = `
      SELECT
        cr.id,
        cr.room_name,
        cr.client_id,
        cr.technician_id,
        t.internal_task_id,
        t.task_name
      FROM chat_rooms cr
      JOIN tasks t ON cr.task_id = t.id
      WHERE t.internal_task_id = $1
    `;
    const queryParams = [task_internal_id.toString()];

    // Add conditions based on what was provided
    if (client_internal_id && technician_internal_id) {
      // Both provided - find exact room
      roomQuery += `
        AND cr.client_id = (SELECT id FROM users WHERE internal_user_id = $2)
        AND cr.technician_id = (SELECT id FROM users WHERE internal_user_id = $3)
      `;
      queryParams.push(client_internal_id.toString(), technician_internal_id.toString());
    } else if (client_internal_id) {
      // Only client provided - find any room with this client
      roomQuery += `
        AND cr.client_id = (SELECT id FROM users WHERE internal_user_id = $2)
      `;
      queryParams.push(client_internal_id.toString());
      roomQuery += ' LIMIT 1';
    } else {
      // Only technician provided - find any room with this technician
      roomQuery += `
        AND cr.technician_id = (SELECT id FROM users WHERE internal_user_id = $2)
      `;
      queryParams.push(technician_internal_id.toString());
      roomQuery += ' LIMIT 1';
    }

    const roomResult = await pool.query(roomQuery, queryParams);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found for the given task_internal_id and participant identifiers'
      });
    }

    const room = roomResult.rows[0];

    // Check if already a primary participant (client or technician)
    if (participant.id === room.client_id || participant.id === room.technician_id) {
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
    `, [room.id, participant.id, role]);

    console.log(`[ADD-PARTICIPANT] ✅ Added ${participant.username} to room ${room.id} (Task: ${task_internal_id})`);

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
    `, [room.id]);

    // Notify the added user
    const { sendPushNotification } = require('../services/pushNotification');
    const devicesResult = await pool.query(
      'SELECT fcm_token, device_name FROM user_devices WHERE user_id = $1 AND is_active = true',
      [participant.id]
    );

    for (const device of devicesResult.rows) {
      try {
        await sendPushNotification(
          device.fcm_token,
          '💬 Added to Chat',
          `You've been added to: ${room.room_name}`,
          {
            roomId: String(room.id),
            type: 'added_to_room',
            action: 'open_room',
            task_internal_id: String(task_internal_id)
          }
        );
      } catch (err) {
        console.error('[ADD-PARTICIPANT] Notification failed:', err);
      }
    }

    res.json({
      success: true,
      message: `${participant.username} added to room successfully`,
      room_id: room.id,
      task_internal_id: task_internal_id,
      task_name: room.task_name,
      added_participant: {
        internal_user_id: participant_internal_id,
        username: participant.username,
        full_name: participant.full_name,
        role: role
      },
      total_additional_participants: participantsResult.rows.length
    });

  } catch (error) {
    console.error('[ADD-PARTICIPANT] Error:', error);
    res.status(500).json({ error: 'Failed to add participant' });
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