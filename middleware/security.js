const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// Rate limiting configuration
const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Different rate limits for different endpoints
const rateLimits = {
  // General API rate limit
  general: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    100, // limit each IP to 100 requests per windowMs
    'Too many requests, please try again later'
  ),

  // Stricter rate limit for auth endpoints
  auth: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    10, // limit each IP to 10 auth requests per windowMs
    'Too many authentication attempts, please try again later'
  ),

  // Rate limit for file uploads
  upload: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    20, // limit each IP to 20 uploads per windowMs
    'Too many upload requests, please try again later'
  ),

  // Rate limit for message sending
  messages: createRateLimit(
    1 * 60 * 1000, // 1 minute
    30, // limit each IP to 30 messages per minute
    'Too many messages, please slow down'
  )
};

// Security middleware configuration
const securityMiddleware = (app) => {
  // Enable compression
  app.use(compression());

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false
  }));

  // Apply general rate limiting to all requests
  app.use('/api/', rateLimits.general);

  // Apply specific rate limits
  app.use('/api/users/login', rateLimits.auth);
  app.use('/api/upload/', rateLimits.upload);
  app.use('/api/chat/messages', rateLimits.messages);
};

module.exports = {
  securityMiddleware,
  rateLimits
};
