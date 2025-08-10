const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Look up user by internal_user_id
    const userResult = await pool.query(
      'SELECT * FROM users WHERE internal_user_id = $1 AND is_active = true', 
      [decoded.internal_user_id || decoded.userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found or inactive' });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Admin role check middleware
const requireAdmin = (req, res, next) => {
  if (req.user.user_type !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Client or technician role check
const requireClientOrTechnician = (req, res, next) => {
  if (!['client', 'technician'].includes(req.user.user_type)) {
    return res.status(403).json({ error: 'Client or technician access required' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireClientOrTechnician
};
