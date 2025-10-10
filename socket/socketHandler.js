
const { sendPushNotification } = require('../services/pushNotification');
const axios = require('axios');
const https = require('https');


const axiosInstance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  })
});

const ODOO_SYNC_CONFIG = {
  enabled: true,
  apiUrl: 'http://127.0.0.1:8069/api/chat/sync_message',
  timeout: 10000
};

// ✅ Session management
let odooSession = null;

async function createOdooSession() {
  try {
    console.log('[ODOO] Creating session...');
    
    const response = await axios.post(
      'http://127.0.0.1:8069/web/session/authenticate',
      {
        jsonrpc: "2.0",
        params: {
          db: "Mobile_api",
          login: "merac",
          password: "123"
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // Extract session from Set-Cookie header
    if (response.headers['set-cookie']) {
      const sessionCookie = response.headers['set-cookie']
        .find(cookie => cookie.startsWith('session_id='));
      
      if (sessionCookie) {
        odooSession = sessionCookie.split(';')[0]; // Get just "session_id=xxx"
        console.log('[ODOO] ✅ Session created');
        return true;
      }
    }
    
    console.error('[ODOO] ❌ No session cookie received');
    return false;
  } catch (error) {
    console.error('[ODOO] ❌ Session creation failed:', error.message);
    return false;
  }
}

// Create session when server starts
createOdooSession();

// Recreate session every 30 minutes (sessions can expire)
setInterval(createOdooSession, 30 * 60 * 1000);




async function syncMessageToOdoo(messageData, pool) {
  if (!ODOO_SYNC_CONFIG.enabled) {
    console.log('[ODOO SYNC] Sync disabled');
    return false;
  }

  if (!odooSession) {
    await createOdooSession();
  }

  try {
    const payload = {
      internal_task_id: parseInt(messageData.room_id),  // ✅ Convert to number
      sender_internal_id: parseInt(messageData.sender_internal_id),  // ✅ Convert to number
      receiver_internal_id: parseInt(messageData.receiver_internal_id),  // ✅ Convert to number
      message_text: messageData.message_text || "File",
      message_type: messageData.message_type,
      timestamp: messageData.created_at,
      message_id: messageData.id,
      sender_name: messageData.sender_name,
      sender_type: messageData.sender_type,
      quoted_message_text: messageData.quoted_message_text,
      quoted_sender_name: messageData.quoted_sender_name,
      file_url: messageData.file_url
    };

    console.log("here is the message data ", messageData)

    console.log('[ODOO SYNC] 📤 Syncing:', payload);
    
    console.log('[ODOO SYNC] 🔗 Calling URL:', ODOO_SYNC_CONFIG.apiUrl);

    const response = await axiosInstance.post(
      ODOO_SYNC_CONFIG.apiUrl,
      payload,
      {
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': odooSession
        },
        timeout: ODOO_SYNC_CONFIG.timeout
      }
    );

    console.log('[ODOO SYNC] 📥 Response:', response.status, response.statusText);

    // Handle JSON-RPC response format
    const result = response.data.result || response.data;
    
    if (result.success) {
      console.log('[ODOO SYNC] ✅ Synced successfully to task', result.task_id);
      
      await pool.query(
        'UPDATE messages SET synced_to_odoo = true, synced_at = CURRENT_TIMESTAMP WHERE id = $1',
        [messageData.id]
      );
      
      return true;
    } else {
      console.error('[ODOO SYNC] ❌ Sync failed:', result.error || 'Unknown error');
      return false;
    }
  } catch (error) {
    if (error.response) {
      // Server responded with error status
      console.error('[ODOO SYNC] ❌ HTTP Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        url: ODOO_SYNC_CONFIG.apiUrl,
        data: JSON.stringify(error.response.data).substring(0, 200)
      });
    } else if (error.request) {
      // No response received
      console.error('[ODOO SYNC] ❌ Network Error:', {
        message: error.message,
        code: error.code,
        url: ODOO_SYNC_CONFIG.apiUrl
      });
    } else {
      // Request setup error
      console.error('[ODOO SYNC] ❌ Error:', error.message);
    }
    return false;
  }
}



module.exports = (io, pool) => {
  // Authentication middleware for socket
  io.use(async (socket, next) => {
    try {
    const userId = socket.handshake.auth.userId;  // ✅ Look for userId
    if (!userId) {
      return next(new Error('No user ID provided')); // ✅ New error message
    }
      
      const userResult = await pool.query(
        'SELECT * FROM users WHERE internal_user_id = $1 AND is_active = true', 
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        return next(new Error('User not found or inactive'));
      }
      
      socket.userId = userResult.rows[0].id;
      socket.user = userResult.rows[0];
      next();
    } catch (err) {
      console.error('Socket authentication error:', err);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`✅ User ${socket.user.username} (${socket.user.user_type}) connected`);
    
    try {
      // Update user online status
      await pool.query(
        'UPDATE users SET is_online = true, last_seen = CURRENT_TIMESTAMP WHERE id = $1',
        [socket.userId]
      );
      
      // Join user to their rooms
      const roomsResult = await pool.query(`
        SELECT cr.id as room_id FROM chat_rooms cr 
        WHERE (cr.client_id = $1 OR cr.technician_id = $1) AND cr.is_active = true
      `, [socket.userId]);
      
      roomsResult.rows.forEach(room => {
        socket.join(`room_${room.room_id}`);
        console.log(`📍 User ${socket.user.username} joined room_${room.room_id}`);
      });

      // Emit user online status to their rooms
      roomsResult.rows.forEach(room => {
        socket.to(`room_${room.room_id}`).emit('user_online', {
          userId: socket.userId,
          username: socket.user.username
        });
      });

    } catch (error) {
      console.error('Error during socket connection setup:', error);
    }

    // Handle joining specific room
    socket.on('join_room', async (data) => {
      try {
        const { roomId } = data;
        
        if (!roomId) {
          return socket.emit('error', { message: 'Room ID is required' });
        }

        // Verify user has access to this room
        const accessCheck = await pool.query(
          'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
          [roomId, socket.userId]
        );

        console.log(`🔍 Access check result: ${accessCheck.rows.length} rows found`);

        if (accessCheck.rows.length === 0) {
          return socket.emit('error', { message: 'Access denied to this room' });
        }

        socket.join(`room_${roomId}`);
        
        // Get room details
        const roomResult = await pool.query(`
          SELECT 
            cr.*,
            client.username as client_username,
            client.full_name as client_name,
            client.internal_user_id as client_internal_id,
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

        socket.emit('room_joined', {
          room: roomResult.rows[0]
        });

        // Load recent messages
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
          LIMIT 50
        `, [roomId]);
        
        socket.emit('recent_messages', messagesResult.rows.reverse());
        
        console.log(`📨 User ${socket.user.username} joined room ${roomId}`);
        
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
    try {
        const { 
          roomId, 
          messageText, 
          messageType = 'text', 
          fileUrl, 
          fileName, 
          fileSize, 
          quotedMessageId 
        } = data;

        if (!roomId) {
          return socket.emit('error', { message: 'Room ID is required' });
        }

        // Verify user has access to this room
        const accessCheck = await pool.query(`
          SELECT 
            cr.id,
            cr.client_id,
            cr.technician_id,
            cr.task_id,
            client.internal_user_id as client_internal_id,
            tech.internal_user_id as technician_internal_id,
            t.internal_task_id
          FROM chat_rooms cr
          JOIN users client ON cr.client_id = client.id
          JOIN users tech ON cr.technician_id = tech.id
          JOIN tasks t ON cr.task_id = t.id
          WHERE cr.id = $1 AND (cr.client_id = $2 OR cr.technician_id = $2)
        `, [roomId, socket.userId]);

        if (accessCheck.rows.length === 0) {
          return socket.emit('error', { message: 'Access denied to this room' });
        }

        const room = accessCheck.rows[0];


        // Extract internal IDs from room
        const senderInternalId = socket.user.internal_user_id;
        const receiverChatId = room.client_id === socket.userId 
          ? room.technician_id 
          : room.client_id;
        
        const receiverInternalId = room.client_id === socket.userId
          ? room.technician_internal_id
          : room.client_internal_id;

        console.log('[MESSAGE] 📝 IDs:', {
          sender_chat_id: socket.userId,
          sender_internal_id: senderInternalId,
          receiver_chat_id: receiverChatId,
          receiver_internal_id: receiverInternalId,
          task_internal_id: room.internal_task_id
        });

        // Validate quoted message if provided
        let quotedMessageText = null;
        let quotedSenderName = null;

        if (quotedMessageId) {
          const quotedResult = await pool.query(`
            SELECT m.message_text, u.full_name 
            FROM messages m 
            JOIN users u ON m.sender_id = u.id 
            WHERE m.id = $1 AND m.room_id = $2
          `, [quotedMessageId, roomId]);
          
          if (quotedResult.rows.length === 0) {
            return socket.emit('error', { message: 'Quoted message not found in this room' });
          }

          quotedMessageText = quotedResult.rows[0].message_text;
          quotedSenderName = quotedResult.rows[0].full_name;
        }

        console.log("Debugging values: ",roomId, 
          socket.userId, 
          senderInternalId,
          receiverChatId,
          receiverInternalId,
          messageText, 
          messageType, 
          fileUrl, 
          fileName, 
          fileSize, 
          quotedMessageId,
          quotedMessageText,
          quotedSenderName)

        // Insert message (trigger will populate quoted message details automatically)
        const messageResult = await pool.query(`
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
            quoted_message_id,
            quoted_message_text,
            quoted_sender_name
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
          RETURNING *
        `, [
          roomId, 
          socket.userId, 
          senderInternalId,
          receiverChatId,
          receiverInternalId,
          messageText, 
          messageType, 
          fileUrl, 
          fileName, 
          fileSize, 
          quotedMessageId,
          quotedMessageText,
          quotedSenderName
        ]);
        
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
        
        const fullMessage = fullMessageResult.rows[0];
        
        // Broadcast to room
        io.to(`room_${roomId}`).emit('new_message', fullMessage);

                // SYNC TO ODOO (non-blocking)

         syncMessageToOdoo({
          id: fullMessage.id,
          room_id: room.internal_task_id,
          sender_id: socket.userId,
          sender_internal_id: senderInternalId,
          receiver_id: receiverChatId,
          receiver_internal_id: receiverInternalId,
          message_text: messageText,
          message_type: messageType,
          sender_name: socket.user.full_name || socket.user.username,
          sender_type: socket.user.user_type,
          quoted_message_text: quotedMessageText,
          quoted_sender_name: quotedSenderName,
          created_at: fullMessage.created_at,
          file_url:fileUrl
        }, pool).catch(err => {
          console.error('[ODOO SYNC] Failed but continuing:', err.message);
        });
        
        console.log("Going to push notifications: ")
        
        // Get room participants for push notifications
          const participantsResult = await pool.query(`
            SELECT 
              u.id, 
              u.username, 
              u.full_name,
              u.is_online,
              u.user_type
            FROM chat_rooms cr
            JOIN users u ON (u.id = cr.client_id OR u.id = cr.technician_id)
            WHERE cr.id = $1 AND u.id != $2
          `, [roomId, socket.userId]);
      
        console.log(`[PUSH] Found ${participantsResult.rows.length} participant(s)`);
        console.log(participantsResult.rows)
        
        // Send push notifications to offline users
        for (const participant of participantsResult.rows) {
          console.log()
          if (!participant.is_online) {
            try {


                         const devicesResult = await pool.query(`
                      SELECT id, fcm_token, device_name, device_type
                      FROM user_devices
                      WHERE user_id = $1 AND is_active = true AND fcm_token IS NOT NULL
                    `, [participant.id]);
                        
                    console.log(`[PUSH] User ${participant.username} has ${devicesResult.rows.length} active device(s)`);
                        
                    if (devicesResult.rows.length === 0) {
                      console.log(`[PUSH] ⚠️ User ${participant.username} has no active devices`);
                      continue;
                    }
              for (const device of devicesResult.rows) {
            try {
              const notificationTitle = `💬 ${socket.user.full_name || socket.user.username}`;
              const notificationBody = quotedMessageId 
                ? `💬 ${messageText || (messageType === 'image' ? 'Sent an image' : 'Sent a file')}`
                : messageText || (messageType === 'image' ? 'Sent an image' : 'Sent a file');

              console.log(`[PUSH] 📤 Sending to device: ${device.device_name || 'Unknown'} (${device.device_type || 'unknown'})`);

              const result = await sendPushNotification(
                device.fcm_token,
                notificationTitle,
                notificationBody,
                { 
                  roomId: String(roomId), 
                  messageId: String(message.id),
                  type: 'new_message',
                  senderName: socket.user.username,
                  senderId: String(socket.userId)
                }
              );

              // If token is invalid, mark THIS device as inactive
              if (result && result.shouldRemoveToken) {
                await pool.query(
                  'UPDATE user_devices SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                  [device.id]
                );
                console.log(`🗑️ Marked device ${device.device_name || device.id} as inactive for user ${participant.username}`);
              } else {
                console.log(`[PUSH] ✅ Sent to ${device.device_name || 'device'}`);
              }

            } catch (deviceError) {
              console.error(`[PUSH] ❌ Failed to send to device ${device.device_name || device.id}:`, deviceError.message);
              // Continue to next device even if one fails
            }
          }
                /** 
              await sendPushNotification(
                participant.fcm_token,
                `${socket.user.username}`,
                notificationText,
                { 
                  roomId: String(roomId), 
                  messageId: String(message.id),
                  type: 'new_message',
                  senderName: socket.user.username
                }
              ); */

            } catch (notificationError) {
              console.error(`Failed to send notification to ${participant.username}:`, notificationError);
            }
          }
        }
        
        console.log(`💬 Message sent in room ${roomId} by ${socket.user.username}`);
        
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle message read status
    socket.on('mark_messages_read', async (data) => {
      try {
        const { roomId, messageIds } = data;
        
        if (!roomId) {
          return socket.emit('error', { message: 'Room ID is required' });
        }

        // Verify access to room
        const accessCheck = await pool.query(
          'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
          [roomId, socket.userId]
        );

        if (accessCheck.rows.length === 0) {
          return socket.emit('error', { message: 'Access denied to this room' });
        }

        if (messageIds && Array.isArray(messageIds)) {
          // Mark specific messages as read
          const placeholders = messageIds.map((_, index) => `${index + 3}`).join(',');
          
          await pool.query(`
            INSERT INTO message_reads (message_id, user_id)
            SELECT id, $2 FROM messages 
            WHERE room_id = $1 AND id IN (${placeholders}) AND sender_id != $2
            ON CONFLICT (message_id, user_id) DO NOTHING
          `, [roomId, socket.userId, ...messageIds]);

          await pool.query(`
            UPDATE messages 
            SET is_read = true 
            WHERE room_id = $1 AND id IN (${placeholders}) AND sender_id != $2
          `, [roomId, socket.userId, ...messageIds]);
        } else {
          // Mark all unread messages as read
          await pool.query(`
            INSERT INTO message_reads (message_id, user_id)
            SELECT id, $2 FROM messages 
            WHERE room_id = $1 AND sender_id != $2 AND is_read = false
            ON CONFLICT (message_id, user_id) DO NOTHING
          `, [roomId, socket.userId]);

          await pool.query(
            'UPDATE messages SET is_read = true WHERE room_id = $1 AND sender_id != $2',
            [roomId, socket.userId]
          );
        }
        
        // Broadcast read status to room
        socket.to(`room_${roomId}`).emit('messages_read', {
          userId: socket.userId,
          username: socket.user.username,
          messageIds: messageIds
        });
        
      } catch (error) {
        console.error('Error marking messages as read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });


    // Handle loading previous messages (pagination)
    socket.on('load_previous_messages', async (data) => {
      try {
        const { roomId, page = 1, limit = 20, beforeMessageId } = data;
        
        if (!roomId) {
          return socket.emit('error', { message: 'Room ID is required' });
        }

        // Verify user has access to this room
        const accessCheck = await pool.query(
          'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
          [roomId, socket.userId]
        );

        if (accessCheck.rows.length === 0) {
          return socket.emit('error', { message: 'Access denied to this room' });
        }

        let query, params;
        
        if (beforeMessageId) {
          // Load messages before a specific message ID (more precise pagination)
          query = `
            SELECT 
              m.*,
              u.username as sender_username,
              u.full_name as sender_name,
              u.avatar_url as sender_avatar,
              u.user_type as sender_type
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.room_id = $1 AND m.id < $2
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $3
          `;
          params = [roomId, beforeMessageId, limit];
        } else {
          // Load messages by page number
          const offset = (page - 1) * limit;
          query = `
            SELECT 
              m.*,
              u.username as sender_username,
              u.full_name as sender_name,
              u.avatar_url as sender_avatar,
              u.user_type as sender_type
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.room_id = $1
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $2 OFFSET $3
          `;
          params = [roomId, limit, offset];
        }

        const messagesResult = await pool.query(query, params);
        
        // Get total message count for this room
        const countResult = await pool.query(
          'SELECT COUNT(*) FROM messages WHERE room_id = $1',
          [roomId]
        );

        const totalMessages = parseInt(countResult.rows[0].count);
        const hasMore = beforeMessageId 
          ? messagesResult.rows.length === limit // If we got full limit, likely more exist
          : (page * limit) < totalMessages;

        // Reverse messages to show chronological order (oldest first)
        const messages = messagesResult.rows.reverse();

        // Emit the previous messages back to the requesting socket
        socket.emit('previous_messages', {
          roomId: roomId,
          messages: messages,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalMessages,
            hasMore: hasMore,
            beforeMessageId: beforeMessageId
          }
        });

        console.log(`📚 Loaded ${messages.length} previous messages for room ${roomId}, page ${page}`);
        
      } catch (error) {
        console.error('Error loading previous messages:', error);
        socket.emit('error', { message: 'Failed to load previous messages' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.to(`room_${roomId}`).emit('user_typing', {
          userId: socket.userId,
          username: socket.user.username,
          roomId: roomId
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.to(`room_${roomId}`).emit('user_stopped_typing', {
          userId: socket.userId,
          roomId: roomId
        });
      }
    });

    // Handle getting message for quote
    socket.on('get_message_for_quote', async (data) => {
      try {
        const { messageId, roomId } = data;
        
        const result = await pool.query(`
          SELECT 
            m.id,
            m.message_text,
            m.message_type,
            m.file_name,
            u.username as sender_name,
            u.full_name as sender_full_name
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.id = $1 AND m.room_id = $2
        `, [messageId, roomId]);
        
        if (result.rows.length === 0) {
          return socket.emit('error', { message: 'Message not found' });
        }
        
        socket.emit('message_for_quote', result.rows[0]);
        
      } catch (error) {
        console.error('Error getting message for quote:', error);
        socket.emit('error', { message: 'Failed to get message details' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      try {
        console.log(`❌ User ${socket.user.username} disconnected`);
        
        // Update user offline status
        await pool.query(
          'UPDATE users SET is_online = false, last_seen = CURRENT_TIMESTAMP WHERE id = $1',
          [socket.userId]
        );
        
        // Get user's rooms to emit offline status
        const roomsResult = await pool.query(`
          SELECT cr.id as room_id FROM chat_rooms cr 
          WHERE (cr.client_id = $1 OR cr.technician_id = $1) AND cr.is_active = true
        `, [socket.userId]);
        
        // Emit user offline status to their rooms
        roomsResult.rows.forEach(room => {
          socket.to(`room_${room.room_id}`).emit('user_offline', {
            userId: socket.userId,
            username: socket.user.username
          });
        });
        
      } catch (error) {
        console.error('Error during disconnect:', error);
      }
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error(`Socket error for user ${socket.user?.username}:`, error);
    });
  });
};
