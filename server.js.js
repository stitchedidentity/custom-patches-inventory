const express = require('express');
const cors = require('cors');
const pg = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Database
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Default permissions for each role
const DEFAULT_PERMISSIONS = {
  Admin: {
    view_inventory: true,
    add_material: true,
    edit_material: true,
    delete_material: true,
    add_color: true,
    edit_color: true,
    delete_color: true,
    deduct_stock: true,
    add_stock: true,
    manage_users: true,
    view_logs: true
  },
  Supervisor: {
    view_inventory: true,
    add_material: false,
    edit_material: false,
    delete_material: false,
    add_color: true,
    edit_color: true,
    delete_color: false,
    deduct_stock: true,
    add_stock: true,
    manage_users: false,
    view_logs: true
  },
  Purchaser: {
    view_inventory: true,
    add_material: false,
    edit_material: false,
    delete_material: false,
    add_color: false,
    edit_color: false,
    delete_color: false,
    deduct_stock: false,
    add_stock: false,
    manage_users: false,
    view_logs: true
  }
};

// ============================================
// LOGIN
// ============================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get permissions
    const permissions = user.permissions || DEFAULT_PERMISSIONS[user.role] || {};

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, permissions },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware - verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Permission check helper
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user.permissions || !req.user.permissions[permission]) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
};

// ============================================
// MATERIAL TYPES
// ============================================

app.get('/api/material-types', authenticateToken, checkPermission('view_inventory'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mt.id, mt.name, mt.unit, mt.reorder_level, mt.created_at, mt.updated_at,
              COALESCE(json_agg(json_build_object(
        'id', cv.id, 'name', cv.name, 'quantity', cv.quantity, 'unit', cv.unit, 'reorderLevel', cv.reorder_level
      )) FILTER (WHERE cv.id IS NOT NULL), '[]'::json) as colors
      FROM material_types mt
      LEFT JOIN color_variants cv ON mt.id = cv.material_type_id
      GROUP BY mt.id, mt.name, mt.unit, mt.reorder_level, mt.created_at, mt.updated_at
      ORDER BY mt.id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/material-types', authenticateToken, checkPermission('add_material'), async (req, res) => {
  try {
    const { name, unit, reorderLevel } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ error: 'Name and unit required' });
    }

    const reorder = parseInt(reorderLevel) || 20;

    const result = await pool.query(
      'INSERT INTO material_types (name, unit, reorder_level, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
      [name, unit, reorder]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating material type:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.put('/api/material-types/:id', authenticateToken, checkPermission('edit_material'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, unit, reorderLevel } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ error: 'Name and unit are required' });
    }

    const reorder = parseInt(reorderLevel) || 20;

    const result = await pool.query(
      'UPDATE material_types SET name = $1, unit = $2, reorder_level = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, unit, reorder, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Material type not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating material type:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.delete('/api/material-types/:id', authenticateToken, checkPermission('delete_material'), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM color_variants WHERE material_type_id = $1', [id]);
    const result = await pool.query('DELETE FROM material_types WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Material type not found' });
    }

    res.json({ message: 'Material type deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// COLOR VARIANTS
// ============================================

app.post('/api/color-variants', authenticateToken, checkPermission('add_color'), async (req, res) => {
  try {
    const { materialTypeId, name, quantity, unit, reorderLevel } = req.body;

    if (!materialTypeId || !name || !unit) {
      return res.status(400).json({ error: 'Material ID, name, and unit required' });
    }

    const qty = parseInt(quantity) || 0;
    const reorder = parseInt(reorderLevel) || 20;

    const result = await pool.query(
      `INSERT INTO color_variants (material_type_id, name, quantity, unit, reorder_level, created_by, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
      [materialTypeId, name, qty, unit, reorder, req.user.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating color variant:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.put('/api/color-variants/:id', authenticateToken, checkPermission('edit_color'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, quantity, unit, reorderLevel } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ error: 'Name and unit are required' });
    }

    const qty = parseInt(quantity) || 0;
    const reorder = parseInt(reorderLevel) || 20;

    const result = await pool.query(
      `UPDATE color_variants SET name = $1, quantity = $2, unit = $3, reorder_level = $4, updated_at = NOW() WHERE id = $5 RETURNING *`,
      [name, qty, unit, reorder, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating color variant:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.post('/api/color-variants/:id/deduct', authenticateToken, checkPermission('deduct_stock'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const current = await pool.query('SELECT quantity FROM color_variants WHERE id = $1', [id]);
    
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    const currentQty = current.rows[0].quantity || 0;
    const newQuantity = Math.max(0, currentQty - parseInt(amount));

    const result = await pool.query(
      `UPDATE color_variants SET quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newQuantity, id]
    );

    await pool.query(
      `INSERT INTO inventory_logs (color_variant_id, action, amount, user_id) VALUES ($1, $2, $3, $4)`,
      [id, 'DEDUCT', parseInt(amount), req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Deduct error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.post('/api/color-variants/:id/add-stock', authenticateToken, checkPermission('add_stock'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const current = await pool.query('SELECT quantity FROM color_variants WHERE id = $1', [id]);
    
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    const currentQty = current.rows[0].quantity || 0;
    const newQuantity = currentQty + parseInt(amount);

    const result = await pool.query(
      `UPDATE color_variants SET quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newQuantity, id]
    );

    await pool.query(
      `INSERT INTO inventory_logs (color_variant_id, action, amount, user_id) VALUES ($1, $2, $3, $4)`,
      [id, 'ADD', parseInt(amount), req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Add stock error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.delete('/api/color-variants/:id', authenticateToken, checkPermission('delete_color'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM color_variants WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    res.json({ message: 'Color variant deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// USERS
// ============================================

app.get('/api/users', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, permissions, created_at FROM users ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const permissions = DEFAULT_PERMISSIONS[role] || {};

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role, permissions) VALUES ($1, $2, $3, $4) RETURNING id, username, role, permissions',
      [username, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:id', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.userId === parseInt(id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await pool.query('DELETE FROM inventory_logs WHERE user_id = $1', [id]);
    await pool.query('UPDATE color_variants SET created_by = NULL WHERE created_by = $1', [id]);
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// UPDATE USER PERMISSIONS
// ============================================

app.put('/api/users/:id/permissions', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Valid permissions object required' });
    }

    const result = await pool.query(
      'UPDATE users SET permissions = $1 WHERE id = $2 RETURNING id, username, role, permissions',
      [JSON.stringify(permissions), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// DATABASE RESET & SETUP
// ============================================

app.get('/api/setup/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('Starting database reset...');
    
    await client.query('BEGIN');
    
    await client.query('DROP TABLE IF EXISTS inventory_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS color_variants CASCADE');
    await client.query('DROP TABLE IF EXISTS material_types CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('Dropped all tables');
    
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Supervisor', 'Purchaser')),
        permissions JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE material_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(100) NOT NULL,
        reorder_level INTEGER NOT NULL DEFAULT 20,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE color_variants (
        id SERIAL PRIMARY KEY,
        material_type_id INTEGER NOT NULL REFERENCES material_types(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        unit VARCHAR(100) NOT NULL,
        reorder_level INTEGER NOT NULL DEFAULT 20,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE inventory_logs (
        id SERIAL PRIMARY KEY,
        color_variant_id INTEGER NOT NULL REFERENCES color_variants(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        amount INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_color_variants_material_type ON color_variants(material_type_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_color_variant ON inventory_logs(color_variant_id);
    `);

    console.log('Recreated all tables');
    
    const adminPass = await bcrypt.hash('admin123', 10);
    const supervisorPass = await bcrypt.hash('super123', 10);
    const purchaserPass = await bcrypt.hash('purchase123', 10);

    await client.query(
      `INSERT INTO users (username, password_hash, role, permissions) VALUES 
        ('admin', $1, 'Admin', $4),
        ('supervisor', $2, 'Supervisor', $5),
        ('purchaser', $3, 'Purchaser', $6)`,
      [
        adminPass,
        supervisorPass,
        purchaserPass,
        JSON.stringify(DEFAULT_PERMISSIONS.Admin),
        JSON.stringify(DEFAULT_PERMISSIONS.Supervisor),
        JSON.stringify(DEFAULT_PERMISSIONS.Purchaser)
      ]
    );

    console.log('Created users');
    
    await client.query(`
      INSERT INTO material_types (name, unit, reorder_level, created_at, updated_at) VALUES 
        ('Viscose Thread', 'cones', 20, NOW(), NOW()),
        ('Polyester Thread', 'cones', 20, NOW(), NOW()),
        ('Cotton Backing', 'yards', 50, NOW(), NOW())
    `);
    console.log('Created material types');
    
    await client.query(`
      INSERT INTO color_variants (material_type_id, name, quantity, unit, reorder_level, created_by, created_at, updated_at) VALUES 
        (1, 'Red', 50, 'cones', 20, 1, NOW(), NOW()),
        (1, 'Blue', 75, 'cones', 20, 1, NOW(), NOW()),
        (1, 'Green', 30, 'cones', 20, 1, NOW(), NOW()),
        (1, 'White', 100, 'cones', 20, 1, NOW(), NOW()),
        (1, 'Black', 120, 'cones', 20, 1, NOW(), NOW()),
        (2, 'Red', 80, 'cones', 20, 1, NOW(), NOW()),
        (2, 'Blue', 95, 'cones', 20, 1, NOW(), NOW()),
        (2, 'Navy', 15, 'cones', 20, 1, NOW(), NOW()),
        (2, 'White', 150, 'cones', 20, 1, NOW(), NOW()),
        (3, 'Natural', 500, 'yards', 50, 1, NOW(), NOW()),
        (3, 'White', 350, 'yards', 50, 1, NOW(), NOW()),
        (3, 'Black', 200, 'yards', 50, 1, NOW(), NOW())
    `);

    await client.query('COMMIT');
    console.log('✅ Database reset completed!');

    res.json({ 
      success: true,
      message: 'Database reset successfully!',
      credentials: {
        admin: { username: 'admin', password: 'admin123' },
        supervisor: { username: 'supervisor', password: 'super123' },
        purchaser: { username: 'purchaser', password: 'purchase123' }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Reset failed', details: error.message });
  } finally {
    client.release();
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================
// AUTO-INITIALIZE DATABASE
// ============================================

async function initializeDatabase() {
  try {
    console.log('Initializing database...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Supervisor', 'Purchaser')),
        permissions JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS material_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(100) NOT NULL,
        reorder_level INTEGER DEFAULT 20,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS color_variants (
        id SERIAL PRIMARY KEY,
        material_type_id INTEGER NOT NULL REFERENCES material_types(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        unit VARCHAR(100) NOT NULL,
        reorder_level INTEGER DEFAULT 20,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id SERIAL PRIMARY KEY,
        color_variant_id INTEGER NOT NULL REFERENCES color_variants(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        amount INTEGER,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_color_variants_material_type ON color_variants(material_type_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_color_variant ON inventory_logs(color_variant_id);
    `);

    console.log('✅ Database initialized');
  } catch (error) {
    console.error('Database init error:', error);
  }
}

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeDatabase();
});
