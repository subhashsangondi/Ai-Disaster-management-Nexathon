const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function checkConnection() {
  if (!env.DATABASE_URL) {
    return { connected: false, error: 'DATABASE_URL is not configured' };
  }

  try {
    await pool.query('SELECT 1');
    return { connected: true };
  } catch (error) {
    return { connected: false, error: 'Database is unavailable' };
  }
}

module.exports = { pool, query, checkConnection };
