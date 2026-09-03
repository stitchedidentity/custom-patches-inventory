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

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// Login endpoint
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

// Middleware to verify JWT
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
      return res.status(400).json({ error: 'All fields
