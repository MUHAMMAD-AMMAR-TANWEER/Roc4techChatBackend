# How to Sync Your Odoo Users

## ✅ Quick 3-Step Process

### Step 1: Create your JSON file

Create a file `data/odoo_users.json` with your user data:

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
        {
          "id": 1,
          "name": "Internal User"
        }
      ],
      "company_id": 1,
      "company_name": "ROCFORT KITCHENS LLC",
      "create_date": "2024-08-03T09:14:36.726708",
      "write_date": "2024-08-03T09:14:36.726708"
    }
  ]
}
```

**Important:** Just paste your full user array into the `"users": [...]` section.

### Step 2: Run the sync

```bash
node scripts/syncUsersFromFile.js data/odoo_users.json
```

### Step 3: Done!

You'll see output like:

```
✅ Sync completed!
   Synced: 75 users
   Errors: 0 users

📊 SYNC SUMMARY
Total Users in File:     75
Successfully Synced:     75
Clients (Internal):      45
Technicians (Portal):    30
```

---

## 📝 User Mapping Rules

The script automatically categorizes users:

| Odoo User Type | Has "Internal User" group? | Synced As |
|----------------|----------------------------|-----------|
| Internal User  | ✅ Yes                     | **Client** |
| Portal User    | ❌ No                      | **Technician** |

---

## 🔁 Re-running the Sync

You can run the script multiple times safely:

- **Existing users** → Updated with new data
- **New users** → Added to database
- **No duplicates** → Uses `internal_user_id` as unique key

---

## ✅ Verify Users in Database

Check your synced users:

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

pool.query('SELECT user_type, COUNT(*) FROM users GROUP BY user_type')
  .then(result => {
    console.log('\\nUser counts by type:');
    console.table(result.rows);
    return pool.query('SELECT id, username, full_name, user_type FROM users LIMIT 10');
  })
  .then(result => {
    console.log('\\nSample users:');
    console.table(result.rows);
    pool.end();
  });
"
```

---

## 📂 File Format Examples

### Format 1: With wrapper object (recommended)
```json
{
  "users": [
    { "id": 1, "name": "User 1", "login": "user1@example.com", "groups": [...] },
    { "id": 2, "name": "User 2", "login": "user2@example.com", "groups": [...] }
  ]
}
```

### Format 2: Direct array (also supported)
```json
[
  { "id": 1, "name": "User 1", "login": "user1@example.com", "groups": [...] },
  { "id": 2, "name": "User 2", "login": "user2@example.com", "groups": [...] }
]
```

---

## ❓ Troubleshooting

### "File not found"
- Create the `data/` directory: `mkdir -p data`
- Make sure the file path is correct

### "Invalid JSON"
- Validate your JSON at https://jsonlint.com
- Make sure all quotes are properly closed
- Check for trailing commas

### "Connection refused"
- Make sure your server is running: `node server.js`
- Check that port 4000 is not blocked

### Users not syncing
- Check the error output from the script
- Make sure required fields are present: `id`, `name` or `login`

---

## 🎯 Example: Full Workflow

```bash
# 1. Make sure your server is running
node server.js &

# 2. Create your JSON file (paste your user data)
nano data/odoo_users.json

# 3. Run the sync
node scripts/syncUsersFromFile.js data/odoo_users.json

# 4. Verify results
node -e "
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
pool.query('SELECT user_type, COUNT(*) as count FROM users GROUP BY user_type')
  .then(r => { console.table(r.rows); pool.end(); });
"
```

That's it! Your Odoo users are now synced to your chat backend.
