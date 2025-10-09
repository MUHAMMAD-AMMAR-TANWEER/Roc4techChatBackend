#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
});

async function checkUsers() {
  console.log('🔍 Checking User Database\n');
  console.log('=' .repeat(60));

  try {
    // Get user counts by type
    const countResult = await pool.query(`
      SELECT
        user_type,
        COUNT(*) as count,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active,
        COUNT(CASE WHEN is_active = false THEN 1 END) as inactive,
        COUNT(CASE WHEN is_online = true THEN 1 END) as online
      FROM users
      GROUP BY user_type
      ORDER BY user_type
    `);

    console.log('📊 User Statistics by Type:\n');
    console.table(countResult.rows);

    // Get total counts
    const totalResult = await pool.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
        COUNT(CASE WHEN is_online = true THEN 1 END) as online_users,
        COUNT(DISTINCT internal_user_id) as unique_internal_ids
      FROM users
    `);

    console.log('📈 Overall Statistics:\n');
    console.table(totalResult.rows);

    // Get recent users
    const recentResult = await pool.query(`
      SELECT
        id,
        internal_user_id,
        username,
        full_name,
        user_type,
        is_active,
        is_online,
        created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('🕐 Recently Added Users:\n');
    console.table(recentResult.rows);

    // Check for duplicates
    const duplicateCheck = await pool.query(`
      SELECT
        internal_user_id,
        COUNT(*) as count
      FROM users
      GROUP BY internal_user_id
      HAVING COUNT(*) > 1
    `);

    if (duplicateCheck.rows.length > 0) {
      console.log('⚠️  WARNING: Duplicate internal_user_ids found:\n');
      console.table(duplicateCheck.rows);
    } else {
      console.log('✅ No duplicate internal_user_ids found\n');
    }

    console.log('=' .repeat(60));

  } catch (error) {
    console.error('❌ Error checking users:', error.message);
  } finally {
    await pool.end();
  }
}

checkUsers();
