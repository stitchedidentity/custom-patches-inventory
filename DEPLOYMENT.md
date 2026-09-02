# Custom Patches Inventory - Deployment Guide

## Overview

This is a full-stack inventory management app with:
- **Frontend:** HTML/CSS/JavaScript (React-like functionality)
- **Backend:** Node.js/Express
- **Database:** PostgreSQL
- **Authentication:** JWT with 3 roles (Admin, Supervisor, Purchaser)

## Project Structure

```
custom-patches-inventory/
├── index-backend.html      # Frontend (use as index.html in production)
├── server.js              # Express backend server
├── package.json           # Node.js dependencies
├── init-db.sql           # Database schema
├── .env.example          # Environment variables template
├── .gitignore            # Git ignore file
└── DEPLOYMENT.md         # This file
```

## Step 1: Update GitHub Repository

1. Clone your existing repo:
```bash
git clone https://github.com/stitcheididentity/custom-patches-inventory.git
cd custom-patches-inventory
```

2. Add new files:
```bash
# Rename the old file
mv inventory-app.html legacy-static.html

# Copy new files to repo
cp server.js .
cp package.json .
cp init-db.sql .
cp .env.example .
cp index-backend.html index.html

# Create .gitignore
echo "node_modules/" > .gitignore
echo ".env" >> .gitignore
echo "*.log" >> .gitignore
```

3. Commit and push:
```bash
git add .
git commit -m "Add backend server with authentication and real-time database"
git push
```

## Step 2: Set Up PostgreSQL Database on Render

1. Go to **render.com** dashboard
2. Click **New +** → **PostgreSQL**
3. Configure:
   - **Name:** `custom-patches-inventory-db`
   - **PostgreSQL Version:** 14
   - **Region:** Same as your app
4. Click **Create Database**

5. Once created, copy the **Internal Database URL** (you'll need this in Step 3)

## Step 3: Deploy Backend on Render

1. In Render dashboard, click **New +** → **Web Service**
2. Connect your GitHub repository
3. Configure:
   - **Name:** `custom-patches-inventory-api`
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free (or paid if you need uptime SLA)

4. Add Environment Variables:
   - Click **Environment**
   - Add these:
     ```
     DATABASE_URL=<paste the PostgreSQL Internal URL from Step 2>
     JWT_SECRET=your-super-secret-key-12345
     PORT=3000
     ```

5. Click **Create Web Service**

6. Render will deploy your backend automatically

## Step 4: Initialize Database

Once backend is deployed:

1. Go to your **PostgreSQL database** on Render
2. Click **Connect** → **External Connection**
3. Open a terminal and run:
```bash
psql <your-postgresql-external-url>
```

4. Paste the contents of `init-db.sql` and run it

This will create all tables and insert default users.

## Step 5: Deploy Frontend

You have 2 options:

### Option A: Serve Frontend from Backend (Recommended)

1. Update `server.js` to serve the frontend:

Add after `const app = express();`:
```javascript
app.use(express.static('.'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
```

2. Push changes:
```bash
git add server.js
git commit -m "Add static file serving for frontend"
git push
```

3. Render auto-deploys. Your app will be at:
```
https://custom-patches-inventory-api.onrender.com
```

### Option B: Keep Separate Frontend (Current Setup)

Your frontend stays at:
```
https://custom-patches-inventory.onrender.com
```

Backend API at:
```
https://custom-patches-inventory-api.onrender.com
```

You need to update the frontend to point to the correct API URL.

## Step 6: Connect Frontend to Backend

In `index.html`, update the API URL:

```javascript
// At the top of the script section
const API_URL = 'https://custom-patches-inventory-api.onrender.com/api';
```

Commit and push:
```bash
git add index.html
git commit -m "Update API URL to production backend"
git push
```

## Step 7: Test the App

1. Visit your app:
   - If using Option A: `https://custom-patches-inventory-api.onrender.com`
   - If using Option B: `https://custom-patches-inventory.onrender.com`

2. Login with demo accounts:
   - **Admin:** admin / admin123
   - **Supervisor:** supervisor / super123
   - **Purchaser:** purchaser / purchase123

3. Test:
   - Admin can add/edit/delete everything
   - Supervisor can view and deduct stock (but not delete)
   - Purchaser can only view

## Updating Default Users

Passwords in `init-db.sql` are hashed. To create new users or change passwords:

1. Use the admin panel (when available)
2. Or connect to database and run:
```sql
INSERT INTO users (username, password_hash, role) 
VALUES ('newuser', '$2b$10$...', 'Supervisor');
```

(Generate bcrypt hash with: `bcrypt.hash(password, 10)`)

## Troubleshooting

### Backend won't start
- Check environment variables in Render
- Verify DATABASE_URL is correct
- Check logs in Render dashboard

### Frontend can't connect to API
- Verify API_URL in index.html matches backend URL
- Check CORS settings in server.js
- Ensure JWT_SECRET is set

### Database connection error
- Verify DATABASE_URL in Render environment
- Make sure PostgreSQL is running
- Check that init-db.sql was executed

### Login fails
- Check that init-db.sql ran successfully
- Verify password hash in database
- Try demo accounts first

## Next Steps

1. **Add email notifications:** Use SendGrid + Zapier
2. **Add WhatsApp notifications:** Use Twilio
3. **Create admin panel:** Manage users and roles
4. **Add audit logs:** Track all changes
5. **Add reports:** Export inventory data

## Support

For issues, check:
1. Render dashboard logs
2. Browser console (F12)
3. Backend logs in Render
4. Database connection

---

**Deployment URL Pattern:**
- Backend: `https://[your-service-name].onrender.com`
- Database: Managed by Render PostgreSQL

Your app is now production-ready with real-time database sync!
