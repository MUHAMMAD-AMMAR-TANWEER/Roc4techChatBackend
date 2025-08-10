const admin = require('firebase-admin');

// Initialize Firebase Admin (only if not already initialized)
if (!admin.apps.length) {
  try {
    const serviceAccount = require('../config/firebase-service-account.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
    console.log('📝 Push notifications will be disabled');
  }
}

/**
 * Send push notification to a single device
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    if (!admin.apps.length) {
      console.log('Firebase not initialized, skipping notification');
      return null;
    }

    if (!fcmToken) {
      console.log('No FCM token provided');
      return null;
    }

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        // Convert all data values to strings (FCM requirement)
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {})
      },
      token: fcmToken,
      // Android specific configuration
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#2196F3',
          sound: 'default',
          channelId: 'chat_messages',
          priority: 'high'
        },
        priority: 'high'
      },
      // iOS specific configuration
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true,
            mutableContent: true
          }
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('📱 Push notification sent successfully:', response);
    return response;

  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    
    // Handle invalid tokens
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.log('🗑️ Invalid FCM token, should remove from database');
      return { error: 'invalid_token', token: fcmToken };
    }
    
    throw error;
  }
}

/**
 * Send push notification to multiple devices
 */
async function sendMulticastNotification(fcmTokens, title, body, data = {}) {
  try {
    if (!admin.apps.length) {
      console.log('Firebase not initialized, skipping notifications');
      return null;
    }

    if (!fcmTokens || fcmTokens.length === 0) {
      console.log('No FCM tokens provided');
      return null;
    }

    // Filter out null/undefined tokens
    const validTokens = fcmTokens.filter(token => token && token.trim() !== '');
    
    if (validTokens.length === 0) {
      console.log('No valid FCM tokens found');
      return null;
    }

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        // Convert all data values to strings
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {})
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
    console.log(`📱 Multicast notification sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);
    
    // Log failed tokens for cleanup
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(validTokens[idx]);
          console.error('Failed to send to token:', validTokens[idx], resp.error);
        }
      });
      return { ...response, failedTokens };
    }
    
    return response;

  } catch (error) {
    console.error('❌ Error sending multicast notification:', error);
    throw error;
  }
}

module.exports = {
  sendPushNotification,
  sendMulticastNotification
};

