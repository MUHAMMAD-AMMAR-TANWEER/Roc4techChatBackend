const io = require('socket.io-client');

// Connect as a user
const socket = io('https://chat.roc4.live/', {
  auth: { userId: '77' }  // Use a real internal_user_id
});

socket.on('connect', () => {
  console.log('✅ Connected to chat server');
  
  // Send a message
  socket.emit('send_message', {
    roomId: 1,  // Use a real room ID
    messageText: 'Testing sync from mobile to Odoo!',
    messageType: 'text'
  });
  
  console.log('📤 Message sent');
  console.log('✅ Check Odoo task chatter in 2 seconds...');
  
  setTimeout(() => {
    console.log('👉 Go to Odoo and check the task chatter');
    process.exit(0);
  }, 2000);
});

socket.on('error', (error) => {
  console.error('❌ Error:', error);
});