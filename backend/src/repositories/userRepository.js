const db = require('../config/database');

async function createUser({ name, email, passwordHash, role = 'public' }) {
  const result = await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, created_at`,
    [name, email, passwordHash, role],
  );
  return result.rows[0];
}

async function findByEmail(email) {
  const result = await db.query(
    `SELECT id, name, email, password_hash, role, created_at
     FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    `SELECT id, name, email, role, created_at FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

module.exports = { createUser, findByEmail, findById };
