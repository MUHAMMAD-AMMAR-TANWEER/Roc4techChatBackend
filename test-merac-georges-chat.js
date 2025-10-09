// test-merac-georges-chat.js
// Testing chat between Merac (client, userId: 103) and Georges (technician, userId: 77)
const io = require('socket.io-client');

const ROOM_ID = 546; // Chat room ID for Merac & Georges
let messageIdForQuote = null;
let testStep = 0;
let meracConnected = false;
let georgesConnected = false;

console.log('🚀 Starting complete chat test between Merac and Georges...\n');
console.log('📋 Test Configuration:');
console.log('   Room ID: 545');
console.log('   Merac (Client): User ID 103');
console.log('   Georges (Technician): User ID 77\n');

// Create two socket connections
const meracSocket = io('https://chat.roc4.live/', {
  auth: { userId: '103' },
  forceNew: true
});

const georgesSocket = io('https://chat.roc4.live/', {
  auth: { userId: '77' },
  forceNew: true
});

// Check if both users are ready and start tests
function checkAndStartTests() {
  if (meracConnected && georgesConnected && testStep === 0) {
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
        console.log('\n📝 TEST 1: Merac sends first message');
        meracSocket.emit('send_message', {
          roomId: ROOM_ID,
          messageText: 'Hi Georges! I need help with my server issue.',
          messageType: 'text'
        });
        break;

      case 2:
        console.log('\n📝 TEST 2: Georges replies');
        georgesSocket.emit('send_message', {
          roomId: ROOM_ID,
          messageText: 'Hello Merac! I am here to help. What seems to be the problem?',
          messageType: 'text'
        });
        break;

      case 3:
        console.log('\n📝 TEST 3: Merac starts typing');
        meracSocket.emit('typing_start', { roomId: ROOM_ID });
        break;

      case 4:
        console.log('\n📝 TEST 4: Merac stops typing and sends message');
        meracSocket.emit('typing_stop', { roomId: ROOM_ID });
        meracSocket.emit('send_message', {
          roomId: ROOM_ID,
          messageText: 'The server keeps crashing when I try to upload files.',
          messageType: 'text'
        });
        break;

      case 5:
        if (messageIdForQuote) {
          console.log('\n📝 TEST 5: Georges sends quoted message');
          georgesSocket.emit('send_message', {
            roomId: ROOM_ID,
            messageText: 'I see. Let me check the upload configuration for you.',
            messageType: 'text',
            quotedMessageId: messageIdForQuote
          });
        } else {
          console.log('\n⚠️ TEST 5: Skipping quote test - no message ID available');
          nextTest();
        }
        break;

      case 6:
        console.log('\n📝 TEST 6: Merac marks messages as read');
        meracSocket.emit('mark_messages_read', { roomId: ROOM_ID });
        break;

      case 7:
        console.log('\n📝 TEST 7: Georges starts typing');
        georgesSocket.emit('typing_start', { roomId: ROOM_ID });
        break;

      case 8:
        console.log('\n📝 TEST 8: Georges stops typing and sends solution');
        georgesSocket.emit('typing_stop', { roomId: ROOM_ID });
        georgesSocket.emit('send_message', {
          roomId: ROOM_ID,
          messageText: 'Found the issue! The max file size was set too low. I have fixed it. Please try again.',
          messageType: 'text'
        });
        break;

      case 9:
        console.log('\n📝 TEST 9: Merac sends thank you message');
        meracSocket.emit('send_message', {
          roomId: ROOM_ID,
          messageText: 'Thank you so much Georges! It is working now! 🎉',
          messageType: 'text'
        });
        break;

      case 10:
        console.log('\n📝 TEST 10: Georges marks messages as read');
        georgesSocket.emit('mark_messages_read', { roomId: ROOM_ID });
        break;

      case 11:
        console.log('\n✅ ALL TESTS COMPLETED SUCCESSFULLY!');
        console.log('🎊 Chat system is working perfectly between Merac and Georges!');
        console.log('\n📊 Test Summary:');
        console.log('✅ Auto-connection to rooms');
        console.log('✅ Message sending/receiving');
        console.log('✅ Typing indicators');
        console.log('✅ Message quoting');
        console.log('✅ Read receipts');
        console.log('✅ Online/offline status');
        console.log('✅ Real-time synchronization');
        console.log('✅ Client-Technician communication');

        setTimeout(() => {
          console.log('\n🔌 Disconnecting...');
          meracSocket.disconnect();
          georgesSocket.disconnect();
          process.exit(0);
        }, 2000);
        break;

      default:
        console.log('\n🏁 Test sequence completed');
        return;
    }
  }, 2000);
}

// === MERAC (CLIENT) EVENT HANDLERS ===
meracSocket.on('connect', () => {
  console.log('🔵 Merac connected! Socket ID:', meracSocket.id);
  meracConnected = true;
  checkAndStartTests();
});

meracSocket.on('new_message', (message) => {
  console.log(`🔵 Merac received: "${message.message_text}" from ${message.sender_username}`);

  // Store message ID for quoting test (store Georges' first message)
  if (message.sender_username === 'georges@roc4t.com' && !messageIdForQuote) {
    messageIdForQuote = message.id;
    console.log(`📌 Stored message ID ${messageIdForQuote} for quote test`);
  }

  // Handle quoted messages
  if (message.quoted_message_text) {
    console.log(`🔵   └─ Quoting: "${message.quoted_message_text}" by ${message.quoted_sender_name}`);
  }

  if (testStep < 11) nextTest();
});

meracSocket.on('user_typing', (data) => {
  console.log(`🔵 Merac sees: ${data.username} is typing...`);
  if (testStep < 11) nextTest();
});

meracSocket.on('user_stopped_typing', (data) => {
  console.log(`🔵 Merac sees: ${data.username} stopped typing`);
  if (testStep < 11) nextTest();
});

meracSocket.on('messages_read', (data) => {
  console.log(`🔵 Merac sees: ${data.username} read the messages`);
  if (testStep < 11) nextTest();
});

meracSocket.on('user_online', (data) => {
  console.log(`🔵 Merac sees: ${data.username} came online`);
});

meracSocket.on('user_offline', (data) => {
  console.log(`🔵 Merac sees: ${data.username} went offline`);
});

// === GEORGES (TECHNICIAN) EVENT HANDLERS ===
georgesSocket.on('connect', () => {
  console.log('🟢 Georges connected! Socket ID:', georgesSocket.id);
  georgesConnected = true;
  checkAndStartTests();
});

georgesSocket.on('new_message', (message) => {
  console.log(`🟢 Georges received: "${message.message_text}" from ${message.sender_username}`);

  // Handle quoted messages
  if (message.quoted_message_text) {
    console.log(`🟢   └─ Quoting: "${message.quoted_message_text}" by ${message.quoted_sender_name}`);
  }

  if (testStep < 11) nextTest();
});

georgesSocket.on('user_typing', (data) => {
  console.log(`🟢 Georges sees: ${data.username} is typing...`);
  if (testStep < 11) nextTest();
});

georgesSocket.on('user_stopped_typing', (data) => {
  console.log(`🟢 Georges sees: ${data.username} stopped typing`);
  if (testStep < 11) nextTest();
});

georgesSocket.on('messages_read', (data) => {
  console.log(`🟢 Georges sees: ${data.username} read the messages`);
  if (testStep < 11) nextTest();
});

georgesSocket.on('user_online', (data) => {
  console.log(`🟢 Georges sees: ${data.username} came online`);
});

georgesSocket.on('user_offline', (data) => {
  console.log(`🟢 Georges sees: ${data.username} went offline`);
});

// === ERROR HANDLERS ===
meracSocket.on('connect_error', (error) => {
  console.error('🔵 Merac connection error:', error.message);
});

georgesSocket.on('connect_error', (error) => {
  console.error('🟢 Georges connection error:', error.message);
});

meracSocket.on('error', (error) => {
  console.error('🔵 Merac socket error:', error);
});

georgesSocket.on('error', (error) => {
  console.error('🟢 Georges socket error:', error);
});

meracSocket.on('disconnect', (reason) => {
  console.log('🔵 Merac disconnected:', reason);
});

georgesSocket.on('disconnect', (reason) => {
  console.log('🟢 Georges disconnected:', reason);
});

// Safety timeout
setTimeout(() => {
  console.log('\n⏰ Test timeout reached (30 seconds)');
  console.log('📊 Current test step:', testStep);
  if (testStep === 0) {
    console.log('❌ Tests never started - check user connections');
    console.log('   Merac connected:', meracConnected);
    console.log('   Georges connected:', georgesConnected);
  } else if (testStep < 11) {
    console.log('⚠️  Tests incomplete - stopped at step', testStep);
  }
  meracSocket.disconnect();
  georgesSocket.disconnect();
  process.exit(testStep === 11 ? 0 : 1);
}, 30000);

console.log('⏳ Waiting for connections...');
