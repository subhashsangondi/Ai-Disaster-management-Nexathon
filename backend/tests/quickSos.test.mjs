import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = require('../src/config/env');
const db = require('../src/config/database');
const incidentRepository = require('../src/repositories/incidentRepository');
const trackingService = require('../src/services/trackingService');
const aiService = require('../src/services/aiService');
const duplicateService = require('../src/services/duplicateService');
const { buildPrompt } = require('../src/services/ai/analysisContract');
const { capabilityRuleFor, scoreCapabilities } = require('../src/services/teamRecommendationService');

const incidentId = '30000000-0000-4000-8000-000000000001';
const operatorId = '10000000-0000-4000-8000-000000000001';
const responderId = '10000000-0000-4000-8000-000000000003';
const operatorToken = jwt.sign({ user_id: operatorId, role: 'operator' }, env.JWT_SECRET, { algorithm: 'HS256' });
const responderToken = jwt.sign({ user_id: responderId, role: 'responder' }, env.JWT_SECRET, { algorithm: 'HS256' });
const trackingToken = 'x'.repeat(43);
const phone = '+919876543210';

// The SOS rate limiter lives in the route module; reload it per test so this file's many
// submissions are not throttled. Repositories and services stay cached so spies still apply.
function freshApp() {
  for (const key of Object.keys(require.cache)) {
    if (/[\\/]src[\\/](app|routes[\\/](sos|public)Routes)\.js$/.test(key)) delete require.cache[key];
  }
  return require('../src/app');
}

let app;
beforeEach(() => {
  vi.restoreAllMocks();
  app = freshApp();
});

function mockCreate() {
  return vi.spyOn(incidentRepository, 'createIncident').mockImplementation(async (data) => ({
    id: incidentId,
    status: 'pending',
    submission_mode: data.submission_mode,
    triage_status: data.triage_status,
  }));
}

describe('Quick SOS submission', () => {
  it('accepts a location-only Quick SOS without description, type, or contact number', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({
      submission_mode: 'quick_sos',
      latitude: 12.871,
      longitude: 74.842,
      location_accuracy_meters: 15,
      location_captured_at: '2026-10-24T09:00:00.000Z',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      incident_id: incidentId,
      status: 'pending',
      submission_mode: 'quick_sos',
      analysis_status: 'not_applicable',
      triage_status: 'needs_immediate_triage',
    });
    expect(response.body.data.tracking_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const stored = create.mock.calls[0][0];
    expect(stored).toMatchObject({
      submission_mode: 'quick_sos',
      emergency_type: 'Unknown',
      description: null,
      triage_status: 'needs_immediate_triage',
      latitude: 12.871,
      longitude: 74.842,
      location_accuracy_meters: 15,
    });
    expect(stored.contact_number).toBeUndefined();
    expect(stored).not.toHaveProperty('severity');
    expect(stored).not.toHaveProperty('urgency');
  });

  it('stores numeric-string Quick SOS coordinates as numbers', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({ submission_mode: 'quick_sos', latitude: '13.25359', longitude: ' 74.78431 ' });
    expect(response.status).toBe(201);
    expect(create.mock.calls[0][0]).toMatchObject({ latitude: 13.25359, longitude: 74.78431 });
  });

  it('returns Quick SOS coordinates in the operator incident list', async () => {
    vi.spyOn(incidentRepository, 'listIncidents').mockResolvedValue({
      incidents: [{
        id: incidentId,
        submission_mode: 'quick_sos',
        emergency_type: 'Unknown',
        triage_status: 'needs_immediate_triage',
        status: 'pending',
        latitude: 13.25359,
        longitude: 74.78431,
        latest_analysis: null,
      }],
      pagination: { page: 1, limit: 100, total: 1, total_pages: 1 },
    });
    const response = await request(app).get('/api/incidents?page=1&limit=100').set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.incidents[0]).toMatchObject({ latitude: 13.25359, longitude: 74.78431, emergency_type: 'Unknown' });
  });

  it('accepts a manual-location Quick SOS fallback', async () => {
    mockCreate();
    const response = await request(app).post('/api/sos').send({ submission_mode: 'quick_sos', location_text: 'Near the bus stand' });
    expect(response.status).toBe(201);
  });

  it('rejects a Quick SOS without any location', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({ submission_mode: 'quick_sos' });
    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('location_text');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid Quick SOS coordinates, accuracy, and timestamps', async () => {
    const create = mockCreate();
    const invalidBodies = [
      { submission_mode: 'quick_sos', latitude: 91, longitude: 10 },
      { submission_mode: 'quick_sos', latitude: 10, longitude: 181 },
      { submission_mode: 'quick_sos', latitude: 10 },
      { submission_mode: 'quick_sos', latitude: 10, longitude: 10, location_accuracy_meters: -5 },
      { submission_mode: 'quick_sos', latitude: 10, longitude: 10, location_captured_at: 'yesterday' },
    ];
    for (const body of invalidBodies) {
      const response = await request(app).post('/api/sos').send(body);
      expect(response.status).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('does not let a Quick SOS submit its own severity', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({
      submission_mode: 'quick_sos', latitude: 1, longitude: 1, urgency: 'critical',
    });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('optional contact number', () => {
  it('normalizes and stores a contact number on a detailed report', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'Flood',
      description: 'Water is entering the ground floor.',
      location_text: 'River Road',
      contact_number: '+91 98765-43210',
    });
    expect(response.status).toBe(201);
    expect(create.mock.calls[0][0]).toMatchObject({ submission_mode: 'detailed', contact_number: phone });
    expect(JSON.stringify(response.body)).not.toContain('98765');
  });

  it('accepts international numbers and an empty field', async () => {
    const create = mockCreate();
    for (const contact of ['+44 20 7946 0958', '(022) 2345-6789', '']) {
      const response = await request(app).post('/api/sos').send({
        emergency_type: 'Fire', description: 'Smoke from the second floor.', location_text: 'Market', contact_number: contact,
      });
      expect(response.status).toBe(201);
    }
    expect(create.mock.calls[0][0].contact_number).toBe('+442079460958');
    expect(create.mock.calls[2][0].contact_number).toBeNull();
  });

  it('rejects malformed numbers without echoing the value', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'Fire', description: 'Smoke from the second floor.', location_text: 'Market', contact_number: '12ab-secret',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('contact_number');
    expect(JSON.stringify(response.body)).not.toContain('12ab-secret');
  });

  it('keeps existing detailed reports working without the new fields', async () => {
    const create = mockCreate();
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'landslide', description: 'Three people are trapped under debris.', latitude: 12.9, longitude: 74.8,
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ submission_mode: 'detailed', analysis_status: 'pending' });
    expect(create.mock.calls[0][0].triage_status).toBe('not_required');
  });

  it('still requires a description for detailed reports', async () => {
    const response = await request(app).post('/api/sos').send({ emergency_type: 'Flood', location_text: 'Road' });
    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('description');
  });

  it('never sends a contact number to the AI providers', () => {
    const prompt = buildPrompt({
      emergency_type: 'Flood', description: 'Water rising.', latitude: 1, longitude: 2, location_text: 'Road', contact_number: phone,
    });
    expect(prompt).not.toContain('9876543210');
  });
});

describe('Quick SOS analysis and triage', () => {
  it('skips AI analysis for location-only reports', async () => {
    vi.spyOn(incidentRepository, 'getIncidentById').mockResolvedValue({
      id: incidentId, emergency_type: 'Unknown', description: null, submission_mode: 'quick_sos',
    });
    const analyze = vi.spyOn(aiService, 'analyzeIncident');
    const response = await request(app).post(`/api/incidents/${incidentId}/analyze`).set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/operator triage/);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('records operator triage with type and severity', async () => {
    const triage = vi.spyOn(incidentRepository, 'triageIncident').mockResolvedValue({
      id: incidentId, emergency_type: 'Fire', assessed_severity: 'high', triage_status: 'assessed',
    });
    const response = await request(app).patch(`/api/incidents/${incidentId}/triage`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ emergency_type: 'Fire', severity: 'high' });
    expect(response.status).toBe(200);
    expect(triage).toHaveBeenCalledWith({ incidentId, emergencyType: 'Fire', severity: 'high', operatorId });
  });

  it('rejects invalid severities and non-operators', async () => {
    const triage = vi.spyOn(incidentRepository, 'triageIncident');
    const invalid = await request(app).patch(`/api/incidents/${incidentId}/triage`)
      .set('Authorization', `Bearer ${operatorToken}`).send({ emergency_type: 'Fire', severity: 'extreme' });
    expect(invalid.status).toBe(400);
    const responder = await request(app).patch(`/api/incidents/${incidentId}/triage`)
      .set('Authorization', `Bearer ${responderToken}`).send({ emergency_type: 'Fire', severity: 'high' });
    expect(responder.status).toBe(403);
    const anonymous = await request(app).patch(`/api/incidents/${incidentId}/triage`).send({ emergency_type: 'Fire', severity: 'high' });
    expect(anonymous.status).toBe(401);
    expect(triage).not.toHaveBeenCalled();
  });

  it('restricts incident details (including contact numbers) to operators and admins', async () => {
    vi.spyOn(incidentRepository, 'getIncidentById').mockResolvedValue({ id: incidentId, contact_number: phone });
    const anonymous = await request(app).get(`/api/incidents/${incidentId}`);
    expect(anonymous.status).toBe(401);
    const responder = await request(app).get(`/api/incidents/${incidentId}`).set('Authorization', `Bearer ${responderToken}`);
    expect(responder.status).toBe(403);
    const operator = await request(app).get(`/api/incidents/${incidentId}`).set('Authorization', `Bearer ${operatorToken}`);
    expect(operator.status).toBe(200);
    expect(operator.body.data.contact_number).toBe(phone);
  });

  it('does not treat two unassessed Quick SOS reports as the same emergency type', async () => {
    const now = new Date().toISOString();
    const repository = {
      findDuplicateCandidates: vi.fn().mockResolvedValue([
        { id: 'other', emergency_type: 'Unknown', description: null, latitude: null, longitude: null, location_text: 'Somewhere', created_at: now },
      ]),
    };
    const matches = await duplicateService.findPossibleDuplicates(
      { id: incidentId, emergency_type: 'Unknown', description: null, latitude: null, longitude: null, location_text: 'Elsewhere', created_at: now },
      { repository, radiusKm: 5, lookbackHours: 6 },
    );
    expect(matches).toEqual([]);
  });
});

describe('public tracking privacy', () => {
  it('tracks a Quick SOS without exposing the contact number or coordinates', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: incidentId, emergency_type: 'Unknown', submission_mode: 'quick_sos', status: 'pending',
        created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T09:00:00Z',
        contact_number: phone, latitude: 12.8, longitude: 74.8,
      }] }),
    };
    const tracked = await trackingService.trackIncident(trackingToken, database);
    expect(tracked).toEqual({
      incident_reference: incidentId,
      emergency_type: 'Unknown',
      submission_mode: 'quick_sos',
      status: 'pending',
      submitted_at: '2026-10-24T09:00:00Z',
      last_updated_at: '2026-10-24T09:00:00Z',
      progress_messages: ['Your Quick SOS location has been received and is awaiting operator triage.'],
    });
    expect(database.query.mock.calls[0][0]).not.toContain('contact_number');
  });

  it('lets the token holder add a type and contact number but only returns a provided flag', async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: incidentId, emergency_type: 'Fire', triage_status: 'needs_immediate_triage', contact_number_provided: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const result = await trackingService.updateQuickSosDetails(trackingToken, { emergency_type: 'Fire', contact_number: phone }, database);
    expect(result).toEqual({
      incident_reference: incidentId,
      emergency_type: 'Fire',
      contact_number_provided: true,
      awaiting_operator_triage: true,
    });
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain("submission_mode = 'quick_sos'");
    expect(sql).toContain("triage_status = 'needs_immediate_triage'");
    expect(sql).toContain("status <> 'resolved'");
    expect(params[0]).toBe(trackingService.hashTrackingToken(trackingToken));
    expect(database.query.mock.calls[1][1][1]).not.toContain('9876543210');
  });

  it('rejects details for unknown tokens, detailed reports, or resolved incidents', async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(trackingService.updateQuickSosDetails(trackingToken, { emergency_type: 'Fire' }, database))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(trackingService.updateQuickSosDetails('short', { emergency_type: 'Fire' }, database))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('validates the public details endpoint and never accepts arbitrary incident fields', async () => {
    const update = vi.spyOn(trackingService, 'updateQuickSosDetails').mockResolvedValue({ incident_reference: incidentId });
    const url = '/api/public/incidents/track/details';
    const invalidBodies = [
      { status: 'resolved' },
      { emergency_type: 'Volcano' },
      {},
      { contact_number: 'not-a-number' },
    ];
    for (const body of invalidBodies) {
      const response = await request(app).patch(url).set('X-Incident-Tracking-Token', trackingToken).send(body);
      expect(response.status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();

    const ok = await request(app).patch(url).set('X-Incident-Tracking-Token', trackingToken)
      .send({ emergency_type: 'Medical', contact_number: '98765 43210' });
    expect(ok.status).toBe(200);
    expect(update).toHaveBeenCalledWith(trackingToken, { emergency_type: 'Medical', contact_number: '9876543210' });
  });
});

describe('incident repository', () => {
  it('inserts Quick SOS fields and the tracking token in one transaction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: incidentId, submission_mode: 'quick_sos' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    vi.spyOn(db.pool, 'connect').mockResolvedValue({ query, release: vi.fn() });
    await incidentRepository.createIncident({
      emergency_type: 'Unknown',
      description: null,
      latitude: 1,
      longitude: 2,
      submission_mode: 'quick_sos',
      triage_status: 'needs_immediate_triage',
      location_accuracy_meters: 12,
      location_captured_at: '2026-10-24T09:00:00.000Z',
      contact_number: phone,
      tracking_token_hash: 'a'.repeat(64),
    });
    expect(query.mock.calls[1][1]).toEqual([
      null, 'Unknown', null, 1, 2, null, 'quick_sos', phone, 12, '2026-10-24T09:00:00.000Z', 'needs_immediate_triage',
    ]);
    expect(query.mock.calls[3][0]).toBe('COMMIT');
  });
});

describe('team recommendations for Quick SOS', () => {
  it('does not fabricate a capability match for an unknown emergency type', () => {
    expect(capabilityRuleFor('Unknown')).toBeNull();
    const specialist = scoreCapabilities(['fire_suppression'], 'Unknown', null);
    expect(specialist).toMatchObject({ score: 0, matched: null, matched_capabilities: [] });
  });

  it('maps every victim-selectable Quick SOS type except Other to a specialist rule', () => {
    for (const type of ['Fire', 'Flood', 'Medical', 'Accident', 'Trapped']) {
      expect(capabilityRuleFor(type)).not.toBeNull();
    }
    expect(capabilityRuleFor('Other').category).toBe('general_disaster_response');
  });
});
