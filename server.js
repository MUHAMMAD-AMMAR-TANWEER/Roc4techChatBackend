const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Updated CORS origins to include your subdomain
const allowedOrigins = [
  "http://localhost:3000", 
  "http://localhost:19006", 
  "https://chat.roc4.live",  // Your new subdomain
  "https://roc4.live"        // Your main domain if needed
];

// Configure CORS for Socket.io
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect()
  .then(client => {
    console.log('✅ Database connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  });

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files with proper headers for nginx caching
app.use('/uploads', express.static('uploads', {
  maxAge: '1d',
  etag: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Chat System API',
    database: 'Connected',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Make pool available to routes
app.locals.pool = pool;

// API Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/upload', require('./routes/upload'));

// Socket.io connection handling
const socketHandler = require('./socket/socketHandler');
socketHandler(io, pool);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Handle 404 for API routes only
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

const PORT = process.env.PORT || 4000;

// Ensure the server runs on the correct interface
const HOST = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Chat System Server running on ${HOST}:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://${HOST}:${PORT}/health`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🌐 Public URL: https://chat.roc4.live`);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    pool.end(() => {
      console.log('✅ Server closed successfully');
      process.exit(0);
    });
  });
});

// Handle uncaught exceptions in production
if (process.env.NODE_ENV === 'production') {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

module.exports = { app, server, pool };