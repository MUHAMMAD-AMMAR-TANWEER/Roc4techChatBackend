const axios = require('axios');

class OdooSessionManager {
  constructor() {
    this.session = null;
    this.baseUrl = process.env.ODOO_BASE_URL || 'http://127.0.0.1:8069';
    this.db = process.env.ODOO_DB || 'Roc4_Production';
    this.login = process.env.ODOO_LOGIN || 'merac';
    this.password = process.env.ODOO_PASSWORD || '123';
    this.sessionRefreshInterval = null;
    
    // Auto-create session on initialization
    this.createSession();
    
    // Refresh session every 30 minutes
    this.sessionRefreshInterval = setInterval(() => {
      this.createSession();
    }, 30 * 60 * 1000);
  }

  async createSession() {
    try {
      console.log('[ODOO SESSION] 🔄 Creating/refreshing session...');
      
      const response = await axios.post(
        `${this.baseUrl}/web/session/authenticate`,
        {
          jsonrpc: "2.0",
          params: {
            db: this.db,
            login: this.login,
            password: this.password
          }
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      // Extract session from Set-Cookie header
      if (response.headers['set-cookie']) {
        const sessionCookie = response.headers['set-cookie']
          .find(cookie => cookie.startsWith('session_id='));
        
        if (sessionCookie) {
          this.session = sessionCookie.split(';')[0]; // Get just "session_id=xxx"
          console.log('[ODOO SESSION] ✅ Session created/refreshed');
          return true;
        }
      }
      
      console.error('[ODOO SESSION] ❌ No session cookie received');
      return false;
    } catch (error) {
      console.error('[ODOO SESSION] ❌ Session creation failed:', error.message);
      return false;
    }
  }

  async getSession() {
    // If no session exists, create one
    if (!this.session) {
      await this.createSession();
    }
    return this.session;
  }

  async callOdooAPI(endpoint, payload, method = 'POST') {
    try {
      const session = await this.getSession();
      
      if (!session) {
        throw new Error('Failed to get Odoo session');
      }

      console.log(`[ODOO API] 📤 Calling: ${endpoint}`);
      
      const response = await axios({
        method: method,
        url: `${this.baseUrl}${endpoint}`,
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': session
        },
        timeout: 10000
      });

      console.log(`[ODOO API] ✅ Response received`);
      return response.data;

    } catch (error) {
      console.error(`[ODOO API] ❌ Error calling ${endpoint}:`, error.message);
      
      // If authentication failed, try refreshing session once
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.log('[ODOO API] 🔄 Session expired, refreshing...');
        await this.createSession();
        
        // Retry the request once
        try {
          const session = await this.getSession();
          const retryResponse = await axios({
            method: method,
            url: `${this.baseUrl}${endpoint}`,
            data: payload,
            headers: {
              'Content-Type': 'application/json',
              'Cookie': session
            },
            timeout: 10000
          });
          
          console.log(`[ODOO API] ✅ Retry successful`);
          return retryResponse.data;
        } catch (retryError) {
          console.error(`[ODOO API] ❌ Retry failed:`, retryError.message);
          throw retryError;
        }
      }
      
      throw error;
    }
  }

  destroy() {
    if (this.sessionRefreshInterval) {
      clearInterval(this.sessionRefreshInterval);
    }
  }
}

// Create singleton instance
const odooSessionManager = new OdooSessionManager();

module.exports = odooSessionManager;