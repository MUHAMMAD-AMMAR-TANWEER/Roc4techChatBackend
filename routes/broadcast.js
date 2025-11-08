const express = require('express');
const router = express.Router();
const odooSessionManager = require('../services/odooSession');

// Simple session storage (in production, use Redis or database)
const sessions = new Map();

// Middleware to check if admin is authenticated
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !sessions.has(token)) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Unauthorized</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background: #f5f5f5;
            margin: 0;
          }
          .error-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
          }
          h1 { color: #e74c3c; }
          a {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background: #3498db;
            color: white;
            text-decoration: none;
            border-radius: 5px;
          }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>🔒 Unauthorized</h1>
          <p>Please login to access the broadcast panel.</p>
          <a href="/admin/broadcast">Go to Login</a>
        </div>
      </body>
      </html>
    `);
  }
  
  next();
};

// Login page
router.get('/broadcast', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login - Broadcast Panel</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .login-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 400px;
            width: 100%;
            padding: 40px;
        }

        .logo {
            text-align: center;
            font-size: 60px;
            margin-bottom: 20px;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 24px;
            text-align: center;
        }

        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
            text-align: center;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            color: #333;
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 14px;
        }

        input[type="password"] {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 15px;
            transition: all 0.3s;
            font-family: inherit;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }

        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
            display: none;
        }

        .error.show {
            display: block;
        }

        .loading {
            display: none;
            text-align: center;
            color: #667eea;
            margin-top: 15px;
            font-weight: 600;
        }

        .loading.active {
            display: block;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(102, 126, 234, 0.3);
            border-radius: 50%;
            border-top-color: #667eea;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">🔐</div>
        <h1>Admin Login</h1>
        <p class="subtitle">Enter password to access broadcast panel</p>

        <div class="error" id="error"></div>

        <form id="loginForm">
            <div class="form-group">
                <label for="password">Password</label>
                <input 
                    type="password" 
                    id="password" 
                    placeholder="Enter admin password"
                    required
                    autocomplete="off"
                >
            </div>

            <button type="submit" class="btn" id="loginBtn">
                🔓 Login
            </button>

            <div class="loading" id="loading">
                <span class="spinner"></span>
                Authenticating...
            </div>
        </form>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const password = document.getElementById('password').value;
            const loginBtn = document.getElementById('loginBtn');
            const loading = document.getElementById('loading');
            const errorDiv = document.getElementById('error');

            // Hide error
            errorDiv.classList.remove('show');

            // Show loading
            loginBtn.disabled = true;
            loading.classList.add('active');

            try {
                const response = await fetch('/admin/broadcast/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Save token
                    localStorage.setItem('adminToken', data.token);
                    // Redirect to broadcast panel
                    window.location.href = '/admin/broadcast/panel';
                } else {
                    throw new Error(data.error || 'Invalid password');
                }

            } catch (error) {
                errorDiv.textContent = '❌ ' + error.message;
                errorDiv.classList.add('show');
                document.getElementById('password').value = '';
                document.getElementById('password').focus();
            } finally {
                loginBtn.disabled = false;
                loading.classList.remove('active');
            }
        });

        // Auto-focus password field
        document.getElementById('password').focus();
    </script>
</body>
</html>
  `);
});

// Login API endpoint
router.post('/broadcast/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.BROADCAST_ADMIN_PASSWORD || 'admin123';

  if (password === ADMIN_PASSWORD) {
    // Generate simple token
    const token = require('crypto').randomBytes(32).toString('hex');
    sessions.set(token, { createdAt: Date.now() });

    // Clean old sessions (older than 24 hours)
    for (const [key, value] of sessions.entries()) {
      if (Date.now() - value.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(key);
      }
    }

    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Broadcast panel (protected)
router.get('/broadcast/panel', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broadcast Admin Panel</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .header {
            max-width: 600px;
            margin: 0 auto 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logout-btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 2px solid white;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
        }

        .logout-btn:hover {
            background: white;
            color: #667eea;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 600px;
            width: 100%;
            padding: 40px;
            margin: 0 auto;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }

        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            color: #333;
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 14px;
        }

        input[type="text"],
        textarea,
        select {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 15px;
            transition: all 0.3s;
            font-family: inherit;
        }

        input:focus,
        textarea:focus,
        select:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        textarea {
            resize: vertical;
            min-height: 120px;
        }

        .btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }

        .result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 10px;
            display: none;
        }

        .result.success {
            background: #d4edda;
            border: 2px solid #c3e6cb;
            color: #155724;
        }

        .result.error {
            background: #f8d7da;
            border: 2px solid #f5c6cb;
            color: #721c24;
        }

        .result h3 {
            margin-bottom: 10px;
            font-size: 18px;
        }

        .result-details {
            font-size: 14px;
            line-height: 1.6;
        }

        .loading {
            display: none;
            text-align: center;
            color: #667eea;
            margin-top: 15px;
            font-weight: 600;
        }

        .loading.active {
            display: block;
        }

        .filter-info {
            background: #f8f9fa;
            padding: 10px 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 13px;
            color: #666;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(102, 126, 234, 0.3);
            border-radius: 50%;
            border-top-color: #667eea;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }

        .char-count {
            text-align: right;
            font-size: 12px;
            color: #999;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div></div>
        <button class="logout-btn" onclick="logout()">🚪 Logout</button>
    </div>

    <div class="container">
        <h1>📢 Broadcast Notification</h1>
        <p class="subtitle">Send push notifications to all users</p>

        <form id="broadcastForm">
            <div class="form-group">
                <label for="userFilter">👥 Send To</label>
                <select id="userFilter">
                    <option value="">All Users (Clients + Technicians)</option>
                    <option value="client">Clients Only</option>
                    <option value="technician">Technicians Only</option>
                    <option value="admin">Admins Only</option>
                </select>
                <div class="filter-info">
                    📱 Notifications will be sent to all active devices
                </div>
            </div>

            <div class="form-group">
                <label for="title">📝 Notification Title</label>
                <input 
                    type="text" 
                    id="title" 
                    placeholder="e.g., System Maintenance Alert"
                    required
                    maxlength="100"
                >
                <div class="char-count">
                    <span id="titleCount">0</span>/100 characters
                </div>
            </div>

            <div class="form-group">
                <label for="body">💬 Notification Message</label>
                <textarea 
                    id="body" 
                    placeholder="e.g., Our system will undergo maintenance from 2 AM to 4 AM. Please save your work."
                    required
                    maxlength="500"
                ></textarea>
                <div class="char-count">
                    <span id="bodyCount">0</span>/500 characters
                </div>
            </div>

            <button type="submit" class="btn" id="sendBtn">
                📤 Send Broadcast
            </button>

            <div class="loading" id="loading">
                <span class="spinner"></span>
                Sending broadcast...
            </div>
        </form>

        <div class="result" id="result"></div>
    </div>

    <script>
        // Check if logged in
        const token = localStorage.getItem('adminToken');
        if (!token) {
            window.location.href = '/admin/broadcast';
        }

        // Character counters
        document.getElementById('title').addEventListener('input', (e) => {
            document.getElementById('titleCount').textContent = e.target.value.length;
        });

        document.getElementById('body').addEventListener('input', (e) => {
            document.getElementById('bodyCount').textContent = e.target.value.length;
        });

        // Logout function
        function logout() {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin/broadcast';
        }

        // Form submission
        document.getElementById('broadcastForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = document.getElementById('title').value;
            const body = document.getElementById('body').value;
            const userFilter = document.getElementById('userFilter').value;
            const token = localStorage.getItem('adminToken');

            const sendBtn = document.getElementById('sendBtn');
            const loading = document.getElementById('loading');
            const resultDiv = document.getElementById('result');

            // Show loading
            sendBtn.disabled = true;
            loading.classList.add('active');
            resultDiv.style.display = 'none';

            try {
                const response = await fetch('/admin/broadcast/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                        title: title,
                        body: body,
                        user_type_filter: userFilter || null
                    })
                });

                const data = await response.json();

                if (response.status === 401) {
                    // Session expired
                    alert('Session expired. Please login again.');
                    logout();
                    return;
                }

                if (response.ok && data.success) {
                    resultDiv.className = 'result success';
                    resultDiv.innerHTML = \`
                        <h3>✅ Broadcast Sent Successfully!</h3>
                        <div class="result-details">
                            <p><strong>📊 Summary:</strong></p>
                            <p>• Total Devices: \${data.summary.total_devices}</p>
                            <p>• Unique Users: \${data.summary.unique_users}</p>
                            <p>• Successful: \${data.summary.success_count}</p>
                            <p>• Failed: \${data.summary.failed_count}</p>
                            <p>• Filter: \${data.summary.filter_applied}</p>
                            <p style="margin-top: 10px;"><strong>📝 Sent Message:</strong></p>
                            <p>"\${data.broadcast_content.title}"</p>
                            <p>\${data.broadcast_content.body}</p>
                            <p style="margin-top: 10px; font-size: 12px; color: #666;">
                                🕐 Sent at: \${new Date(data.timestamp).toLocaleString()}
                            </p>
                        </div>
                    \`;

                    // Clear form
                    document.getElementById('title').value = '';
                    document.getElementById('body').value = '';
                    document.getElementById('titleCount').textContent = '0';
                    document.getElementById('bodyCount').textContent = '0';
                } else {
                    throw new Error(data.error || 'Failed to send broadcast');
                }

            } catch (error) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = \`
                    <h3>❌ Error</h3>
                    <div class="result-details">
                        <p>\${error.message}</p>
                    </div>
                \`;
            } finally {
                sendBtn.disabled = false;
                loading.classList.remove('active');
                resultDiv.style.display = 'block';
            }
        });
    </script>
</body>
</html>
  `);
});

// Send broadcast API (protected)
// Send broadcast API (protected)
router.post('/broadcast/send', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { title, body, user_type_filter } = req.body;
    const pool = req.app.locals.pool;

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    // Build query based on filter
    let query = `
      SELECT DISTINCT ud.id, ud.fcm_token, ud.device_id, ud.device_name, ud.device_type,
             u.id as user_id, u.username, u.full_name, u.user_type
      FROM user_devices ud
      JOIN users u ON ud.user_id = u.id
      WHERE ud.is_active = true AND ud.fcm_token IS NOT NULL
    `;
    
    const params = [];
    if (user_type_filter) {
      params.push(user_type_filter);
      query += ` AND u.user_type = $1`;
    }

    const devicesResult = await pool.query(query, params);

    if (devicesResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No active devices found',
        filter_applied: user_type_filter || 'none'
      });
    }

    console.log(`📢 [BROADCAST] Sending to ${devicesResult.rows.length} devices...`);

    const { sendPushNotification } = require('../services/pushNotification');
    
    let successCount = 0;
    let failedCount = 0;
    const uniqueUsers = new Set();

    // Send to all devices
    for (const device of devicesResult.rows) {
      uniqueUsers.add(device.user_id);
      
      try {
        const data = {
          type: 'broadcast',
          timestamp: new Date().toISOString()
        };

        const pushResult = await sendPushNotification(
          device.fcm_token,
          title,
          body,
          data
        );

        if (pushResult && pushResult.shouldRemoveToken) {
          await pool.query(
            'UPDATE user_devices SET is_active = false WHERE id = $1',
            [device.id]
          );
          failedCount++;
        } else {
          successCount++;
        }

      } catch (error) {
        failedCount++;
        console.error(`[BROADCAST] Error sending to ${device.username}:`, error.message);
      }
    }

    console.log(`📢 [BROADCAST] Complete: ${successCount} success, ${failedCount} failed`);

    // ========== 🆕 SAVE NOTIFICATIONS TO DATABASE ==========
    try {
      console.log(`📢 [BROADCAST] Saving notifications to database for ${devicesResult.rows.length} devices...`);

      // Insert notifications for each device that successfully received notification
      const notificationInserts = [];
      for (const device of devicesResult.rows) {
        // Get user's internal_id
        const userQuery = await pool.query(
          'SELECT internal_user_id FROM users WHERE id = $1',
          [device.user_id]
        );

        if (userQuery.rows.length > 0) {
          const internalId = userQuery.rows[0].internal_user_id;

          notificationInserts.push(pool.query(
            `INSERT INTO user_notifications
            (user_id, internal_id, title, body, type, message_type, internal_task_id, fcm_token, device_id, watched)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
            [device.user_id, internalId, title, body, 'broadcast', 'admin_broadcast', null, device.fcm_token, device.device_id]
          ));
        }
      }

      await Promise.all(notificationInserts);
      console.log(`📢 [BROADCAST] ✅ Saved ${notificationInserts.length} notifications to database`);

    } catch (dbError) {
      console.error('[BROADCAST] ❌ Failed to save notifications to database:', dbError.message);
    }

    // ========== 🆕 SEND NOTIFICATION TO ODOO USING SESSION MANAGER ==========
    let odooNotificationSent = false;
    try {
      const odooPayload = {
        title: title,
        message: `
          <div style="padding: 10px; background: #f8f9fa; border-radius: 5px;">
            <p><strong>📱 Broadcast Notification Sent via Chat System</strong></p>
            <hr style="margin: 10px 0;">
            <p><strong>Title:</strong> ${title}</p>
            <p><strong>Message:</strong> ${body}</p>
            <hr style="margin: 10px 0;">
            <p><strong>📊 Delivery Statistics:</strong></p>
            <ul>
              <li>Total Devices: ${devicesResult.rows.length}</li>
              <li>Unique Users: ${uniqueUsers.size}</li>
              <li>Successfully Delivered: ${successCount}</li>
              <li>Failed: ${failedCount}</li>
              <li>Filter Applied: ${user_type_filter || 'All Users'}</li>
            </ul>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">
              Sent at: ${new Date().toLocaleString()}
            </p>
          </div>
        `,
        priority: 'high',
        sender_name: 'Chat Broadcast System'
      };

      console.log('[BROADCAST→ODOO] 📤 Sending notification to Odoo...');
      
      // Use the session manager to call Odoo API
      const odooResponse = await odooSessionManager.callOdooAPI(
        '/api/project/notifications/broadcast',
        odooPayload
      );

      // Handle JSON-RPC response format
      const result = odooResponse.result || odooResponse;
      
      if (result && result.success) {
        console.log('[BROADCAST→ODOO] ✅ Odoo notification sent successfully');
        odooNotificationSent = true;
      } else {
        console.log('[BROADCAST→ODOO] ⚠️ Odoo responded but notification may have failed:', result);
      }

    } catch (odooError) {
      // Don't fail the broadcast if Odoo notification fails
      console.error('[BROADCAST→ODOO] ❌ Failed to notify Odoo:', odooError.message);
    }

    res.json({
      success: successCount > 0,
      message: 'Broadcast sent successfully',
      summary: {
        total_devices: devicesResult.rows.length,
        unique_users: uniqueUsers.size,
        success_count: successCount,
        failed_count: failedCount,
        filter_applied: user_type_filter || 'all users'
      },
      broadcast_content: { title, body },
      timestamp: new Date().toISOString(),
      odoo_notified: odooNotificationSent
    });

  } catch (error) {
    console.error('[BROADCAST] ❌ Error:', error);
    res.status(500).json({ 
      error: 'Failed to send broadcast',
      message: error.message 
    });
  }
});

// ========== SERVER-TO-SERVER BROADCAST API (No Bearer Token Required) ==========
// Protected by API Key instead of session token
router.post('/broadcast/send-internal', async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  console.log('\n========================================');
  console.log(`🔔 [INTERNAL-BROADCAST] API Called at ${requestTimestamp}`);
  console.log('========================================');
  console.log(`📍 Endpoint: POST /admin/broadcast/send-internal`);
  console.log(`🌐 Request IP: ${req.ip || req.socket?.remoteAddress || 'unknown'}`);
  console.log(`📦 Request Body:`, JSON.stringify({
    title: req.body.title,
    body: req.body.body,
    user_type_filter: req.body.user_type_filter || 'all users'
  }, null, 2));

  try {
    // Check API key from header or body
    const apiKey = req.headers['x-api-key'] || req.body.api_key;
    const INTERNAL_API_KEY = process.env.INTERNAL_BROADCAST_API_KEY || 'default-internal-key-change-me';

    console.log(`🔑 API Key Authentication: ${apiKey ? 'Key Provided' : 'No Key Provided'}`);

    if (!apiKey || apiKey !== INTERNAL_API_KEY) {
      console.log('❌ [INTERNAL-BROADCAST] Authentication Failed - Invalid or missing API key');
      console.log('========================================\n');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing API key'
      });
    }

    console.log('✅ [INTERNAL-BROADCAST] Authentication Successful');

    const { title, body, user_type_filter } = req.body;
    const pool = req.app.locals.pool;

    if (!title || !body) {
      console.log('❌ [INTERNAL-BROADCAST] Validation Failed - Missing title or body');
      console.log('========================================\n');
      return res.status(400).json({ error: 'title and body are required' });
    }

    console.log('✅ [INTERNAL-BROADCAST] Request Validated');

    // Build query based on filter
    let query = `
      SELECT DISTINCT ud.id, ud.fcm_token, ud.device_id, ud.device_name, ud.device_type,
             u.id as user_id, u.username, u.full_name, u.user_type
      FROM user_devices ud
      JOIN users u ON ud.user_id = u.id
      WHERE ud.is_active = true AND ud.fcm_token IS NOT NULL
    `;

    const params = [];
    if (user_type_filter) {
      params.push(user_type_filter);
      query += ` AND u.user_type = $1`;
      console.log(`🔍 [INTERNAL-BROADCAST] Applying filter: user_type = '${user_type_filter}'`);
    } else {
      console.log(`🔍 [INTERNAL-BROADCAST] No filter applied - targeting all users`);
    }

    console.log('📊 [INTERNAL-BROADCAST] Querying database for active devices...');
    const devicesResult = await pool.query(query, params);

    if (devicesResult.rows.length === 0) {
      console.log('⚠️ [INTERNAL-BROADCAST] No active devices found');
      console.log('========================================\n');
      return res.status(404).json({
        error: 'No active devices found',
        filter_applied: user_type_filter || 'none'
      });
    }

    console.log(`📢 [INTERNAL-BROADCAST] Found ${devicesResult.rows.length} active devices`);
    console.log(`👥 [INTERNAL-BROADCAST] Starting push notification delivery...`);

    const { sendPushNotification } = require('../services/pushNotification');

    let successCount = 0;
    let failedCount = 0;
    const uniqueUsers = new Set();

    // Send to all devices
    for (const device of devicesResult.rows) {
      uniqueUsers.add(device.user_id);

      try {
        const data = {
          type: 'broadcast_technician_notify',
          timestamp: new Date().toISOString()

        };

        const pushResult = await sendPushNotification(
          device.fcm_token,
          title,
          body,
          data
        );

        if (pushResult && pushResult.shouldRemoveToken) {
          await pool.query(
            'UPDATE user_devices SET is_active = false WHERE id = $1',
            [device.id]
          );
          failedCount++;
        } else {
          successCount++;
        }

      } catch (error) {
        failedCount++;
        console.error(`[INTERNAL-BROADCAST] Error sending to ${device.username}:`, error.message);
      }
    }

    console.log(`📢 [INTERNAL-BROADCAST] Push Notification Delivery Complete:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   👤 Unique Users: ${uniqueUsers.size}`);

    // Save notifications to database
    try {
      console.log(`💾 [INTERNAL-BROADCAST] Saving notifications to database for ${devicesResult.rows.length} devices...`);

      const notificationInserts = [];
      for (const device of devicesResult.rows) {
        const userQuery = await pool.query(
          'SELECT internal_user_id FROM users WHERE id = $1',
          [device.user_id]
        );

        if (userQuery.rows.length > 0) {
          const internalId = userQuery.rows[0].internal_user_id;

          notificationInserts.push(pool.query(
            `INSERT INTO user_notifications
            (user_id, internal_id, title, body, type, message_type, internal_task_id, fcm_token, device_id, watched)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
            [device.user_id, internalId, title, body, 'broadcast', 'broadcast_internal', null, device.fcm_token, device.device_id]
          ));
        }
      }

      await Promise.all(notificationInserts);
      console.log(`💾 [INTERNAL-BROADCAST] ✅ Saved ${notificationInserts.length} notifications to database`);

    } catch (dbError) {
      console.error('💾 [INTERNAL-BROADCAST] ❌ Failed to save notifications to database:', dbError.message);
    }

    // Send notification to Odoo
    let odooNotificationSent = false;
    try {
      console.log('🔗 [INTERNAL-BROADCAST→ODOO] Preparing to send notification to Odoo...');
      const odooPayload = {
        title: title,
        message: `
          <div style="padding: 10px; background: #f8f9fa; border-radius: 5px;">
            <p><strong>📱 Broadcast Notification Sent via Chat System</strong></p>
            <hr style="margin: 10px 0;">
            <p><strong>Title:</strong> ${title}</p>
            <p><strong>Message:</strong> ${body}</p>
            <hr style="margin: 10px 0;">
            <p><strong>📊 Delivery Statistics:</strong></p>
            <ul>
              <li>Total Devices: ${devicesResult.rows.length}</li>
              <li>Unique Users: ${uniqueUsers.size}</li>
              <li>Successfully Delivered: ${successCount}</li>
              <li>Failed: ${failedCount}</li>
              <li>Filter Applied: ${user_type_filter || 'All Users'}</li>
            </ul>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">
              Sent at: ${new Date().toLocaleString()}
            </p>
          </div>
        `,
        priority: 'high',
        sender_name: 'Chat Broadcast System'
      };

      console.log('🔗 [INTERNAL-BROADCAST→ODOO] Sending notification to Odoo API...');

      const odooResponse = await odooSessionManager.callOdooAPI(
        '/api/project/notifications/broadcast',
        odooPayload
      );

      const result = odooResponse.result || odooResponse;

      if (result && result.success) {
        console.log('🔗 [INTERNAL-BROADCAST→ODOO] ✅ Odoo notification sent successfully');
        odooNotificationSent = true;
      } else {
        console.log('🔗 [INTERNAL-BROADCAST→ODOO] ⚠️ Odoo responded but notification may have failed:', JSON.stringify(result));
      }

    } catch (odooError) {
      console.error('🔗 [INTERNAL-BROADCAST→ODOO] ❌ Failed to notify Odoo:', odooError.message);
    }

    const responseData = {
      success: successCount > 0,
      message: 'Broadcast sent successfully',
      summary: {
        total_devices: devicesResult.rows.length,
        unique_users: uniqueUsers.size,
        success_count: successCount,
        failed_count: failedCount,
        filter_applied: user_type_filter || 'all users'
      },
      broadcast_content: { title, body },
      timestamp: new Date().toISOString(),
      odoo_notified: odooNotificationSent
    };

    console.log('✅ [INTERNAL-BROADCAST] Request completed successfully');
    console.log('📊 [INTERNAL-BROADCAST] Response Summary:', JSON.stringify(responseData.summary, null, 2));
    console.log('========================================\n');

    res.json(responseData);

  } catch (error) {
    console.error('❌ [INTERNAL-BROADCAST] Error occurred:', error.message);
    console.error('❌ [INTERNAL-BROADCAST] Stack trace:', error.stack);
    console.log('========================================\n');
    res.status(500).json({
      error: 'Failed to send broadcast',
      message: error.message
    });
  }
});

// ========== TARGETED BROADCAST BY INTERNAL IDs (Server-to-Server) ==========
// Broadcast to specific users by their internal_ids
router.post('/broadcast/send-to-users', async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  console.log('\n========================================');
  console.log(`🎯 [TARGETED-BROADCAST] API Called at ${requestTimestamp}`);
  console.log('========================================');
  console.log(`📍 Endpoint: POST /admin/broadcast/send-to-users`);
  console.log(`🌐 Request IP: ${req.ip || req.socket?.remoteAddress || 'unknown'}`);

  try {
    // Check API key from header or body
    const apiKey = req.headers['x-api-key'] || req.body.api_key;
    const INTERNAL_API_KEY = process.env.INTERNAL_BROADCAST_API_KEY || 'default-internal-key-change-me';

    console.log(`🔑 API Key Authentication: ${apiKey ? 'Key Provided' : 'No Key Provided'}`);

    if (!apiKey || apiKey !== INTERNAL_API_KEY) {
      console.log('❌ [TARGETED-BROADCAST] Authentication Failed - Invalid or missing API key');
      console.log('========================================\n');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing API key'
      });
    }

    console.log('✅ [TARGETED-BROADCAST] Authentication Successful');

    const { internal_ids, title, body, message_type, internal_task_id } = req.body;
    const pool = req.app.locals.pool;

    console.log(`📦 Request Body:`, JSON.stringify({
      internal_ids: internal_ids,
      title: title,
      body: body,
      message_type: message_type || 'notification'
    }, null, 2));

    // Validation
    if (!internal_ids || !Array.isArray(internal_ids) || internal_ids.length === 0) {
      console.log('❌ [TARGETED-BROADCAST] Validation Failed - internal_ids must be a non-empty array');
      console.log('========================================\n');
      return res.status(400).json({
        error: 'internal_ids is required and must be a non-empty array'
      });
    }

    if (!title || !body) {
      console.log('❌ [TARGETED-BROADCAST] Validation Failed - Missing title or body');
      console.log('========================================\n');
      return res.status(400).json({ error: 'title and body are required' });
    }

    console.log('✅ [TARGETED-BROADCAST] Request Validated');
    console.log(`🎯 [TARGETED-BROADCAST] Targeting ${internal_ids.length} internal_id(s): ${internal_ids.join(', ')}`);

    // Query to get all devices for users with specified internal_ids
    const query = `
      SELECT DISTINCT ud.id, ud.fcm_token, ud.device_id, ud.device_name, ud.device_type,
             u.id as user_id, u.username, u.full_name, u.user_type, u.internal_user_id
      FROM user_devices ud
      JOIN users u ON ud.user_id = u.id
      WHERE ud.is_active = true
        AND ud.fcm_token IS NOT NULL
        AND u.internal_user_id = ANY($1)
    `;

    console.log('📊 [TARGETED-BROADCAST] Querying database for active devices...');
    const devicesResult = await pool.query(query, [internal_ids]);

    if (devicesResult.rows.length === 0) {
      console.log('⚠️ [TARGETED-BROADCAST] No active devices found for given internal_ids');
      console.log('========================================\n');
      return res.status(404).json({
        error: 'No active devices found for the specified internal_ids',
        internal_ids_searched: internal_ids
      });
    }

    console.log(`📢 [TARGETED-BROADCAST] Found ${devicesResult.rows.length} active devices for ${new Set(devicesResult.rows.map(d => d.internal_user_id)).size} users`);
    console.log(`👥 [TARGETED-BROADCAST] Starting push notification delivery...`);

    const { sendPushNotification } = require('../services/pushNotification');

    let successCount = 0;
    let failedCount = 0;
    const uniqueUsers = new Set();
    const targetedInternalIds = new Set();

    // Send to all devices
    for (const device of devicesResult.rows) {
      uniqueUsers.add(device.user_id);
      targetedInternalIds.add(device.internal_user_id);

      try {
        const data = {
          type: message_type || 'notification',
          timestamp: new Date().toISOString(),
          internal_id: device.internal_user_id
        };

        const pushResult = await sendPushNotification(
          device.fcm_token,
          title,
          body,
          data
        );

        if (pushResult && pushResult.shouldRemoveToken) {
          await pool.query(
            'UPDATE user_devices SET is_active = false WHERE id = $1',
            [device.id]
          );
          failedCount++;
        } else {
          successCount++;
        }

      } catch (error) {
        failedCount++;
        console.error(`[TARGETED-BROADCAST] Error sending to ${device.username}:`, error.message);
      }
    }

    console.log(`📢 [TARGETED-BROADCAST] Push Notification Delivery Complete:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   👤 Unique Users: ${uniqueUsers.size}`);
    console.log(`   🎯 Internal IDs Reached: ${Array.from(targetedInternalIds).join(', ')}`);

    // Save notifications to database
    try {
      console.log(`💾 [TARGETED-BROADCAST] Saving notifications to database for ${devicesResult.rows.length} devices...`);

      const notificationInserts = [];
      for (const device of devicesResult.rows) {
        const userQuery = await pool.query(
          'SELECT internal_user_id FROM users WHERE id = $1',
          [device.user_id]
        );

        if (userQuery.rows.length > 0) {
          const internalId = userQuery.rows[0].internal_user_id;

          notificationInserts.push(pool.query(
            `INSERT INTO user_notifications
            (user_id, internal_id, title, body, type, message_type, internal_task_id, fcm_token, device_id, watched)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
            [device.user_id, internalId, title, body, message_type || 'notification', 'targeted_broadcast', internal_task_id || null, device.fcm_token, device.device_id]
          ));
        }
      }

      await Promise.all(notificationInserts);
      console.log(`💾 [TARGETED-BROADCAST] ✅ Saved ${notificationInserts.length} notifications to database`);

    } catch (dbError) {
      console.error('💾 [TARGETED-BROADCAST] ❌ Failed to save notifications to database:', dbError.message);
    }

    // Send notification to Odoo
    let odooNotificationSent = false;
    try {
      console.log('🔗 [TARGETED-BROADCAST→ODOO] Preparing to send notification to Odoo...');
      const odooPayload = {
        title: title,
        message: `
          <div style="padding: 10px; background: #f8f9fa; border-radius: 5px;">
            <p><strong>🎯 Targeted Broadcast Notification Sent via Chat System</strong></p>
            <hr style="margin: 10px 0;">
            <p><strong>Title:</strong> ${title}</p>
            <p><strong>Message:</strong> ${body}</p>
            <p><strong>Message Type:</strong> ${message_type || 'notification'}</p>
            <hr style="margin: 10px 0;">
            <p><strong>📊 Delivery Statistics:</strong></p>
            <ul>
              <li>Total Devices: ${devicesResult.rows.length}</li>
              <li>Unique Users: ${uniqueUsers.size}</li>
              <li>Successfully Delivered: ${successCount}</li>
              <li>Failed: ${failedCount}</li>
              <li>Targeted Internal IDs: ${Array.from(targetedInternalIds).join(', ')}</li>
            </ul>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">
              Sent at: ${new Date().toLocaleString()}
            </p>
          </div>
        `,
        priority: 'high',
        sender_name: 'Chat Broadcast System'
      };

      console.log('🔗 [TARGETED-BROADCAST→ODOO] Sending notification to Odoo API...');

      const odooResponse = await odooSessionManager.callOdooAPI(
        '/api/project/notifications/broadcast',
        odooPayload
      );

      const result = odooResponse.result || odooResponse;

      if (result && result.success) {
        console.log('🔗 [TARGETED-BROADCAST→ODOO] ✅ Odoo notification sent successfully');
        odooNotificationSent = true;
      } else {
        console.log('🔗 [TARGETED-BROADCAST→ODOO] ⚠️ Odoo responded but notification may have failed:', JSON.stringify(result));
      }

    } catch (odooError) {
      console.error('🔗 [TARGETED-BROADCAST→ODOO] ❌ Failed to notify Odoo:', odooError.message);
    }

    const responseData = {
      success: successCount > 0,
      message: 'Targeted broadcast sent successfully',
      summary: {
        total_devices: devicesResult.rows.length,
        unique_users: uniqueUsers.size,
        success_count: successCount,
        failed_count: failedCount,
        targeted_internal_ids: Array.from(targetedInternalIds),
        requested_internal_ids: internal_ids,
        message_type: message_type || 'notification'
      },
      broadcast_content: { title, body },
      timestamp: new Date().toISOString(),
      odoo_notified: odooNotificationSent
    };

    console.log('✅ [TARGETED-BROADCAST] Request completed successfully');
    console.log('📊 [TARGETED-BROADCAST] Response Summary:', JSON.stringify(responseData.summary, null, 2));
    console.log('========================================\n');

    res.json(responseData);

  } catch (error) {
    console.error('❌ [TARGETED-BROADCAST] Error occurred:', error.message);
    console.error('❌ [TARGETED-BROADCAST] Stack trace:', error.stack);
    console.log('========================================\n');
    res.status(500).json({
      error: 'Failed to send targeted broadcast',
      message: error.message
    });
  }
});


module.exports = router;