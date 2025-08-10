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
      limit = 20, 
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

module.exports = router;