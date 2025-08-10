const validator = {
  // Validate email format
  isValidEmail: (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  // Validate internal user ID format
  isValidInternalUserId: (id) => {
    return typeof id === 'string' && id.trim().length > 0 && id.length <= 100;
  },

  // Validate username format
  isValidUsername: (username) => {
    const usernameRegex = /^[a-zA-Z0-9_-]{3,50}$/;
    return usernameRegex.test(username);
  },

  // Validate user type
  isValidUserType: (userType) => {
    return ['client', 'technician', 'admin'].includes(userType);
  },

  // Validate message type
  isValidMessageType: (messageType) => {
    return ['text', 'image', 'file', 'audio'].includes(messageType);
  },

  // Validate pagination parameters
  validatePagination: (page, limit) => {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    
    return {
      page: Math.max(1, pageNum),
      limit: Math.min(100, Math.max(1, limitNum)), // Max 100 items per page
      offset: (Math.max(1, pageNum) - 1) * Math.min(100, Math.max(1, limitNum))
    };
  },

  // Sanitize text input
  sanitizeText: (text) => {
    if (typeof text !== 'string') return '';
    return text.trim().substring(0, 10000); // Max 10k characters
  },

  // Validate file upload
  validateFile: (file) => {
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
      'application/zip', 'application/x-rar-compressed'
    ];

    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'File too large (max 50MB)' };
    }

    if (!allowedTypes.includes(file.mimetype)) {
      return { valid: false, error: 'File type not allowed' };
    }

    return { valid: true };
  }
};

module.exports = validator;