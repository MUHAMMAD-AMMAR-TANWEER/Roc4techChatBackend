// debug.js
const io = require('socket.io-client');

console.log('🚀 Starting socket test...');

const socket = io('http://localhost:4000', { 
  auth: { userId: '1' },
  forceNew: true
});

socket.on('connect', () => {
  console.log('✅ Socket connected! ID:', socket.id);
  console.log('🔄 Joining room 2...');
  socket.emit('join_room', { roomId: 2 });
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});

// Listen for ALL possible responses
socket.on('room_joined', (data) => {
  console.log('✅ Successfully joined room:', data);
});

socket.on('error', (error) => {
  console.error('❌ Socket error from server:', error);
});

socket.on('recent_messages', (messages) => {
  console.log('📜 Recent messages:', messages.length);
});

// Add timeout with more info
setTimeout(() => {
  console.log('⏰ No room_joined response - checking server logs');
  process.exit(1);
}, 5000);