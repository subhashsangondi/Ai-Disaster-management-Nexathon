import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assignTeam, updateIncidentStatus } = require('../src/services/assignmentService');

const incidentId = '30000000-0000-4000-8000-000000000001';
const teamId = '20000000-0000-4000-8000-000000000001';
const operatorId = '10000000-0000-4000-8000-000000000001';

function fakeDatabase(responses) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  return { database: { pool: { connect: vi.fn().mockResolvedValue(client) } }, client };
}

describe('transactional team assignment', () => {
  it('assigns an available team and commits atomically', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }] },
      { rows: [{ id: teamId, team_name: 'Alpha', availability: 'available' }] },
      { rows: [{ id: '40000000-0000-4000-8000-000000000001', incident_id: incidentId, team_id: teamId }] },
      {},
      {},
      {},
    ]);

    const result = await assignTeam({ incidentId, teamId, assignedBy: operatorId }, database);
    expect(result.assignment.incident_id).toBe(incidentId);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back a conflicting assignment', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'assigned', assigned_team_id: teamId }] },
      {},
    ]);
    await expect(assignTeam({ incidentId, teamId, assignedBy: operatorId }, database))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('incident status transitions', () => {
  it('allows assigned to in_progress', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'assigned', assigned_team_id: teamId }] },
      { rows: [{ id: incidentId, status: 'in_progress' }] },
      {},
    ]);
    const result = await updateIncidentStatus({ incidentId, status: 'in_progress' }, database);
    expect(result.status).toBe('in_progress');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects invalid pending to resolved transitions', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }] },
      {},
    ]);
    await expect(updateIncidentStatus({ incidentId, status: 'resolved' }, database))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
