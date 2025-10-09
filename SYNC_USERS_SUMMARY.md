# ✅ User Sync System - Complete Summary

## What Was Built

A complete user synchronization system that pulls users from your Odoo system and maps them to your chat backend database.

---

## 🎯 User Mapping Logic

| Odoo User Type | Identification | Chat System Role |
|----------------|----------------|------------------|
| **Internal User** | Has "Internal User" group | → **Client** |
| **Portal User** | No "Internal User" group | → **Technician** |

---

## 📁 Files Created

### Scripts
- **[scripts/syncUsersFromFile.js](scripts/syncUsersFromFile.js)** - Main sync script (works without auth)
- **[scripts/syncOdooUsers.js](scripts/syncOdooUsers.js)** - Alternative direct API sync
- **[scripts/checkUsers.js](scripts/checkUsers.js)** - Database verification tool

### Documentation
- **[HOW_TO_SYNC_USERS.md](HOW_TO_SYNC_USERS.md)** - Quick start guide
- **[scripts/README.md](scripts/README.md)** - Detailed documentation
- **[scripts/QUICKSTART.md](scripts/QUICKSTART.md)** - Quick reference

### Sample Data
- **[data/sample_users.json](data/sample_users.json)** - Example JSON format

---

## 🚀 Quick Start

### 1. Create JSON File

Create `data/odoo_users.json` with your user data:

```json
{
  "users": [
    {
      "id": 70,
      "name": "Account",
      "login": "roc4tac@gmail.com",
      "email": false,
      "active": true,
      "partner_id": 77,
      "partner_name": "Account",
      "groups": [
        { "id": 1, "name": "Internal User" }
      ],
      "company_id": 1,
      "company_name": "ROCFORT KITCHENS LLC"
    }
  ]
}
```

### 2. Run Sync

```bash
node scripts/syncUsersFromFile.js data/odoo_users.json
```

### 3. Verify

```bash
npm run check-users
```

---

## 📋 NPM Scripts Available

```bash
# Sync users from JSON file (recommended)
npm run sync-users-from-file data/odoo_users.json

# Check database statistics
npm run check-users

# Direct API sync (requires API configuration)
npm run sync-users

# Dry run (test without syncing)
npm run sync-users-dry-run
```

---

## ✨ Features

✅ **Smart Mapping** - Automatically detects user type from groups
✅ **Upsert Logic** - Updates existing users, adds new ones
✅ **No Duplicates** - Uses `internal_user_id` as unique key
✅ **Progress Display** - Real-time sync progress
✅ **Error Handling** - Continues on errors, reports at end
✅ **Data Preservation** - Stores full Odoo data in `external_data` field
✅ **No Auth Required** - Uses the `/sync` endpoint (no token needed)

---

## 📊 What Gets Synced

Each Odoo user is mapped to:

```javascript
{
  internal_user_id: "70",              // Odoo user ID
  username: "roc4tac@gmail.com",       // Odoo login
  user_type: "client",                 // "client" or "technician"
  full_name: "Account",                // Odoo name
  email: "user@example.com",           // Odoo email
  avatar_url: null,                    // Not available
  is_active: true,                     // Odoo active status
  external_data: {                     // Full Odoo data stored here
    partner_id: 77,
    partner_name: "Account",
    company_id: 1,
    company_name: "ROCFORT KITCHENS LLC",
    groups: [...],                     // All user groups
    create_date: "...",
    write_date: "..."
  }
}
```

---

## 🔄 Re-running Sync

Safe to run multiple times:

- **Existing users** → Updated with latest data
- **New users** → Added to database
- **Unchanged users** → Simply updated
- **No data loss** → Upsert operation

---

## 🧪 Test Results

```bash
# Test with sample user
✅ Successfully synced 1 client (Internal User)
✅ User verified in database:
   - ID: 47
   - Internal ID: 70
   - Username: roc4tac@gmail.com
   - Type: client
   - Status: active
```

---

## 📚 Documentation Links

- **Quick Start**: [HOW_TO_SYNC_USERS.md](HOW_TO_SYNC_USERS.md)
- **Full Documentation**: [scripts/README.md](scripts/README.md)
- **Quick Reference**: [scripts/QUICKSTART.md](scripts/QUICKSTART.md)

---

## 🛠️ Next Steps

1. **Get your full Odoo user data** and save to `data/odoo_users.json`
2. **Run the sync**: `node scripts/syncUsersFromFile.js data/odoo_users.json`
3. **Verify results**: `npm run check-users`
4. **Optionally**: Set up automatic syncing with cron or node-cron

---

## 💡 Pro Tips

### Automatic Sync with Cron

Add to your crontab to sync daily at 2 AM:

```bash
0 2 * * * cd /root/Roc4techChatBackend && node scripts/syncUsersFromFile.js data/odoo_users.json >> logs/sync.log 2>&1
```

### Sync from API Response

If you have an API response, just save it and sync:

```bash
# Get data from API
curl -X POST https://your-odoo.com/api/users \
  -H "Authorization: Bearer TOKEN" \
  -o data/odoo_users.json

# Sync it
node scripts/syncUsersFromFile.js data/odoo_users.json
```

### Verify Specific User

```bash
node -e "
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
pool.query('SELECT * FROM users WHERE internal_user_id = \$1', ['70'])
  .then(r => { console.log(r.rows[0]); pool.end(); });
"
```

---

## 🎉 Success!

Your user sync system is ready to use. Simply prepare your JSON file with all your Odoo users and run the sync script!

**Questions?** Check the documentation files or review the script code - everything is well-commented and straightforward.
