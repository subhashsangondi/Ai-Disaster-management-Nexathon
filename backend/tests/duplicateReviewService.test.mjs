import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../src/app');
const env = require('../src/config/env');
const duplicateReviewService = require('../src/services/duplicateReviewService');

const incidentId = '30000000-0000-4000-8000-000000000001';
const duplicateId = '30000000-0000-4000-8000-000000000002';
const operatorId = '10000000-0000-4000-8000-000000000001';
const responderId = '10000000-0000-4000-8000-000000000003';
const candidateId = '90000000-0000-4000-8000-000000000001';
const reviewId = '91000000-0000-4000-8000-000000000001';
const operatorToken = jwt.sign({ user_id: operatorId, role: 'operator' }, env.JWT_SECRET, { algorithm: 'HS256' });
const responderToken = jwt.sign({ user_id: responderId, role: 'responder' }, env.JWT_SECRET, { algorithm: 'HS256' });

function fakeDatabase(responses) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  return { database: { pool: { connect: vi.fn().mockResolvedValue(client) }, query }, client };
}

beforeEach(() => vi.restoreAllMocks());

describe('operator-reviewed duplicate links', () => {
  it('records a rejection without linking or changing either incident', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }, { id: duplicateId, status: 'pending', assigned_team_id: null }] },
      { rows: [{ id: candidateId }] },
      { rows: [] },
      { rows: [{ id: reviewId, decision: 'rejected' }] },
      {},
      {},
    ]);
    const result = await duplicateReviewService.reviewDuplicate({ incidentId, duplicateIncidentId: duplicateId, decision: 'rejected', reason: 'Reports concern different buildings.', operatorId }, database);
    expect(result.review.decision).toBe('rejected');
    expect(result.link).toBeNull();
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO incident_duplicate_links'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE incidents'))).toBe(false);
  });

  it('links an operator-confirmed pair while preserving both incident rows', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'pending', assigned_team_id: null }, { id: duplicateId, status: 'pending', assigned_team_id: null }] },
      { rows: [{ id: candidateId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: reviewId, decision: 'confirmed', primary_incident_id: incidentId }] },
      { rows: [] },
      { rows: [{ id: '92000000-0000-4000-8000-000000000001', primary_incident_id: incidentId, duplicate_incident_id: duplicateId }] },
      {},
      {},
    ]);
    const result = await duplicateReviewService.reviewDuplicate({ incidentId, duplicateIncidentId: duplicateId, decision: 'confirmed', primaryIncidentId: incidentId, assignmentConflictAcknowledged: false, operatorId }, database);
    expect(result.link).toMatchObject({ primary_incident_id: incidentId, duplicate_incident_id: duplicateId });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE incidents'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_events'))).toBe(true);
  });

  it('requires explicit handling when both incidents already have assignments', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'assigned', assigned_team_id: '20000000-0000-4000-8000-000000000001' }, { id: duplicateId, status: 'assigned', assigned_team_id: '20000000-0000-4000-8000-000000000002' }] },
      { rows: [{ id: candidateId }] },
      { rows: [] },
      { rows: [] },
      {},
    ]);
    await expect(duplicateReviewService.reviewDuplicate({ incidentId, duplicateIncidentId: duplicateId, decision: 'confirmed', primaryIncidentId: incidentId, assignmentConflictAcknowledged: false, operatorId }, database))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/explicit conflict acknowledgment/i) });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('preserves dual assignments only after explicit operator acknowledgment', async () => {
    const { database } = fakeDatabase([
      {},
      { rows: [{ id: incidentId, status: 'assigned', assigned_team_id: '20000000-0000-4000-8000-000000000001' }, { id: duplicateId, status: 'assigned', assigned_team_id: '20000000-0000-4000-8000-000000000002' }] },
      { rows: [{ id: candidateId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: reviewId, decision: 'confirmed', primary_incident_id: incidentId }] },
      { rows: [] },
      { rows: [{ id: '92000000-0000-4000-8000-000000000001', primary_incident_id: incidentId, duplicate_incident_id: duplicateId, assignment_conflict_acknowledged: true }] },
      {},
      {},
    ]);
    const result = await duplicateReviewService.reviewDuplicate({ incidentId, duplicateIncidentId: duplicateId, decision: 'confirmed', primaryIncidentId: incidentId, assignmentConflictAcknowledged: true, operatorId }, database);
    expect(result.link.assignment_conflict_acknowledged).toBe(true);
  });

  it('does not allow responders to review duplicate candidates', async () => {
    const response = await request(app)
      .post(`/api/incidents/${incidentId}/duplicates/${duplicateId}/review`)
      .set('Authorization', `Bearer ${responderToken}`)
      .send({ decision: 'rejected', reason: 'Reports concern different buildings.' });
    expect(response.status).toBe(403);
  });

  it('validates the selected primary through the operator endpoint', async () => {
    const response = await request(app)
      .post(`/api/incidents/${incidentId}/duplicates/${duplicateId}/review`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ decision: 'confirmed' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
