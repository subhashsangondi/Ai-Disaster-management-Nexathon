const db = require('../config/database');
const teamRepository = require('../repositories/teamRepository');
const { AppError } = require('../utils/apiResponse');

function normalizeDatabaseError(error) {
  if (error.code === '23505') throw new AppError(409, 'A rescue team with this name already exists');
  if (error.code === '23514') throw new AppError(400, 'Rescue team data violates a database constraint');
  throw error;
}

async function createTeam({ data, actorId }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const team = await teamRepository.createTeam(data, client);
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'rescue_team_created', 'rescue_team', $2, $3::jsonb)`,
      [actorId, team.id, JSON.stringify({ team_name: team.team_name, availability: team.availability })],
    );
    await client.query('COMMIT');
    return team;
  } catch (error) {
    await client.query('ROLLBACK');
    normalizeDatabaseError(error);
  } finally {
    client.release();
  }
}

async function updateTeam({ teamId, data, actorId }, database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT team.*,
         (SELECT COUNT(*)::int FROM incidents active
          WHERE active.assigned_team_id = team.id AND active.status <> 'resolved') AS active_assignment_count
       FROM rescue_teams team WHERE team.id = $1 FOR UPDATE OF team`,
      [teamId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AppError(404, 'Rescue team not found');
    if (data.availability && current.active_assignment_count > 0) {
      throw new AppError(409, 'A team with active incidents cannot be manually marked available or offline');
    }
    const team = await teamRepository.updateTeam(teamId, data, client);
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'rescue_team_updated', 'rescue_team', $2, $3::jsonb)`,
      [actorId, teamId, JSON.stringify({ changed_fields: Object.keys(data) })],
    );
    await client.query('COMMIT');
    return { ...team, active_assignment_count: current.active_assignment_count };
  } catch (error) {
    await client.query('ROLLBACK');
    normalizeDatabaseError(error);
  } finally {
    client.release();
  }
}

module.exports = { createTeam, updateTeam };
