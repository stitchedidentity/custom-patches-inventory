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

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// AUTHENTICATION ROUTES
// ============================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

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

// ============================================
// MATERIAL TYPES ROUTES
// ============================================

app.get('/api/material-types', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mt.*, json_agg(json_build_object(
        'id', cv.id, 
        'name', cv.name, 
        'quantity', cv.quantity, 
        'unit', cv.unit, 
        'reorderLevel', cv.reorder_level
      )) as colors
      FROM material_types mt
      LEFT JOIN color_variants cv ON mt.id = cv.material_type_id
      GROUP BY mt.id
      ORDER BY mt.id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/material-types', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, unit, reorderLevel } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ error: 'Name and unit required' });
    }

    const result = await pool.query(
      'INSERT INTO material_types (name, unit, reorder_level) VALUES ($1, $2, $3) RETURNING *',
      [name, unit, reorderLevel || 20]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/material-types/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const { name, unit, reorderLevel } = req.body;

    const result = await pool.query(
      'UPDATE material_types SET name = $1, unit = $2, reorder_level = $3 WHERE id = $4 RETURNING *',
      [name, unit, reorderLevel, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Material type not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/material-types/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    await pool.query('DELETE FROM color_variants WHERE material_type_id = $1', [id]);
    
    const result = await pool.query(
      'DELETE FROM material_types WHERE id = $1 RETURNING *',
      [id]
    );

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
// COLOR VARIANTS ROUTES
// ============================================

app.post('/api/color-variants', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Purchaser') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { materialTypeId, name, quantity, unit, reorderLevel } = req.body;

    if (!materialTypeId || !name || quantity === undefined || !unit) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const result = await pool.query(
      `INSERT INTO color_variants (material_type_id, name, quantity, unit, reorder_level, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [materialTypeId, name, quantity, unit, reorderLevel || 20, req.user.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/color-variants/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Purchaser') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { id } = req.params;
    const { name, quantity, unit, reorderLevel } = req.body;

    const result = await pool.query(
      `UPDATE color_variants 
       SET name = $1, quantity = $2, unit = $3, reorder_level = $4, updated_at = NOW() 
       WHERE id = $5 RETURNING *`,
      [name, quantity, unit, reorderLevel, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/color-variants/:id/deduct', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Purchaser') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const current = await pool.query('SELECT quantity FROM color_variants WHERE id = $1', [id]);
    
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Color variant not found' });
    }

    const newQuantity = Math.max(0, current.rows[0].quantity - amount);

    const result = await pool.query(
      `UPDATE color_variants 
       SET quantity = $1, updated_at = NOW() 
       WHERE id = $2 RETURNING *`,
      [newQuantity, id]
    );

    await pool.query(
      `INSERT INTO inventory_logs (color_variant_id, action, amount, user_id) 
       VALUES ($1, $2, $3, $4)`,
      [id, 'DEDUCT', amount, req.user.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/color-variants/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM color_variants WHERE id = $1 RETURNING *',
      [id]
    );

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
// USER MANAGEMENT ROUTES
// ============================================

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY id'
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, role]
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

// ============================================
// SETUP ENDPOINT - Create Users (FIXED)
// ============================================

app.post('/api/setup/create-users', async (req, res) => {
  try {
    console.log('Creating users...');
    
    // Delete existing users
    await pool.query('DELETE FROM users');

    // Hash passwords
    const adminHash = await bcrypt.hash('admin123', 10);
    const supervisorHash = await bcrypt.hash('super123', 10);
    const purchaserHash = await bcrypt.hash('purchase123', 10);

    // Insert users
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES 
        ($1, $2, $3),
        ($4, $5, $6),
        ($7, $8, $9)`,
      ['admin', adminHash, 'Admin', 'supervisor', supervisorHash, 'Supervisor', 'purchaser', purchaserHash, 'Purchaser']
    );

    console.log('Users created successfully');
    res.json({ 
      message: 'Users created successfully!',
      users: [
        { username: 'admin', password: 'admin123', role: 'Admin' },
        { username: 'supervisor', password: 'super123', role: 'Supervisor' },
        { username: 'purchaser', password: 'purchase123', role: 'Purchaser' }
      ]
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Failed to create users', details: error.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ============================================
// AUTO-INITIALIZE DATABASE
// ============================================

async function initializeDatabase() {
  try {
    console.log('Initializing database...');

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Supervisor', 'Purchaser')),
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

    console.log('Tables created successfully');

    // Add sample data if materials don't exist
    const typeCheck = await pool.query('SELECT COUNT(*) as count FROM material_types');
    
    if (typeCheck.rows[0].count === 0) {
      console.log('Adding sample material types...');
      
      await pool.query(`
        INSERT INTO material_types (name, unit, reorder_level) VALUES 
          ('Viscose Thread', 'cones', 20),
          ('Polyester Thread', 'cones', 20),
          ('Cotton Backing', 'yards', 50)
      `);

      await pool.query(`
        INSERT INTO color_variants (material_type_id, name, quantity, unit, reorder_level, created_by) VALUES 
          (1, 'Red', 50, 'cones', 20, 1),
          (1, 'Blue', 75, 'cones', 20, 1),
          (1, 'Green', 30, 'cones', 20, 1),
          (1, 'White', 100, 'cones', 20, 1),
          (1, 'Black', 120, 'cones', 20, 1),
          (2, 'Red', 80, 'cones', 20, 1),
          (2, 'Blue', 95, 'cones', 20, 1),
          (2, 'Navy', 15, 'cones', 20, 1),
          (2, 'White', 150, 'cones', 20, 1),
          (3, 'Natural', 500, 'yards', 50, 1),
          (3, 'White', 350, 'yards', 50, 1),
          (3, 'Black', 200, 'yards', 50, 1)
      `);

      console.log('Sample materials added');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
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
