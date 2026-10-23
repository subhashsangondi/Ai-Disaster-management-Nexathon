const db = require('../config/database');

async function listTeams({ availability } = {}) {
  const params = [];
  let where = '';
  if (availability) {
    params.push(availability);
    where = 'WHERE availability = $1';
  }
  const result = await db.query(
    `SELECT id, team_name, availability, created_at
     FROM rescue_teams ${where}
     ORDER BY team_name`,
    params,
  );
  return result.rows;
}

async function findById(id, client = db) {
  const result = await client.query(
    'SELECT id, team_name, availability, created_at FROM rescue_teams WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
}

module.exports = { listTeams, findById };
