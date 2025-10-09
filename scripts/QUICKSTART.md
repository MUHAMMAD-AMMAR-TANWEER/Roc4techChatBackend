# Quick Start Guide: Sync Odoo Users

This guide will help you quickly sync users from Odoo to your chat backend.

## 🚀 Quick Method (Using JSON File)

Since the Odoo API endpoint `https://roc4.live/api/users/list` requires special configuration, the easiest way to get started is using the file-based sync:

### Step 1: Export users from Odoo

You need to get the user data from your Odoo system. You can:

**Option A: Using Postman/Insomnia/Browser**
1. Make a POST request to your Odoo user list endpoint
2. Copy the JSON response
3. Save it to `data/odoo_users.json`

**Option B: Using curl (if you have the right credentials)**
```bash
curl -X POST https://roc4.live/api/users/list \
  -H "Content-Type: application/json" \
  -d '{"page":1,"page_size":1000}' \
  > data/odoo_users.json
```

### Step 2: Run the sync

```bash
node scripts/syncUsersFromFile.js data/odoo_users.json
```

That's it! The script will:
- ✅ Map Internal Users → Clients
- ✅ Map Portal Users → Technicians
- ✅ Sync everything to your database

---

## 📋 Expected JSON Format

The JSON file should contain user data in this format:

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
        },
        {
          "id": 23,
          "name": "Administrator"
        }
      ],
      "company_id": 1,
      "company_name": "ROCFORT KITCHENS LLC"
    }
  ]
}
```

The script looks for the `Internal User` group to determine user type:
- **Has "Internal User" group** → Synced as **Client**
- **No "Internal User" group** → Synced as **Technician**

---

## 🔧 Configuration (Optional)

Create or update your `.env` file:

```env
# Local API endpoint (defaults to http://localhost:4000/api/users/bulk-sync)
LOCAL_API_URL=http://localhost:4000/api/users/bulk-sync

# Admin JWT token (only if bulk-sync endpoint requires auth)
ADMIN_JWT_TOKEN=your_token_here

# For direct API sync (if you configure it later)
ODOO_API_URL=https://roc4.live/api/users/list
ODOO_API_KEY=your_api_key_here
```

---

## ✅ Verification

After running the sync, verify in your database:

```sql
-- Check total users
SELECT user_type, COUNT(*)
FROM users
GROUP BY user_type;

-- View sample clients
SELECT id, username, full_name, user_type, is_active
FROM users
WHERE user_type = 'client'
LIMIT 5;

-- View sample technicians
SELECT id, username, full_name, user_type, is_active
FROM users
WHERE user_type = 'technician'
LIMIT 5;
```

---

## 🐛 Troubleshooting

### Issue: "File not found"
- Make sure you've created the `data/` directory
- Check the file path is correct

### Issue: "Invalid JSON format"
- Validate your JSON file using https://jsonlint.com
- Ensure it matches the expected format (see above)

### Issue: "Failed to sync users"
- Make sure your local server is running: `node server.js`
- Check the LOCAL_API_URL in your .env
- Verify your database connection is working

### Issue: "User already exists" errors
- This is normal! The script uses UPSERT (insert or update)
- Existing users will be updated with new data

---

## 📞 Need Help?

1. Check the detailed [README.md](README.md) for more options
2. Review your server logs for error details
3. Test your local API: `curl http://localhost:4000/health`

---

## 🔄 Re-running the Sync

You can safely re-run the sync anytime. The script will:
- Update existing users (based on `internal_user_id`)
- Add new users
- Skip invalid users with error messages

```bash
node scripts/syncUsersFromFile.js data/odoo_users.json
```

No data will be lost - it's an upsert operation!
