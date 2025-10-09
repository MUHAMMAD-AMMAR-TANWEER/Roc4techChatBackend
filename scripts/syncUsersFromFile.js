const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const LOCAL_API_URL = process.env.LOCAL_API_URL || 'http://localhost:4000/api/users/bulk-sync';
const ADMIN_TOKEN = process.env.ADMIN_JWT_TOKEN;

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
    user_type: isInternal ? 'technician' : 'client', // Internal = Client, Portal = Technician
    full_name: odooUser.name || odooUser.partner_name,
    email: odooUser.email || null,
    avatar_url: null,
    is_active: odooUser.active !== false,
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
 * Sync users to local database (one by one using /sync endpoint)
 */
async function syncUsersToLocal(mappedUsers) {
  console.log('📤 Syncing users to local database...');

  // Use the /sync endpoint which doesn't require auth
  const syncEndpoint = LOCAL_API_URL.replace('/bulk-sync', '/sync');
  console.log(`   Using endpoint: ${syncEndpoint}\n`);

  const results = {
    synced_count: 0,
    error_count: 0,
    errors: []
  };

  // Sync users one by one
  for (let i = 0; i < mappedUsers.length; i++) {
    const user = mappedUsers[i];

    process.stdout.write(`\r   Progress: ${i + 1}/${mappedUsers.length} - ${user.username || user.full_name}...`);

    try {
      await axios.post(syncEndpoint, user, {
        headers: { 'Content-Type': 'application/json' }
      });

      results.synced_count++;
    } catch (error) {
      results.error_count++;
      results.errors.push({
        user: user,
        error: error.response?.data?.error || error.message
      });
    }
  }

  console.log('\n');
  console.log('✅ Sync completed!');
  console.log(`   Synced: ${results.synced_count} users`);
  console.log(`   Errors: ${results.error_count} users\n`);

  if (results.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    results.errors.slice(0, 10).forEach((err, idx) => {
      console.log(`   ${idx + 1}. ${err.user.username || err.user.full_name}: ${err.error}`);
    });
    if (results.errors.length > 10) {
      console.log(`   ... and ${results.errors.length - 10} more errors`);
    }
    console.log('');
  }

  return results;
}

/**
 * Main execution function
 */
async function main(jsonFilePath) {
  console.log('🔄 Starting User Sync from File\n');
  console.log('=' .repeat(60));

  try {
    // Read JSON file
    console.log(`📖 Reading user data from: ${jsonFilePath}`);
    const fileContent = fs.readFileSync(jsonFilePath, 'utf8');
    const data = JSON.parse(fileContent);

    // Extract users array (handle different JSON structures)
    let odooUsers = [];
    if (Array.isArray(data)) {
      odooUsers = data;
    } else if (data.users && Array.isArray(data.users)) {
      odooUsers = data.users;
    } else if (data.result && Array.isArray(data.result)) {
      odooUsers = data.result;
    } else {
      throw new Error('Could not find users array in JSON file. Expected { users: [...] } or [...] format');
    }

    console.log(`✅ Found ${odooUsers.length} users in file\n`);

    if (odooUsers.length === 0) {
      console.log('⚠️  No users found in file. Exiting...');
      return;
    }

    // Map users to local format
    console.log('🔄 Mapping users to local format...');
    const mappedUsers = odooUsers.map(mapOdooUserToLocal);

    // Count clients vs technicians
    const clients = mappedUsers.filter(u => u.user_type === 'client');
    const technicians = mappedUsers.filter(u => u.user_type === 'technician');

    console.log(`   ✓ Mapped ${clients.length} clients (Internal Users)`);
    console.log(`   ✓ Mapped ${technicians.length} technicians (Portal Users)\n`);

    // Sync to local database
    const syncResult = await syncUsersToLocal(mappedUsers);

    // Display summary
    console.log('=' .repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Users in File:     ${odooUsers.length}`);
    console.log(`Successfully Synced:     ${syncResult.synced_count}`);
    console.log(`Failed to Sync:          ${syncResult.error_count}`);
    console.log(`Clients (Internal):      ${clients.length}`);
    console.log(`Technicians (Portal):    ${technicians.length}`);
    console.log('=' .repeat(60));
    console.log('✅ Sync process completed!\n');

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ File not found: ${jsonFilePath}`);
    } else if (error instanceof SyntaxError) {
      console.error('\n❌ Invalid JSON format in file');
    } else {
      console.error('\n❌ Sync process failed:', error.message);
    }
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node syncUsersFromFile.js <path-to-users.json>');
  console.log('\nExpected JSON format:');
  console.log('  { "users": [...] }  or  [...]');
  console.log('\nExample:');
  console.log('  node syncUsersFromFile.js data/odoo_users.json');
  process.exit(1);
}

const jsonFilePath = path.resolve(args[0]);
main(jsonFilePath);
