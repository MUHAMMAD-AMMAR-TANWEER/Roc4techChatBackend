const axios = require('axios');
require('dotenv').config();

// Configuration
const ODOO_API_URL = process.env.ODOO_API_URL || 'https://roc4.live/api/users/list';
const ODOO_API_KEY = process.env.ODOO_API_KEY; // Optional: API key for Odoo
const ODOO_DB_NAME = process.env.ODOO_DB_NAME; // Optional: Odoo database name
const ODOO_USERNAME = process.env.ODOO_USERNAME; // Optional: Odoo username
const ODOO_PASSWORD = process.env.ODOO_PASSWORD; // Optional: Odoo password
const LOCAL_API_URL = process.env.LOCAL_API_URL || 'http://localhost:4000/api/users/bulk-sync';
const ADMIN_TOKEN = process.env.ADMIN_JWT_TOKEN; // You'll need to set this in .env

/**
 * Fetch all users from Odoo API with pagination
 */
async function fetchOdooUsers() {
  console.log('📥 Fetching users from Odoo API...');

  let allUsers = [];
  let page = 1;
  const pageSize = 40;
  let hasMorePages = true;

  try {
    while (hasMorePages) {
      console.log(`   Fetching page ${page}...`);

      // Build request headers
      const headers = {
        'Content-Type': 'application/json'
      };

      // Add authentication if provided
      if (ODOO_API_KEY) {
        headers['Authorization'] = `Bearer ${ODOO_API_KEY}`;
      }

      const requestData = {
        page: page,
        page_size: pageSize
      };

      // Add optional Odoo credentials if provided
      if (ODOO_DB_NAME) requestData.db = ODOO_DB_NAME;
      if (ODOO_USERNAME) requestData.username = ODOO_USERNAME;
      if (ODOO_PASSWORD) requestData.password = ODOO_PASSWORD;

      const response = await axios.post(ODOO_API_URL, requestData, { headers });

      const users = response.data.users;

      if (!users || users.length === 0) {
        hasMorePages = false;
      } else {
        allUsers = allUsers.concat(users);
        console.log(`   ✓ Page ${page}: ${users.length} users fetched`);
        page++;
      }

      // Safety check to prevent infinite loops
      if (page > 100) {
        console.warn('⚠️  Reached max page limit (100). Stopping pagination.');
        break;
      }
    }

    console.log(`✅ Total users fetched: ${allUsers.length}\n`);
    return allUsers;

  } catch (error) {
    console.error('❌ Error fetching Odoo users:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Check if user has "Internal User" group
 */
function isInternalUser(user) {
  if (!user.groups || !Array.isArray(user.groups)) {
    return false;
  }
  return user.groups.some(group => group.name === 'Internal User');
}

/**
 * Map Odoo user to chat system format
 */
function mapOdooUserToLocal(odooUser) {
  const isInternal = isInternalUser(odooUser);

  return {
    internal_user_id: odooUser.id.toString(),
    username: odooUser.login || odooUser.name,
    user_type: isInternal ? 'client' : 'technician', // Internal = Client, Portal = Technician
    full_name: odooUser.name || odooUser.partner_name,
    email: odooUser.email || null,
    avatar_url: null, // Odoo doesn't provide avatar in this response
    is_active: odooUser.active !== false, // Default to true if not specified
    external_data: {
      partner_id: odooUser.partner_id,
      partner_name: odooUser.partner_name,
      company_id: odooUser.company_id,
      company_name: odooUser.company_name,
      groups: odooUser.groups,
      create_date: odooUser.create_date,
      write_date: odooUser.write_date
    }
  };
}

/**
 * Sync users to local database
 */
async function syncUsersToLocal(mappedUsers) {
  console.log('📤 Syncing users to local database...');

  if (!ADMIN_TOKEN) {
    console.warn('⚠️  ADMIN_JWT_TOKEN not set in .env file');
    console.warn('   Attempting to sync without authentication...');
  }

  try {
    const headers = ADMIN_TOKEN ? {
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json'
    } : {
      'Content-Type': 'application/json'
    };

    const response = await axios.post(LOCAL_API_URL, {
      users: mappedUsers
    }, { headers });

    console.log('✅ Sync completed!');
    console.log(`   Synced: ${response.data.synced_count} users`);
    console.log(`   Errors: ${response.data.error_count} users\n`);

    if (response.data.errors && response.data.errors.length > 0) {
      console.log('⚠️  Errors encountered:');
      response.data.errors.slice(0, 5).forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.user.username || err.user.name}: ${err.error}`);
      });
      if (response.data.errors.length > 5) {
        console.log(`   ... and ${response.data.errors.length - 5} more errors`);
      }
    }

    return response.data;

  } catch (error) {
    console.error('❌ Error syncing users to local database:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🔄 Starting Odoo User Sync Process\n');
  console.log('=' .repeat(60));

  try {
    // Step 1: Fetch users from Odoo
    const odooUsers = await fetchOdooUsers();

    if (odooUsers.length === 0) {
      console.log('⚠️  No users found in Odoo. Exiting...');
      return;
    }

    // Step 2: Map users to local format
    console.log('🔄 Mapping users to local format...');
    const mappedUsers = odooUsers.map(mapOdooUserToLocal);

    // Count clients vs technicians
    const clients = mappedUsers.filter(u => u.user_type === 'client');
    const technicians = mappedUsers.filter(u => u.user_type === 'technician');

    console.log(`   ✓ Mapped ${clients.length} clients (Internal Users)`);
    console.log(`   ✓ Mapped ${technicians.length} technicians (Portal Users)\n`);

    // Step 3: Sync to local database
    const syncResult = await syncUsersToLocal(mappedUsers);

    // Step 4: Display summary
    console.log('=' .repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Users in Odoo:     ${odooUsers.length}`);
    console.log(`Successfully Synced:     ${syncResult.synced_count}`);
    console.log(`Failed to Sync:          ${syncResult.error_count}`);
    console.log(`Clients (Internal):      ${clients.length}`);
    console.log(`Technicians (Portal):    ${technicians.length}`);
    console.log('=' .repeat(60));
    console.log('✅ Sync process completed!\n');

  } catch (error) {
    console.error('\n❌ Sync process failed:', error.message);
    process.exit(1);
  }
}

// Handle command line arguments for dry-run mode
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');

if (isDryRun) {
  console.log('🔍 DRY RUN MODE - No data will be synced\n');

  fetchOdooUsers()
    .then(users => {
      const mapped = users.map(mapOdooUserToLocal);
      const clients = mapped.filter(u => u.user_type === 'client');
      const technicians = mapped.filter(u => u.user_type === 'technician');

      console.log('📊 DRY RUN RESULTS:');
      console.log(`   Total Users: ${users.length}`);
      console.log(`   Clients (Internal Users): ${clients.length}`);
      console.log(`   Technicians (Portal Users): ${technicians.length}\n`);

      console.log('Sample Clients:');
      clients.slice(0, 3).forEach(u => {
        console.log(`   - ${u.full_name} (${u.username}) [ID: ${u.internal_user_id}]`);
      });

      console.log('\nSample Technicians:');
      technicians.slice(0, 3).forEach(u => {
        console.log(`   - ${u.full_name} (${u.username}) [ID: ${u.internal_user_id}]`);
      });

      console.log('\n✅ Dry run completed. Run without --dry-run to sync data.\n');
    })
    .catch(err => {
      console.error('❌ Dry run failed:', err.message);
      process.exit(1);
    });
} else {
  // Execute the sync
  main();
}
