const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await db.pool.query(sql);
  console.log(`Applied ${path.relative(path.resolve(__dirname, '..'), filePath)}`);
}

async function main() {
  const action = process.argv[2] || 'migrate';
  const backendRoot = path.resolve(__dirname, '..');
  if (action === 'migrate') {
    const migrationDirectory = path.join(backendRoot, 'db', 'migrations');
    const files = fs.readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) await runSqlFile(path.join(migrationDirectory, file));
    return;
  }
  if (action === 'seed') {
    await runSqlFile(path.join(backendRoot, 'db', 'seed.sql'));
    return;
  }
  throw new Error(`Unknown database action: ${action}`);
}

main()
  .catch((error) => {
    console.error(`Database operation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
