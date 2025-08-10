const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database setup script
const setupDatabase = async () => {
  console.log('🚀 Starting database setup...');

  const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
  });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Check if tables exist
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    const existingTables = tablesResult.rows.map(row => row.table_name);
    const requiredTables = ['users', 'tasks', 'chat_rooms', 'messages', 'message_reads'];

    const missingTables = requiredTables.filter(table => !existingTables.includes(table));

    if (missingTables.length > 0) {
      console.log(`❌ Missing tables: ${missingTables.join(', ')}`);
      console.log('📝 Please run your database schema first');
      return false;
    }

    console.log('✅ All required tables exist');

    // Check if admin user exists
    const adminResult = await pool.query(
      "SELECT id FROM users WHERE user_type = 'admin' LIMIT 1"
    );

    if (adminResult.rows.length === 0) {
      console.log('⚠️  No admin user found. Please create an admin user.');
    } else {
      console.log('✅ Admin user exists');
    }

    // Create necessary directories
    const directories = ['logs', 'uploads', 'config'];
    directories.forEach(dir => {
      const dirPath = path.join(__dirname, '..', dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    });

    console.log('🎉 Database setup complete!');
    return true;

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    return false;
  } finally {
    await pool.end();
  }
};

// Run setup if called directly
if (require.main === module) {
  setupDatabase().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { setupDatabase };