const axios = require('axios');
const https = require('https');

// --- Configuration ---
const API_URL = 'http://127.0.0.1:8069/web/database/mobile_api/api/chat/sync_message'; 
const PAYLOAD = {
    message_id: 305,
    internal_task_id: 343,
    sender: "George",
    sender_internal_id: 77,
    message_text: "hello"
};

// --- Axios Instance with HTTPS Agent ---
// This replicates the 'rejectUnauthorized: false' from your original code.
// Note: Only use this if you know your server's SSL certificate is self-signed or invalid.
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ 
        rejectUnauthorized: false // WARNING: Disables SSL certificate verification
    })
});

// --- Function to Call the API ---
async function syncMessageTest() {
    console.log(`\n======================================================`);
    console.log(`📤 Sending POST request to: ${API_URL}`);
    console.log(`📦 Payload: ${JSON.stringify(PAYLOAD)}`);
    console.log(`======================================================`);

    try {



        const response = await axios.post(
  API_URL,
  PAYLOAD,
  {
    headers: { 
      'Content-Type': 'application/json',
      'X-Openerp-Session-Id': 'session_id',  // ✅ Add this
      'Cookie': 'session_id=; db=mobile_api'  // ✅ Or this
    },
    timeout: 10000
  }
);
 

        // --- SUCCESS RESPONSE ---
        console.log(`\n✅ API Call Succeeded!`);
        console.log(`Status: ${response.status} (${response.statusText})`);
        console.log('Response Data:');
        console.log(response.data);
        console.log(`======================================================\n`);

    } catch (error) {
        // --- ERROR RESPONSE ---
        console.log(`\n❌ API Call FAILED!`);
        
        if (error.response) {
            // The server responded with a status code outside of 2xx (e.g., 404, 500)
            console.error(`Status Error: Server responded with status ${error.response.status}`);
            console.error(`Status Text: ${error.response.statusText}`);
            console.error('Response Data (The server\'s error message):');
            console.error(error.response.data);
        } else if (error.request) {
            // The request was made but no response was received (e.g., timeout, DNS failure, firewall block)
            console.error('Network Error: No response received from server.');
            console.error(`Message: ${error.message}`);
            console.error(`Code: ${error.code}`);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Setup Error: Request could not be sent.');
            console.error(`Message: ${error.message}`);
        }
        console.log(`======================================================\n`);
    }
}

syncMessageTest();