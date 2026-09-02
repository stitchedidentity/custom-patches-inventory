-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Supervisor', 'Purchaser')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create material_types table
CREATE TABLE IF NOT EXISTS material_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(100) NOT NULL,
  reorder_level INTEGER DEFAULT 20,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create color_variants table
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

-- Create inventory_logs table for tracking changes
CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  color_variant_id INTEGER NOT NULL REFERENCES color_variants(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  amount INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_color_variants_material_type ON color_variants(material_type_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_color_variant ON inventory_logs(color_variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_user ON inventory_logs(user_id);

-- Insert default users
-- Admin: admin / admin123
-- Supervisor: supervisor / super123
-- Purchaser: purchaser / purchase123
INSERT INTO users (username, password_hash, role) VALUES 
  ('admin', '$2b$10$YIjlrKzL8p7wKKJjrYx/KO1N7c8c7Y7a5N8p7q8r9s0t1u2v3w4x5', 'Admin'),
  ('supervisor', '$2b$10$9Yz8Xx7Wv6Ut5Sp4Rq3Pp2Oo1Nn0Mm9Ll8Kk7Jj6Ii5Hh4Gg3Ff', 'Supervisor'),
  ('purchaser', '$2b$10$5De4Cf3Be2Ad1Zc0Yb9Xa8Wv7Us6Tr5Sq4Rp3Oo2Nn1Mm0Ll9Kk', 'Purchaser')
ON CONFLICT (username) DO NOTHING;

-- Insert sample material types
INSERT INTO material_types (name, unit, reorder_level) VALUES 
  ('Viscose Thread', 'cones', 20),
  ('Polyester Thread', 'cones', 20),
  ('Cotton Backing', 'yards', 50)
ON CONFLICT DO NOTHING;

-- Insert sample color variants
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
ON CONFLICT DO NOTHING;
