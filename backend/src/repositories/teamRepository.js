const db = require('../config/database');
const { presentTeam } = require('../domain/teamProfile');

const teamColumns = `
  team.id, team.team_name, team.availability, team.primary_category, team.capabilities,
  team.latitude, team.longitude, team.base_location_name,
  team.contact_info, team.created_at`;

async function listTeams({ availability } = {}) {
  const params = [];
  let where = '';
  if (availability) {
    params.push(availability);
    where = 'WHERE availability = $1';
  }
  const result = await db.query(
    `SELECT ${teamColumns},
       (SELECT COUNT(*)::int FROM incidents active
        WHERE active.assigned_team_id = team.id AND active.status <> 'resolved') AS active_assignment_count
     FROM rescue_teams team ${where ? where.replace('availability', 'team.availability') : ''}
     ORDER BY team.team_name`,
    params,
  );
  return result.rows.map(presentTeam);
}

async function findById(id, client = db) {
  const result = await client.query(
    `SELECT ${teamColumns},
       (SELECT COUNT(*)::int FROM incidents active
        WHERE active.assigned_team_id = team.id AND active.status <> 'resolved') AS active_assignment_count
     FROM rescue_teams team WHERE team.id = $1`,
    [id],
  );
  return result.rows[0] ? presentTeam(result.rows[0]) : null;
}

async function createTeam(data, client = db) {
  const result = await client.query(
    `INSERT INTO rescue_teams
       (team_name, primary_category, capabilities, latitude, longitude, base_location_name, contact_info, availability)
     VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8)
     RETURNING id, team_name, availability, primary_category, capabilities, latitude, longitude,
       base_location_name, contact_info, created_at`,
    [
      data.team_name,
      data.primary_category,
      data.capabilities,
      data.latitude,
      data.longitude,
      data.base_location_name,
      data.contact_info || null,
      data.availability,
    ],
  );
  return presentTeam({ ...result.rows[0], active_assignment_count: 0 });
}

async function updateTeam(id, data, client = db) {
  const fields = [];
  const params = [];
  const add = (column, value, cast = '') => {
    params.push(value);
    fields.push(`${column} = $${params.length}${cast}`);
  };
  if (data.team_name !== undefined) add('team_name', data.team_name);
  if (data.primary_category !== undefined) add('primary_category', data.primary_category);
  if (data.capabilities !== undefined) add('capabilities', data.capabilities, '::text[]');
  if (data.latitude !== undefined) add('latitude', data.latitude);
  if (data.longitude !== undefined) add('longitude', data.longitude);
  if (data.base_location_name !== undefined) add('base_location_name', data.base_location_name);
  if (data.contact_info !== undefined) add('contact_info', data.contact_info);
  if (data.availability !== undefined) add('availability', data.availability);
  params.push(id);
  const result = await client.query(
    `UPDATE rescue_teams SET ${fields.join(', ')} WHERE id = $${params.length}
     RETURNING id, team_name, availability, primary_category, capabilities, latitude, longitude,
       base_location_name, contact_info, created_at`,
    params,
  );
  return result.rows[0] ? presentTeam(result.rows[0]) : null;
}

module.exports = { listTeams, findById, createTeam, updateTeam };
