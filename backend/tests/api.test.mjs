import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../src/app');
const env = require('../src/config/env');
const incidentRepository = require('../src/repositories/incidentRepository');
const assignmentService = require('../src/services/assignmentService');
const { AppError } = require('../src/utils/apiResponse');

const incidentId = '30000000-0000-4000-8000-000000000001';
const teamId = '20000000-0000-4000-8000-000000000001';
const operatorId = '10000000-0000-4000-8000-000000000001';
const operatorToken = jwt.sign(
  { user_id: operatorId, role: 'operator' },
  env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SOS reporting', () => {
  it('persists a valid unauthenticated SOS before returning 201', async () => {
    const create = vi.spyOn(incidentRepository, 'createIncident').mockResolvedValue({
      id: incidentId,
      status: 'pending',
    });

    const response = await request(app).post('/api/sos').send({
      emergency_type: 'landslide',
      description: 'Three people are trapped under debris.',
      latitude: 12.9141,
      longitude: 74.856,
      location_text: 'Near the demo village bridge',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ incident_id: incidentId, status: 'pending' });
    expect(response.body.data.tracking_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(response.body.data.notice).toMatch(/not confirmation/i);
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects a request without coordinates or location text', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor.',
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].field).toBe('location_text');
  });

  it('rejects invalid coordinates', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor.',
      latitude: 120,
      longitude: 74.856,
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.some((error) => error.field === 'latitude')).toBe(true);
  });

  it('rejects an invalid request body', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'fire',
      description: 'short',
      location_text: 'Demo site',
      unexpected: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });
});

describe('protected incident operations', () => {
  it('returns incidents to an operator', async () => {
    vi.spyOn(incidentRepository, 'listIncidents').mockResolvedValue({
      incidents: [{ id: incidentId, status: 'pending' }],
      pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
    });
    const response = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.incidents).toHaveLength(1);
  });

  it('rejects access without authentication', async () => {
    const response = await request(app).get('/api/incidents');
    expect(response.status).toBe(401);
  });

  it('rejects an invalid JWT', async () => {
    const response = await request(app)
      .get('/api/incidents')
      .set('Authorization', 'Bearer not-a-valid-token');
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/invalid or expired/i);
  });

  it('assigns a rescue team through the protected endpoint', async () => {
    vi.spyOn(assignmentService, 'assignTeam').mockResolvedValue({
      assignment: { incident_id: incidentId, team_id: teamId },
    });
    const response = await request(app)
      .patch(`/api/incidents/${incidentId}/assign`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ team_id: teamId });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Rescue team assigned');
  });

  it('returns 409 for a conflicting assignment', async () => {
    vi.spyOn(assignmentService, 'assignTeam')
      .mockRejectedValue(new AppError(409, 'Incident already has an assignment'));
    const response = await request(app)
      .patch(`/api/incidents/${incidentId}/assign`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ team_id: teamId });
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
