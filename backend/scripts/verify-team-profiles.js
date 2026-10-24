const db = require('../src/config/database');
const teamRepository = require('../src/repositories/teamRepository');

async function main() {
  const column = await db.query(
    `SELECT count(*)::int AS count
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'rescue_teams'
       AND column_name = 'primary_category'`,
  );
  const teams = await db.query(
    `SELECT count(*)::int AS total,
            count(primary_category)::int AS categorized,
            count(*) FILTER (
              WHERE primary_category IS NULL
                 OR capabilities IS NULL
                 OR base_location_name IS NULL
                 OR latitude IS NULL
                 OR longitude IS NULL
            )::int AS incomplete
     FROM rescue_teams`,
  );
  const projectedTeams = await teamRepository.listTeams();
  if (column.rows[0].count !== 1) throw new Error('primary_category column is unavailable');
  if (projectedTeams.length !== teams.rows[0].total) throw new Error('team repository did not preserve every existing team');
  if (projectedTeams.some((team) => typeof team.profile_complete !== 'boolean')) {
    throw new Error('team repository did not return profile completeness metadata');
  }
  console.log(JSON.stringify({
    primary_category_column_present: true,
    existing_teams: teams.rows[0].total,
    categorized_teams: teams.rows[0].categorized,
    incomplete_teams: teams.rows[0].incomplete,
    repository_projection_verified: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
