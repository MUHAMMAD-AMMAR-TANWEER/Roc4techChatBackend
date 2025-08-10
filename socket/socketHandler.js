
// const { sendPushNotification } = require('../services/pushNotification');

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
        const accessCheck = await pool.query(
          'SELECT id FROM chat_rooms WHERE id = $1 AND (client_id = $2 OR technician_id = $2)',
          [roomId, socket.userId]
        );

        if (accessCheck.rows.length === 0) {
          return socket.emit('error', { message: 'Access denied to this room' });
        }

        // Validate quoted message if provided
        if (quotedMessageId) {
          const quotedResult = await pool.query(
            'SELECT id FROM messages WHERE id = $1 AND room_id = $2',
            [quotedMessageId, roomId]
          );
          
          if (quotedResult.rows.length === 0) {
            return socket.emit('error', { message: 'Quoted message not found in this room' });
          }
        }

        // Insert message (trigger will populate quoted message details automatically)
        const messageResult = await pool.query(`
          INSERT INTO messages (
            room_id, sender_id, message_text, message_type, 
            file_url, file_name, file_size, quoted_message_id
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
          RETURNING *
        `, [roomId, socket.userId, messageText, messageType, fileUrl, fileName, fileSize, quotedMessageId]);
        
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
        
        // Get room participants for push notifications
        const participantsResult = await pool.query(`
          SELECT u.id, u.fcm_token, u.username, u.is_online 
          FROM chat_rooms cr
          JOIN users u ON (u.id = cr.client_id OR u.id = cr.technician_id)
          WHERE cr.id = $1 AND u.id != $2
        `, [roomId, socket.userId]);
        
        // Send push notifications to offline users
        for (const participant of participantsResult.rows) {
          if (!participant.is_online && participant.fcm_token) {
            try {
              const notificationText = quotedMessageId 
                ? `💬 ${messageText || (messageType === 'image' ? 'Sent an image' : 'Sent a file')}`
                : messageText || (messageType === 'image' ? 'Sent an image' : 'Sent a file');
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
