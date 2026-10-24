import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../src/app');
const env = require('../src/config/env');
const responseService = require('../src/services/responseService');
const trackingService = require('../src/services/trackingService');

const incidentId = '30000000-0000-4000-8000-000000000001';
const assignmentId = '40000000-0000-4000-8000-000000000001';
const teamId = '20000000-0000-4000-8000-000000000001';
const responderId = '10000000-0000-4000-8000-000000000003';
const operatorId = '10000000-0000-4000-8000-000000000001';
const responderToken = jwt.sign({ user_id: responderId, role: 'responder' }, env.JWT_SECRET, { algorithm: 'HS256' });
const operatorToken = jwt.sign({ user_id: operatorId, role: 'operator' }, env.JWT_SECRET, { algorithm: 'HS256' });

function fakeDatabase(responses) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  return { database: { pool: { connect: vi.fn().mockResolvedValue(client) }, query }, client };
}

beforeEach(() => vi.restoreAllMocks());

describe('responder authorization and notifications', () => {
  it('allows a responder to list team-scoped assignments and notifications', async () => {
    vi.spyOn(responseService, 'getResponderAssignments').mockResolvedValue([{ id: assignmentId, team_id: teamId }]);
    vi.spyOn(responseService, 'getResponderNotifications').mockResolvedValue([{ id: '60000000-0000-4000-8000-000000000001', assignment_id: assignmentId }]);

    const assignments = await request(app).get('/api/responder/assignments').set('Authorization', `Bearer ${responderToken}`);
    const notifications = await request(app).get('/api/responder/notifications').set('Authorization', `Bearer ${responderToken}`);
    expect(assignments.status).toBe(200);
    expect(assignments.body.data.assignments).toHaveLength(1);
    expect(notifications.body.data.notifications).toHaveLength(1);
  });

  it('acknowledges once and records responder identity and timestamp server-side', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: assignmentId, incident_id: incidentId, team_id: teamId, progress_status: 'assigned', incident_status: 'assigned' }] },
      {},
      {},
      { rows: [{ assignment_id: assignmentId, acknowledged_by: responderId }] },
      {},
    ]);
    const result = await responseService.acknowledgeAssignment({ assignmentId, userId: responderId }, database);
    expect(result.progress_status).toBe('acknowledged');
    expect(client.query.mock.calls.some(([sql, params]) => sql.includes('assignment_progress_events') && params?.includes(responderId))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not reveal or update an assignment outside the responder team', async () => {
    const { database, client } = fakeDatabase([{}, { rows: [] }, {}]);
    await expect(responseService.acknowledgeAssignment({ assignmentId, userId: responderId }, database))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('append-only assignment progress', () => {
  it('stores a valid next progress event', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: assignmentId, incident_id: incidentId, team_id: teamId, progress_status: 'acknowledged', incident_status: 'assigned' }] },
      { rows: [{ id: '70000000-0000-4000-8000-000000000001', progress_status: 'en_route' }] },
      {},
      {},
    ]);
    const event = await responseService.addProgress({ assignmentId, userId: responderId, progressStatus: 'en_route', notes: 'Departing base' }, database);
    expect(event.progress_status).toBe('en_route');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO assignment_progress_events'))).toBe(true);
  });

  it('rejects skipped progress transitions', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: assignmentId, incident_id: incidentId, team_id: teamId, progress_status: 'acknowledged', incident_status: 'assigned' }] },
      {},
    ]);
    await expect(responseService.addProgress({ assignmentId, userId: responderId, progressStatus: 'arrived' }, database))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('completion reporting and review', () => {
  it('stores a completion report without resolving the incident', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: assignmentId, incident_id: incidentId, team_id: teamId, progress_status: 'rescue_in_progress', incident_status: 'in_progress' }] },
      { rows: [{ id: '80000000-0000-4000-8000-000000000001', review_status: 'pending' }] },
      {},
      {},
      {},
    ]);
    const report = await responseService.submitCompletion({ assignmentId, userId: responderId, summary: 'All reported occupants assisted safely.', peopleAssisted: 3 }, database);
    expect(report.review_status).toBe('pending');
    expect(client.query.mock.calls.some(([sql]) => sql.includes("status = 'resolved'"))).toBe(false);
  });

  it('prevents a responder from using the operator approval route', async () => {
    const response = await request(app)
      .post(`/api/incidents/${incidentId}/completion/approve`)
      .set('Authorization', `Bearer ${responderToken}`);
    expect(response.status).toBe(403);
  });

  it('lets an operator approve atomically, resolve the incident, audit it, and safely release the team', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ incident_id: incidentId, incident_status: 'in_progress', assignment_id: assignmentId, team_id: teamId, progress_status: 'completion_requested', report_id: '80000000-0000-4000-8000-000000000001', review_status: 'pending' }] },
      {},
      { rows: [{ decision: 'approved' }] },
      {},
      {},
      {},
      {},
      {},
    ]);
    const decision = await responseService.reviewCompletion({ incidentId, operatorId, decision: 'approved' }, database);
    expect(decision.incident_status).toBe('resolved');
    expect(client.query.mock.calls.some(([sql]) => sql.includes("SET status = 'resolved'"))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE incident_duplicate_links'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('NOT EXISTS'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_events'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('keeps the incident active when completion is rejected', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ incident_id: incidentId, incident_status: 'in_progress', assignment_id: assignmentId, team_id: teamId, progress_status: 'completion_requested', report_id: '80000000-0000-4000-8000-000000000001', review_status: 'pending' }] },
      {},
      { rows: [{ decision: 'rejected', reason: 'Evidence is incomplete' }] },
      {},
      {},
      {},
    ]);
    const decision = await responseService.reviewCompletion({ incidentId, operatorId, decision: 'rejected', reason: 'Evidence is incomplete' }, database);
    expect(decision.incident_status).toBe('in_progress');
    expect(client.query.mock.calls.some(([sql]) => sql.includes("SET status = 'resolved'"))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("progress_status = 'rescue_in_progress'"))).toBe(true);
  });
});

describe('secure victim tracking', () => {
  it('generates an unguessable token and stores/queries only its hash', async () => {
    const credential = trackingService.createTrackingCredential();
    expect(credential.token.length).toBeGreaterThanOrEqual(40);
    expect(credential.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(credential.tokenHash).not.toContain(credential.token);

    const database = { query: vi.fn().mockResolvedValue({ rows: [{ id: incidentId, emergency_type: 'flood', status: 'assigned', created_at: new Date(), updated_at: new Date() }] }) };
    const tracked = await trackingService.trackIncident(credential.token, database);
    expect(tracked).toMatchObject({ incident_reference: incidentId, status: 'assigned' });
    expect(database.query.mock.calls[0][1][0]).toBe(credential.tokenHash);
    expect(database.query.mock.calls[0][1][0]).not.toBe(credential.token);
  });

  it('rejects invalid tokens and never accepts an incident UUID by itself', async () => {
    await expect(trackingService.trackIncident('invalid')).rejects.toMatchObject({ statusCode: 401 });
    const response = await request(app).get(`/api/public/incidents/track?incident_id=${incidentId}`);
    expect(response.status).toBe(401);
  });

  it('returns only the public tracking projection', async () => {
    vi.spyOn(trackingService, 'trackIncident').mockResolvedValue({
      incident_reference: incidentId,
      emergency_type: 'flood',
      status: 'in_progress',
      submitted_at: '2026-01-01T00:00:00Z',
      last_updated_at: '2026-01-01T01:00:00Z',
      progress_messages: ['The rescue response is currently in progress.'],
    });
    const response = await request(app).get('/api/public/incidents/track').set('X-Incident-Tracking-Token', 'x'.repeat(43));
    expect(response.status).toBe(200);
    expect(response.body.data.location_text).toBeUndefined();
    expect(response.body.data.operator).toBeUndefined();
    expect(response.body.data.progress_messages).toHaveLength(1);
  });

  it('uses a verified duplicate-link outcome without exposing the primary incident', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: incidentId,
        emergency_type: 'flood',
        status: 'resolved',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T01:00:00Z',
      }] }),
    };
    const tracked = await trackingService.trackIncident('x'.repeat(43), database);
    expect(tracked).toEqual({
      incident_reference: incidentId,
      emergency_type: 'flood',
      status: 'resolved',
      submitted_at: '2026-01-01T00:00:00Z',
      last_updated_at: '2026-01-01T01:00:00Z',
      progress_messages: ['The rescue response has been verified as completed.'],
    });
    expect(database.query.mock.calls[0][0]).toContain('LEFT JOIN incident_duplicate_links');
    expect(tracked.primary_incident_id).toBeUndefined();
    expect(tracked.location_text).toBeUndefined();
  });
});
