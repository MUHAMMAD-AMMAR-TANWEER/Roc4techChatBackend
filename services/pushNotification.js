// services/pushNotification.js
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    const serviceAccount = require('../config/firebase-service-account.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    
    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('📝 Push notifications will be disabled');
  }
}

// Initialize on module load
initializeFirebase();

/**
 * Send push notification to a single device
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    if (!firebaseInitialized) {
      console.log('⚠️ Firebase not initialized, skipping notification');
      return null;
    }

    if (!fcmToken) {
      console.log('⚠️ No FCM token provided');
      return null;
    }

    console.log(`📱 Sending notification to: ${fcmToken.substring(0, 20)}...`);

    console.log("Here is complete data... ",data)

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        // Convert all data values to strings (FCM requirement)
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      token: fcmToken,
      
      // Android specific configuration
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#2196F3',
          sound: 'default',
          channelId: 'chat_messages',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true
        },
        priority: 'high',
        ttl: 10 // 1 hour
      },
      
      // iOS specific configuration
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true,
            mutableContent: true,
            alert: {
              title: title,
              body: body
            }
          }
        },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert'
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent successfully:', response);
    return { success: true, messageId: response };

  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    
    // Handle invalid/expired tokens
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.log('🗑️ Invalid FCM token, should remove from database:', fcmToken);
      return { 
        success: false, 
        error: 'invalid_token', 
        token: fcmToken,
        shouldRemoveToken: true 
      };
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Send notification to multiple devices
 */
async function sendMulticastNotification(fcmTokens, title, body, data = {}) {
  try {
    if (!firebaseInitialized) {
      console.log('⚠️ Firebase not initialized, skipping notifications');
      return null;
    }

    const validTokens = fcmTokens.filter(token => token && token.trim() !== '');
    
    if (validTokens.length === 0) {
      console.log('⚠️ No valid FCM tokens found');
      return null;
    }

    console.log(`📱 Sending notifications to ${validTokens.length} devices`);

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      tokens: validTokens,
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#2196F3',
          sound: 'default',
          channelId: 'chat_messages'
        },
        priority: 'high'
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true
          }
        }
      }
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log(`✅ Multicast sent. Success: ${response.successCount}, Failed: ${response.failureCount}`);
    
    // Handle failed tokens
    const failedTokens = [];
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(validTokens[idx]);
          console.error('❌ Failed token:', validTokens[idx], resp.error?.code);
        }
      });
    }
    
    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens 
    };

  } catch (error) {
    console.error('❌ Error sending multicast notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Test notification function
 */
async function sendTestNotification(fcmToken) {
  return await sendPushNotification(
    fcmToken,
    '🧪 Test Notification',
    'If you see this, push notifications are working correctly!',
    { 
      test: 'true',
      timestamp: Date.now().toString()
    }
  );
}

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
  sendTestNotification
};