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
      { rows: [] },
      { rows: [{ id: teamId, team_name: 'Alpha', availability: 'available' }] },
      { rows: [{ id: '40000000-0000-4000-8000-000000000001', incident_id: incidentId, team_id: teamId }] },
      { rows: [{ id: '60000000-0000-4000-8000-000000000001', assignment_id: '40000000-0000-4000-8000-000000000001' }] },
      {},
      {},
      {},
    ]);

    const result = await assignTeam({ incidentId, teamId, assignedBy: operatorId }, database);
    expect(result.assignment.incident_id).toBe(incidentId);
    expect(result.notification.assignment_id).toBe('40000000-0000-4000-8000-000000000001');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO assignment_notifications'))).toBe(true);
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

  it('blocks a new assignment on a linked duplicate', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }] },
      { rows: [{ primary_incident_id: '30000000-0000-4000-8000-000000000002', duplicate_incident_id: incidentId, duplicate_has_assignment: false }] },
      {},
    ]);
    await expect(assignTeam({ incidentId, teamId, assignedBy: operatorId }, database))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/linked duplicate/i) });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('blocks a primary assignment when a linked incident already has one', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }] },
      { rows: [{ primary_incident_id: incidentId, duplicate_incident_id: '30000000-0000-4000-8000-000000000002', duplicate_has_assignment: true }] },
      {},
    ]);
    await expect(assignTeam({ incidentId, teamId, assignedBy: operatorId }, database))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/linked incident already has an assignment/i) });
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
