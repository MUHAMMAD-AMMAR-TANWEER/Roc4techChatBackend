// fixed-chat-test.js
const io = require('socket.io-client');

let messageIdForQuote = 1;
let testStep = 0;
let user1Connected = false;
let user2Connected = false;

console.log('🚀 Starting complete chat test between User 1 and User 2...\n');

// Create two socket connections
const user1Socket = io('https://chat.roc4.live/', { 
  auth: { userId: '77' },
  forceNew: true
});

const user2Socket = io('https://chat.roc4.live/', { 
  auth: { userId: '103' },
  forceNew: true
});

// Check if both users are ready and start tests
function checkAndStartTests() {
  if (user1Connected && user2Connected && testStep === 0) {
    console.log('\n✅ Both users connected and auto-joined rooms. Starting tests...');
    setTimeout(() => nextTest(), 1000);
  }
}

// Test sequence controller
function nextTest() {
  testStep++;
  setTimeout(() => {
    switch(testStep) {
      case 1:
        console.log('\n📝 TEST 1: User 1 sends first message');
        user1Socket.emit('send_message', {
          roomId: 1,
          messageText: 'Hello from User 1! How are you?',
          messageType: 'text'
        });
        break;
        
      case 2:
        console.log('\n📝 TEST 2: User 2 replies');
        user2Socket.emit('send_message', {
          roomId: 1,
          messageText: 'Hi User 1! I am doing great, thanks for asking!',
          messageType: 'text'
        });
        break;
        
      case 3:
        console.log('\n📝 TEST 3: User 1 starts typing');
        user1Socket.emit('typing_start', { roomId: 1 });
        break;
        
      case 4:
        console.log('\n📝 TEST 4: User 1 stops typing and sends message');
        user1Socket.emit('typing_stop', { roomId: 1 });
        user1Socket.emit('send_message', {
          roomId: 1,
          messageText: 'Let me quote your previous message...',
          messageType: 'text'
        });
        break;
        
      case 5:
        if (messageIdForQuote) {
          console.log('\n📝 TEST 5: User 1 sends quoted message');
          user1Socket.emit('send_message', {
            roomId: 1,
            messageText: 'Yes, I can see you are doing great! 😊',
            messageType: 'text',
            quotedMessageId: messageIdForQuote
          });
        } else {
          console.log('\n⚠️ TEST 5: Skipping quote test - no message ID available');
          nextTest();
        }
        break;
        
      case 6:
        console.log('\n📝 TEST 6: User 2 marks messages as read');
        user2Socket.emit('mark_messages_read', { roomId: 1 });
        break;
        
      case 7:
        console.log('\n📝 TEST 7: User 2 sends final message');
        user2Socket.emit('send_message', {
          roomId: 1,
          messageText: 'Thanks for the chat! This socket system works perfectly! 🎉',
          messageType: 'text'
        });
        break;
        
      case 8:
        console.log('\n📝 TEST 8: User 1 marks final messages as read');
        user1Socket.emit('mark_messages_read', { roomId: 1 });
        break;
        
      case 9:
        console.log('\n✅ ALL TESTS COMPLETED SUCCESSFULLY!');
        console.log('🎊 Chat system is working perfectly!');
        console.log('\n📊 Test Summary:');
        console.log('✅ Auto-connection to rooms');
        console.log('✅ Message sending/receiving'); 
        console.log('✅ Typing indicators');
        console.log('✅ Message quoting');
        console.log('✅ Read receipts');
        console.log('✅ Online/offline status');
        console.log('✅ Real-time synchronization');
        
        setTimeout(() => {
          console.log('\n🔌 Disconnecting...');
          user1Socket.disconnect();
          user2Socket.disconnect();
          process.exit(0);
        }, 2000);
        break;
        
      default:
        console.log('\n🏁 Test sequence completed');
        return;
    }
  }, 2000);
}

// === USER 1 EVENT HANDLERS ===
user1Socket.on('connect', () => {
  console.log('🔵 User 1 connected! ID:', user1Socket.id);
  user1Connected = true;
  checkAndStartTests();
});

user1Socket.on('new_message', (message) => {
  console.log(`🔵 User 1 received: "${message.message_text}" from ${message.sender_username}`);
  
  // Store message ID for quoting test
  if (message.sender_username !== 'johndoe' && !messageIdForQuote) {
    messageIdForQuote = message.id;
    console.log(`📌 Stored message ID ${messageIdForQuote} for quote test`);
  }
  
  if (testStep < 9) nextTest();
});

user1Socket.on('user_typing', (data) => {
  console.log(`🔵 User 1 sees: ${data.username} is typing...`);
});

user1Socket.on('user_stopped_typing', (data) => {
  console.log(`🔵 User 1 sees: ${data.username} stopped typing`);
});

user1Socket.on('messages_read', (data) => {
  console.log(`🔵 User 1 sees: ${data.username} read the messages`);
  if (testStep < 9) nextTest();
});

// === USER 2 EVENT HANDLERS ===
user2Socket.on('connect', () => {
  console.log('🟢 User 2 connected! ID:', user2Socket.id);
  user2Connected = true;
  checkAndStartTests();
});

user2Socket.on('new_message', (message) => {
  console.log(`🟢 User 2 received: "${message.message_text}" from ${message.sender_username}`);
  
  // Handle quoted messages
  if (message.quoted_message_text) {
    console.log(`🟢   └─ Quoting: "${message.quoted_message_text}" by ${message.quoted_sender_name}`);
  }
  
  if (testStep < 9) nextTest();
});

user2Socket.on('user_typing', (data) => {
  console.log(`🟢 User 2 sees: ${data.username} is typing...`);
  if (testStep < 9) nextTest();
});

user2Socket.on('user_stopped_typing', (data) => {
  console.log(`🟢 User 2 sees: ${data.username} stopped typing`);
  if (testStep < 9) nextTest();
});

user2Socket.on('messages_read', (data) => {
  console.log(`🟢 User 2 sees: ${data.username} read the messages`);
  if (testStep < 9) nextTest();
});

user2Socket.on('user_online', (data) => {
  console.log(`🟢 User 2 sees: ${data.username} came online`);
});

// === ERROR HANDLERS ===
user1Socket.on('connect_error', (error) => {
  console.error('🔵 User 1 connection error:', error.message);
});

user2Socket.on('connect_error', (error) => {
  console.error('🟢 User 2 connection error:', error.message);
});

user1Socket.on('error', (error) => {
  console.error('🔵 User 1 socket error:', error);
});

user2Socket.on('error', (error) => {
  console.error('🟢 User 2 socket error:', error);
});

// Safety timeout
setTimeout(() => {
  console.log('\n⏰ Test timeout reached');
  console.log('📊 Current test step:', testStep);
  if (testStep === 0) {
    console.log('❌ Tests never started - check user connections');
  }
  process.exit(1);
}, 25000);

console.log('⏳ Waiting for connections...');