const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Get database pool from app locals
const getPool = (req) => req.app.locals.pool;

// Sync/Create user from your system
router.post('/sync', async (req, res) => {
  try {
    const {
      internal_user_id,
      username,
      user_type,
      full_name,
      email,
      avatar_url,
      is_active = true,
      external_data = {}
    } = req.body;

    const pool = getPool(req);

    // Validate required fields
    if (!internal_user_id || !username || !user_type) {
      return res.status(400).json({ 
        error: 'Missing required fields: internal_user_id, username, user_type' 
      });
    }

    // Validate user_type
    if (!['client', 'technician', 'admin'].includes(user_type)) {
      return res.status(400).json({ 
        error: 'Invalid user_type. Must be: client, technician, or admin' 
      });
    }

    // Insert or update user
    const result = await pool.query(`
      INSERT INTO users (
        internal_user_id, username, user_type, full_name, email, 
        avatar_url, is_active, external_data, updated_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (internal_user_id) 
      DO UPDATE SET
        username = EXCLUDED.username,
        user_type = EXCLUDED.user_type,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        avatar_url = EXCLUDED.avatar_url,
        is_active = EXCLUDED.is_active,
        external_data = EXCLUDED.external_data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [internal_user_id, username, user_type, full_name, email, avatar_url, is_active, JSON.stringify(external_data)]);

    res.json({
      success: true,
      user: result.rows[0],
      message: 'User synced successfully'
    });

  } catch (error) {
    console.error('Error syncing user:', error);
    if (error.code === '23505') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Failed to sync user' });
    }
  }
});

// Bulk sync users
router.post('/bulk-sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { users } = req.body;
    const pool = getPool(req);

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'Users array is required' });
    }

    const results = [];
    const errors = [];

    for (const userData of users) {
      try {
        const {
          internal_user_id,
          username,
          user_type,
          full_name,
          email,
          avatar_url,
          is_active = true,
          external_data = {}
        } = userData;

        if (!internal_user_id || !username || !user_type) {
          errors.push({
            user: userData,
            error: 'Missing required fields: internal_user_id, username, user_type'
          });
          continue;
        }

        const result = await pool.query(`
          INSERT INTO users (
            internal_user_id, username, user_type, full_name, email, 
            avatar_url, is_active, external_data, updated_at
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
          ON CONFLICT (internal_user_id) 
          DO UPDATE SET
            username = EXCLUDED.username,
            user_type = EXCLUDED.user_type,
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            avatar_url = EXCLUDED.avatar_url,
            is_active = EXCLUDED.is_active,
            external_data = EXCLUDED.external_data,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, internal_user_id, username
        `, [internal_user_id, username, user_type, full_name, email, avatar_url, is_active, JSON.stringify(external_data)]);

        results.push(result.rows[0]);

      } catch (error) {
        errors.push({
          user: userData,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      synced_count: results.length,
      error_count: errors.length,
      synced_users: results,
      errors: errors
    });

  } catch (error) {
    console.error('Error bulk syncing users:', error);
    res.status(500).json({ error: 'Failed to bulk sync users' });
  }
});

// Get user by internal ID
router.get('/internal/:internal_user_id', authenticateToken, async (req, res) => {
  try {
    const { internal_user_id } = req.params;
    const pool = getPool(req);

    const result = await pool.query(
      'SELECT * FROM users WHERE internal_user_id = $1',
      [internal_user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get all users (with pagination and filters)
router.get('/all', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      user_type, 
      is_active,
      search 
    } = req.query;
    
    const pool = getPool(req);
    const offset = (page - 1) * limit;
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 0;

    if (user_type) {
      paramCount++;
      whereConditions.push(`user_type = $${paramCount}`);
      queryParams.push(user_type);
    }

    if (is_active !== undefined) {
      paramCount++;
      whereConditions.push(`is_active = $${paramCount}`);
      queryParams.push(is_active === 'true');
    }

    if (search) {
      paramCount++;
      whereConditions.push(`(username ILIKE $${paramCount} OR full_name ILIKE $${paramCount})`);
      queryParams.push(`%${search}%`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    paramCount++;
    queryParams.push(limit);
    paramCount++;
    queryParams.push(offset);

    const result = await pool.query(`
      SELECT 
        id, internal_user_id, username, user_type, full_name, email,
        avatar_url, is_online, is_active, last_seen, created_at, updated_at
      FROM users 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount-1} OFFSET $${paramCount}
    `, queryParams);

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM users ${whereClause}
    `, queryParams.slice(0, -2));

    res.json({
      success: true,
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user status (active/inactive)
router.patch('/updateinternal/:internal_user_id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { internal_user_id } = req.params;
    const { is_active } = req.body;
    const pool = getPool(req);

    const result = await pool.query(`
      UPDATE users 
      SET is_active = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE internal_user_id = $2 
      RETURNING id, internal_user_id, username, is_active
    `, [is_active, internal_user_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: result.rows[0],
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Update FCM token for push notifications
router.post('/update-fcm-token', authenticateToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const pool = getPool(req);

    await pool.query(
      'UPDATE users SET fcm_token = $1, updated_at = CURRENT_TIMESTAMP WHERE internal_user_id = $2',
      [fcmToken, req.user.internal_user_id]
    );

    res.json({ 
      success: true, 
      message: 'FCM token updated successfully' 
    });

  } catch (error) {
    console.error('Error updating FCM token:', error);
    res.status(500).json({ error: 'Failed to update FCM token' });
  }
});

// Login endpoint (if you want to handle auth in this system)
router.post('/login', async (req, res) => {
  try {
    const { internal_user_id } = req.body;
    const pool = getPool(req);

    if (!internal_user_id) {
      return res.status(400).json({ error: 'internal_user_id is required' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE internal_user_id = $1 AND is_active = true',
      [internal_user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const user = userResult.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        internal_user_id: user.internal_user_id,
        user_type: user.user_type 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update last seen and online status
    await pool.query(
      'UPDATE users SET is_online = true, last_seen = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        internal_user_id: user.internal_user_id,
        username: user.username,
        full_name: user.full_name,
        user_type: user.user_type,
        avatar_url: user.avatar_url
      }
    });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const pool = getPool(req);

    await pool.query(
      'UPDATE users SET is_online = false, last_seen = CURRENT_TIMESTAMP WHERE id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.post('/fcm/register', async (req, res) => {
  try {
    const { 
      internal_user_id, 
      fcmToken,
      device_id,      // Optional but recommended
      device_name,    // Optional: "John's iPhone"
      device_type     // Optional: "ios", "android", "web"
    } = req.body;
    
    const pool = getPool(req);

    if (!internal_user_id || !fcmToken) {
      return res.status(400).json({ 
        error: 'internal_user_id and fcmToken are required' 
      });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE internal_user_id = $1 AND is_active = true',
      [internal_user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const userId = userResult.rows[0].id;

    // Insert or update device token
    const result = await pool.query(`
      INSERT INTO user_devices (
        user_id, 
        fcm_token, 
        device_id, 
        device_name, 
        device_type,
        last_used_at
      )
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (fcm_token) 
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        device_id = EXCLUDED.device_id,
        device_name = EXCLUDED.device_name,
        device_type = EXCLUDED.device_type,
        is_active = true,
        last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, fcm_token, device_name
    `, [userId, fcmToken, device_id, device_name, device_type]);

    res.json({ 
      success: true, 
      message: 'FCM token registered successfully',
      device: result.rows[0],
      internal_user_id: internal_user_id
    });

  } catch (error) {
    console.error('Error registering FCM token:', error);
    res.status(500).json({ error: 'Failed to register FCM token' });
  }
});

router.delete('/fcm/remove/:internal_user_id', async (req, res) => {
  try {
    const { internal_user_id } = req.params;
    const pool = getPool(req);

    await pool.query(
      'UPDATE users SET fcm_token = NULL WHERE internal_user_id = $1',
      [internal_user_id]
    );

    res.json({ 
      success: true, 
      message: 'FCM token removed successfully' 
    });

  } catch (error) {
    console.error('Error removing FCM token:', error);
    res.status(500).json({ error: 'Failed to remove FCM token' });
  }
});


router.delete('/fcm/removenew', async (req, res) => {
  try {
    const { internal_user_id, fcmToken } = req.body;
    const pool = getPool(req);

    if (!fcmToken) {
      return res.status(400).json({ error: 'fcmToken is required' });
    }

    // Soft delete - mark as inactive
    await pool.query(`
      UPDATE user_devices 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE fcm_token = $1
    `, [fcmToken]);

    res.json({ 
      success: true, 
      message: 'FCM token removed successfully' 
    });

  } catch (error) {
    console.error('Error removing FCM token:', error);
    res.status(500).json({ error: 'Failed to remove FCM token' });
  }
});

router.get('/fcm/devices/:internal_user_id', async (req, res) => {
  try {
    const { internal_user_id } = req.params;
    const pool = getPool(req);

    const result = await pool.query(`
      SELECT 
        ud.id,
        ud.device_id,
        ud.device_name,
        ud.device_type,
        ud.last_used_at,
        ud.created_at
      FROM user_devices ud
      JOIN users u ON ud.user_id = u.id
      WHERE u.internal_user_id = $1 AND ud.is_active = true
      ORDER BY ud.last_used_at DESC
    `, [internal_user_id]);

    res.json({ 
      success: true,
      device_count: result.rows.length,
      devices: result.rows
    });

  } catch (error) {
    console.error('Error getting devices:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});


router.post('/fcm/test-push', async (req, res) => {
  try {
    const { internal_user_id, title = 'Test Notification', body = 'This is a test', roomId } = req.body;
    const pool = getPool(req);
    
    // Get user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE internal_user_id = $1',
      [internal_user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all active devices
    const devicesResult = await pool.query(`
      SELECT fcm_token, device_name
      FROM user_devices
      WHERE user_id = $1 AND is_active = true AND fcm_token IS NOT NULL
    `, [userResult.rows[0].id]);

    if (devicesResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active devices found' });
    }

    const { sendPushNotification } = require('../services/pushNotification');
    const results = [];

    // Send to all devices
    for (const device of devicesResult.rows) {
      const pushResult = await sendPushNotification(
        device.fcm_token,
        title,
        body,
        { 
          type: 'test',
          userId: internal_user_id,
          roomId: roomId
        }
      );
      
      results.push({
        device: device.device_name || 'Unknown',
        success: !pushResult?.shouldRemoveToken
      });
    }
    
    res.json({ 
      success: true, 
      message: `Test notification sent to ${devicesResult.rows.length} device(s)`,
      results: results
    });
    
  } catch (error) {
    console.error('Test push error:', error);
    res.status(500).json({ error: error.message });
  }
});


// UPDATE USER
router.put('/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      username,
      full_name,
      email,
      user_type,
      is_active,
      avatar_url
    } = req.body;

    const pool = getPool(req);

    // First check if user exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (username !== undefined) {
      paramCount++;
      updates.push(`username = $${paramCount}`);
      values.push(username);
    }

    if (full_name !== undefined) {
      paramCount++;
      updates.push(`full_name = $${paramCount}`);
      values.push(full_name);
    }

    if (email !== undefined) {
      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }

    if (user_type !== undefined) {
      // Validate user_type
      if (!['admin', 'client', 'technician'].includes(user_type)) {
        return res.status(400).json({ 
          error: 'Invalid user_type. Must be: admin, client, or technician' 
        });
      }
      paramCount++;
      updates.push(`user_type = $${paramCount}`);
      values.push(user_type);
    }

    if (is_active !== undefined) {
      paramCount++;
      updates.push(`is_active = $${paramCount}`);
      values.push(is_active);
    }

    if (avatar_url !== undefined) {
      paramCount++;
      updates.push(`avatar_url = $${paramCount}`);
      values.push(avatar_url);
    }

    // Always update updated_at timestamp
    paramCount++;
    updates.push(`updated_at = $${paramCount}`);
    values.push(new Date());

    if (updates.length === 1) { // Only updated_at
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add user id as last parameter
    paramCount++;
    values.push(id);

    const result = await pool.query(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, values);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating user:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      return res.status(409).json({ 
        error: 'Username or email already exists' 
      });
    }
    
    res.status(500).json({ error: 'Failed to update user' });
  }
});


// DELETE USER (Soft delete - recommended)
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { hard_delete } = req.query; // ?hard_delete=true for permanent deletion

    const pool = getPool(req);

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, username, user_type FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userCheck.rows[0];

    // Prevent deleting admin users
    if (user.user_type === 'admin') {
      return res.status(403).json({ 
        error: 'Cannot delete admin users' 
      });
    }

    if (hard_delete === 'true') {
      // HARD DELETE - Permanently remove user
      // ⚠️ Warning: This will cause issues if there are foreign key constraints
      
      // Check for active chat rooms
      const chatRoomsCheck = await pool.query(
        'SELECT COUNT(*) FROM chat_rooms WHERE (client_id = $1 OR technician_id = $1) AND is_active = true',
        [id]
      );

      if (parseInt(chatRoomsCheck.rows[0].count) > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete user with active chat rooms. Deactivate chat rooms first or use soft delete.' 
        });
      }

      await pool.query('DELETE FROM users WHERE id = $1', [id]);

      res.json({
        success: true,
        message: 'User permanently deleted',
        deleted_user_id: id
      });

    } else {
      // SOFT DELETE - Just mark as inactive (recommended)
      const result = await pool.query(`
        UPDATE users 
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [id]);

      res.json({
        success: true,
        message: 'User deactivated successfully',
        user: result.rows[0]
      });
    }

  } catch (error) {
    console.error('Error deleting user:', error);
    
    // Handle foreign key constraint violations
    if (error.code === '23503') {
      return res.status(400).json({ 
        error: 'Cannot delete user due to existing references. Use soft delete instead.' 
      });
    }
    
    res.status(500).json({ error: 'Failed to delete user' });
  }
});


// BONUS: Restore deactivated user
router.patch('/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool(req);

    const result = await pool.query(`
      UPDATE users 
      SET is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'User restored successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error restoring user:', error);
    res.status(500).json({ error: 'Failed to restore user' });
  }
});

module.exports = router;