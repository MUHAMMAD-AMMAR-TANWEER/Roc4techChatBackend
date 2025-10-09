# Odoo User Sync Scripts

Two scripts are provided to sync users from Odoo to the chat backend database:

1. **syncOdooUsers.js** - Fetches users directly from Odoo API
2. **syncUsersFromFile.js** - Syncs users from a JSON file (useful if API is not accessible)

## User Mapping

The script automatically maps Odoo users based on their groups:

- **Internal Users** (users with "Internal User" group) → Synced as **Clients**
- **Portal Users** (users without "Internal User" group) → Synced as **Technicians**

## Setup

### 1. Install Dependencies

First, make sure you have all required dependencies:

```bash
npm install
```

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# Optional: If bulk-sync endpoint requires authentication
ADMIN_JWT_TOKEN=your_admin_jwt_token_here

# Optional: Override local API URL (defaults to http://localhost:4000)
LOCAL_API_URL=http://localhost:4000/api/users/bulk-sync
```

**Note:** If your `/api/users/bulk-sync` endpoint doesn't require authentication (as it currently appears), you can skip the `ADMIN_JWT_TOKEN`.

### 3. Generate Admin Token (if needed)

If you need authentication, you can generate an admin token by:

1. Creating an admin user in your database
2. Using the `/api/users/login` endpoint to get a JWT token

## Usage

### Method 1: Direct API Sync

#### Dry Run (Recommended First)

Test the sync without actually writing to the database:

```bash
npm run sync-users-dry-run
```

This will:
- Fetch all users from Odoo
- Show you how many clients and technicians will be created
- Display sample user data
- **NOT** write anything to your database

### Full Sync

Once you've verified the dry run looks good:

```bash
npm run sync-users
```

This will:
- Fetch all users from Odoo API (with pagination)
- Map internal users to clients and portal users to technicians
- Sync all users to your local database
- Display a summary of synced users and any errors

### Method 2: Sync from JSON File

If the Odoo API is not accessible or requires special authentication, you can export the user data to a JSON file and sync from there.

#### Step 1: Get user data from Odoo

Make a request to your Odoo API and save the response to a JSON file:

```bash
# Using curl
curl -X POST https://roc4.live/api/users/list \
  -H "Content-Type: application/json" \
  -d '{"page":1,"page_size":1000}' \
  > data/odoo_users.json

# Or if authentication is required
curl -X POST https://roc4.live/api/users/list \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"page":1,"page_size":1000}' \
  > data/odoo_users.json
```

Alternatively, you can manually copy the JSON response from your browser/Postman to a file.

#### Step 2: Run the sync from file

```bash
npm run sync-users-from-file data/odoo_users.json
```

Or directly:

```bash
node scripts/syncUsersFromFile.js data/odoo_users.json
```

**Expected JSON format:**

The script accepts two formats:

1. With wrapper object:
```json
{
  "users": [
    {
      "id": 1,
      "name": "John Doe",
      "login": "john@example.com",
      "groups": [...]
    }
  ]
}
```

2. Direct array:
```json
[
  {
    "id": 1,
    "name": "John Doe",
    "login": "john@example.com",
    "groups": [...]
  }
]
```

## How It Works

1. **Fetching Users**: The script calls `https://roc4.live/api/users/list` with pagination (40 users per page) until all users are fetched.

2. **User Mapping**: For each Odoo user:
   - Checks if they have the "Internal User" group
   - Maps them to client (internal) or technician (portal)
   - Preserves their Odoo data in the `external_data` JSON field

3. **Syncing**: Uses your existing `/api/users/bulk-sync` endpoint to upsert users (insert new or update existing based on `internal_user_id`).

## Data Structure

Each Odoo user is mapped to:

```javascript
{
  internal_user_id: "123",           // Odoo user ID
  username: "user@example.com",      // Odoo login
  user_type: "client",               // "client" or "technician"
  full_name: "John Doe",            // Odoo name
  email: "user@example.com",        // Odoo email
  avatar_url: null,                 // Not available from Odoo
  is_active: true,                  // Odoo active status
  external_data: {                  // Full Odoo user data
    partner_id: 123,
    partner_name: "John Doe",
    company_id: 1,
    company_name: "Company",
    groups: [...],
    create_date: "...",
    write_date: "..."
  }
}
```

## Troubleshooting

### Error: "Confirmation required" or Authentication error

If the bulk-sync endpoint requires admin authentication, make sure you've set `ADMIN_JWT_TOKEN` in your `.env` file.

### Error: Connection refused

Make sure your local server is running:

```bash
node server.js
```

Or update `LOCAL_API_URL` in `.env` to point to your production server.

### Users not syncing

Check the error output from the script. Common issues:
- Invalid user data from Odoo
- Database constraints (unique username violations)
- Missing required fields

## Scheduling Automatic Syncs

You can schedule this script to run periodically using:

### Linux/Mac (cron)

```bash
# Run every day at 2 AM
0 2 * * * cd /path/to/Roc4techChatBackend && npm run sync-users
```

### Node.js (node-cron)

You already have `node-cron` installed. You can create a scheduled sync:

```javascript
// In server.js or a separate scheduler.js
const cron = require('node-cron');

// Run sync every day at 2 AM
cron.schedule('0 2 * * *', () => {
  console.log('Running scheduled Odoo user sync...');
  require('./scripts/syncOdooUsers.js');
});
```

## Example Output

```
🔄 Starting Odoo User Sync Process

============================================================
📥 Fetching users from Odoo API...
   Fetching page 1...
   ✓ Page 1: 40 users fetched
   Fetching page 2...
   ✓ Page 2: 35 users fetched
✅ Total users fetched: 75

🔄 Mapping users to local format...
   ✓ Mapped 45 clients (Internal Users)
   ✓ Mapped 30 technicians (Portal Users)

📤 Syncing users to local database...
✅ Sync completed!
   Synced: 75 users
   Errors: 0 users

============================================================
📊 SYNC SUMMARY
============================================================
Total Users in Odoo:     75
Successfully Synced:     75
Failed to Sync:          0
Clients (Internal):      45
Technicians (Portal):    30
============================================================
✅ Sync process completed!
```

## Need Help?

If you encounter any issues, check:
1. Odoo API is accessible: `curl -X POST https://roc4.live/api/users/list -H "Content-Type: application/json" -d '{"page":1,"page_size":10}'`
2. Local server is running: `curl http://localhost:4000/health`
3. Database is accessible and tables exist
