# Chat System Backend

A real-time chat system for client-technician communication with admin monitoring capabilities.

## Features

- 🔐 **User Authentication & Authorization**
- 💬 **Real-time Messaging** with Socket.io
- 📎 **File Upload Support** (DigitalOcean Spaces)
- 📱 **Push Notifications** (Firebase)
- 👨‍💼 **Admin Dashboard APIs**
- 📊 **Analytics & Monitoring**
- 🔍 **Message Search & Export**
- ✅ **WhatsApp-style Message Quoting**

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Database Setup
- Create PostgreSQL database named `chat_system`
- Run the provided schema SQL
- Verify setup: `node scripts/setup.js`

### 4. Firebase Setup (Optional)
- Download `firebase-service-account.json` from Firebase Console
- Place in `config/` directory
- Configure push notifications

### 5. Start Server
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Authentication
- `POST /api/users/login` - User login
- `POST /api/users/logout` - User logout
- `POST /api/users/update-fcm-token` - Update FCM token

### User Management
- `POST /api/users/sync` - Sync single user
- `POST /api/users/bulk-sync` - Sync multiple users
- `GET /api/users` - Get all users (paginated)
- `GET /api/users/internal/:id` - Get user by internal ID

### Chat Operations
- `POST /api/chat/rooms/create` - Create/get chat room
- `GET /api/chat/rooms` - Get user's chat rooms
- `GET /api/chat/rooms/:id/messages` - Get room messages
- `POST /api/chat/messages` - Send message
- `POST /api/chat/messages/read` - Mark messages as read
- `GET /api/chat/unread-count` - Get unread count
- `GET /api/chat/search` - Search messages

### Task Management
- `POST /api/chat/tasks/sync` - Sync single task
- `POST /api/chat/tasks/bulk-sync` - Sync multiple tasks
- `GET /api/chat/tasks/:id` - Get task by ID

### File Upload
- `POST /api/upload/file` - Upload single file
- `POST /api/upload/files` - Upload multiple files
- `DELETE /api/upload/file` - Delete file
- `GET /api/upload/stats` - Upload statistics (admin)

### Admin APIs
- `GET /api/admin/rooms` - Get all chat rooms
- `GET /api/admin/rooms/:id/messages` - Get room messages
- `GET /api/admin/search` - Search all messages
- `GET /api/admin/stats` - System statistics
- `GET /api/admin/users/activity` - User activity report
- `GET /api/admin/export/:roomId` - Export room messages
- `GET /api/admin/export` - Export all messages
- `DELETE /api/admin/messages/:id` - Delete message

## Socket.io Events

### Client Events
- `join_room` - Join a chat room
- `send_message` - Send a message
- `mark_messages_read` - Mark messages as read
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator
- `get_message_for_quote` - Get message for quoting

### Server Events
- `room_joined` - Successfully joined room
- `new_message` - New message received
- `recent_messages` - Recent messages on room join
- `messages_read` - Messages marked as read
- `user_typing` - User typing indicator
- `user_stopped_typing` - User stopped typing
- `user_online` - User came online
- `user_offline` - User went offline
- `message_for_quote` - Message details for quoting
- `error` - Error occurred

## Database Schema

### Users Table
```sql
- id (SERIAL PRIMARY KEY)
- internal_user_id (VARCHAR UNIQUE) -- Your system's user ID
- username (VARCHAR)
- user_type (client|technician|admin)
- full_name (VARCHAR)
- email (VARCHAR)
- fcm_token (TEXT) -- For push notifications
- is_online (BOOLEAN)
- is_active (BOOLEAN)
- external_data (JSONB) -- Additional data from your system
```

### Tasks Table
```sql
- id (SERIAL PRIMARY KEY)
- internal_task_id (VARCHAR UNIQUE) -- Your system's task ID
- task_name (VARCHAR)
- description (TEXT)
- external_data (JSONB)
```

### Chat Rooms Table
```sql
- id (SERIAL PRIMARY KEY)
- client_id (INTEGER) -- References users(id)
- technician_id (INTEGER) -- References users(id)
- task_id (INTEGER) -- References tasks(id)
- room_name (VARCHAR)
- is_active (BOOLEAN)
- last_message_at (TIMESTAMP)
- UNIQUE(client_id, technician_id, task_id)
```

### Messages Table
```sql
- id (SERIAL PRIMARY KEY)
- room_id (INTEGER) -- References chat_rooms(id)
- sender_id (INTEGER) -- References users(id)
- message_text (TEXT)
- message_type (text|image|file|audio)
- file_url (TEXT)
- file_name (VARCHAR)
- file_size (INTEGER)
- is_read (BOOLEAN)
- quoted_message_id (INTEGER) -- For message quoting
- quoted_message_text (TEXT)
- quoted_sender_name (VARCHAR)
- created_at (TIMESTAMP)
```

## Configuration

### Environment Variables
```bash
# Database
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=chat_system
DB_PORT=5432

# JWT
JWT_SECRET=your_jwt_secret

# Server
PORT=4000
NODE_ENV=development

# DigitalOcean Spaces
DO_SPACES_ENDPOINT=fra1.digitaloceanspaces.com
DO_SPACES_KEY=your_key
DO_SPACES_SECRET=your_secret
DO_SPACES_BUCKET=your_bucket

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Firebase Setup
1. Create Firebase project
2. Generate service account key
3. Download JSON file to `config/firebase-service-account.json`
4. Enable Cloud Messaging

### DigitalOcean Spaces Setup
1. Create Spaces bucket
2. Generate API keys
3. Configure CORS for your domain
4. Set bucket to public-read for file access

## Security Features

- **Rate Limiting**: Prevents abuse
- **CORS Protection**: Configurable origins
- **Helmet Security**: Security headers
- **JWT Authentication**: Secure token-based auth
- **Input Validation**: Sanitized inputs
- **File Upload Validation**: Type and size limits

## Monitoring & Logging

- **Structured Logging**: JSON format logs
- **Error Tracking**: Dedicated error logs
- **Performance Monitoring**: Database connection pooling
- **Health Checks**: `/health` endpoint

## Deployment

### Production Checklist
- [ ] Update JWT_SECRET to secure value
- [ ] Configure production database
- [ ] Set up SSL certificates
- [ ] Configure reverse proxy (nginx)
- [ ] Set up monitoring
- [ ] Configure log rotation
- [ ] Set NODE_ENV=production

### Docker Support (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["npm", "start"]
```

## API Examples

### Create Chat Room
```javascript
POST /api/chat/rooms/create
{
  "client_internal_id": "CLIENT_001",
  "technician_internal_id": "TECH_001", 
  "task_internal_id": "TASK_001"
}
```

### Send Message
```javascript
POST /api/chat/messages
{
  "room_id": 1,
  "message_text": "Hello, I need help with login",
  "message_type": "text"
}
```

### Send Message with Quote
```javascript
POST /api/chat/messages
{
  "room_id": 1,
  "message_text": "Yes, I see that error",
  "message_type": "text",
  "quoted_message_id": 123
}
```

## Support

For issues and questions:
- Check logs in `logs/` directory
- Verify database connection
- Check environment variables
- Review API documentation

## License

MIT License - see LICENSE file for details
