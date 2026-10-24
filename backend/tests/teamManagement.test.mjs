import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../src/app');
const env = require('../src/config/env');
const teamRepository = require('../src/repositories/teamRepository');
const teamService = require('../src/services/teamService');
const recommendationService = require('../src/services/teamRecommendationService');

const teamId = '20000000-0000-4000-8000-000000000001';
const incidentId = '30000000-0000-4000-8000-000000000001';
const adminId = '10000000-0000-4000-8000-000000000002';
const operatorId = '10000000-0000-4000-8000-000000000001';
const responderId = '10000000-0000-4000-8000-000000000003';
const sign = (userId, role) => jwt.sign({ user_id: userId, role }, env.JWT_SECRET, { algorithm: 'HS256' });
const adminToken = sign(adminId, 'admin');
const operatorToken = sign(operatorId, 'operator');
const responderToken = sign(responderId, 'responder');

const validTeam = {
  team_name: 'Coastal Rescue One',
  capabilities: ['Flood response', 'Medical first aid'],
  base_location_name: 'Harbor Station',
  latitude: 12.9716,
  longitude: 77.5946,
  availability: 'available',
};

function fakeDatabase(responses) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  return { database: { pool: { connect: vi.fn().mockResolvedValue(client) }, query }, client };
}

beforeEach(() => vi.restoreAllMocks());

describe('team registration and role authorization', () => {
  it('allows an admin to register a validated rescue team', async () => {
    vi.spyOn(teamService, 'createTeam').mockResolvedValue({ id: teamId, ...validTeam });
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`).send(validTeam);
    expect(response.status).toBe(201);
    expect(response.body.data.team_name).toBe(validTeam.team_name);
    expect(teamService.createTeam).toHaveBeenCalledWith(expect.objectContaining({ actorId: adminId, data: validTeam }));
  });

  it.each([
    [{ ...validTeam, team_name: 'x' }, 'team_name'],
    [{ ...validTeam, latitude: 91 }, 'latitude'],
    [{ ...validTeam, longitude: -181 }, 'longitude'],
    [{ ...validTeam, capabilities: [] }, 'capabilities'],
    [{ ...validTeam, availability: 'busy' }, 'availability'],
  ])('rejects invalid registration data', async (body, field) => {
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(response.status).toBe(400);
    expect(response.body.errors.some((error) => error.field === field)).toBe(true);
  });

  it('rejects missing registration fields', async () => {
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`).send({ team_name: 'Incomplete Team' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('keeps operators read-only and responders outside team management', async () => {
    vi.spyOn(teamRepository, 'listTeams').mockResolvedValue([{ id: teamId, capabilities: null, latitude: null, longitude: null }]);
    const operatorRead = await request(app).get('/api/teams').set('Authorization', `Bearer ${operatorToken}`);
    const operatorWrite = await request(app).post('/api/teams').set('Authorization', `Bearer ${operatorToken}`).send(validTeam);
    const responderRead = await request(app).get('/api/teams').set('Authorization', `Bearer ${responderToken}`);
    expect(operatorRead.status).toBe(200);
    expect(operatorRead.body.data.teams[0].capabilities).toBeNull();
    expect(operatorWrite.status).toBe(403);
    expect(responderRead.status).toBe(403);
  });

  it('allows an admin to edit a team and requires coordinate pairs', async () => {
    vi.spyOn(teamService, 'updateTeam').mockResolvedValue({ id: teamId, team_name: 'Updated Team' });
    const updated = await request(app).patch(`/api/teams/${teamId}`).set('Authorization', `Bearer ${adminToken}`).send({ team_name: 'Updated Team' });
    const invalidLocation = await request(app).patch(`/api/teams/${teamId}`).set('Authorization', `Bearer ${adminToken}`).send({ latitude: 10 });
    expect(updated.status).toBe(200);
    expect(invalidLocation.status).toBe(400);
  });

  it('allows operators to retrieve details but not edit them', async () => {
    vi.spyOn(teamRepository, 'findById').mockResolvedValue({ id: teamId, team_name: 'Legacy Team', capabilities: null });
    const detail = await request(app).get(`/api/teams/${teamId}`).set('Authorization', `Bearer ${operatorToken}`);
    const edit = await request(app).patch(`/api/teams/${teamId}`).set('Authorization', `Bearer ${operatorToken}`).send({ team_name: 'Not Allowed' });
    expect(detail.status).toBe(200);
    expect(detail.body.data.capabilities).toBeNull();
    expect(edit.status).toBe(403);
  });

  it('prevents manual availability changes while active assignments exist', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: teamId, availability: 'busy', active_assignment_count: 1 }] },
      {},
    ]);
    await expect(teamService.updateTeam({ teamId, data: { availability: 'available' }, actorId: adminId }, database))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('deterministic team recommendations', () => {
  it('calculates Haversine straight-line distance', () => {
    expect(recommendationService.haversineDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.2, 1);
    expect(recommendationService.haversineDistanceKm(null, 0, 0, 1)).toBeNull();
  });

  it('ranks capability matches before distance and excludes unavailable teams', () => {
    const ranked = recommendationService.rankTeams([
      { id: 'b', team_name: 'Nearby General', availability: 'available', capabilities: ['General rescue'], latitude: 0, longitude: 0.1 },
      { id: 'a', team_name: 'Flood Specialists', availability: 'available', capabilities: ['Flood response'], latitude: 0, longitude: 1 },
      { id: 'c', team_name: 'Busy Flood Team', availability: 'busy', capabilities: ['Flood response'], latitude: 0, longitude: 0.01 },
    ], { emergency_type: 'flood', latitude: 0, longitude: 0 });
    expect(ranked.map((team) => team.team_name)).toEqual(['Flood Specialists', 'Nearby General']);
    expect(ranked[0].rank).toBe(1);
  });

  it('orders comparable matches by distance, then deterministically by name', () => {
    const ranked = recommendationService.rankTeams([
      { id: 'c', team_name: 'Zulu', availability: 'available', capabilities: ['Flood response'], latitude: null, longitude: null },
      { id: 'b', team_name: 'Bravo', availability: 'available', capabilities: ['Flood response'], latitude: 0, longitude: 1 },
      { id: 'a', team_name: 'Alpha', availability: 'available', capabilities: ['Flood response'], latitude: 0, longitude: 1 },
    ], { emergency_type: 'flood', latitude: 0, longitude: 0 });
    expect(ranked.map((team) => team.team_name)).toEqual(['Alpha', 'Bravo', 'Zulu']);
    expect(ranked[2].distance_km).toBeNull();
  });

  it('returns no invented recommendation for missing or unsuitable capabilities', () => {
    const ranked = recommendationService.rankTeams([
      { id: 'a', team_name: 'Legacy', availability: 'available', capabilities: null, latitude: 0, longitude: 0 },
      { id: 'b', team_name: 'Fire Only', availability: 'available', capabilities: ['Fire suppression'], latitude: 0, longitude: 0 },
    ], { emergency_type: 'flood', latitude: 0, longitude: 0 });
    expect(ranked).toEqual([]);
  });

  it('blocks recommendations for a confirmed linked duplicate', async () => {
    const database = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: incidentId, status: 'pending', assigned_team_id: null, is_linked_duplicate: true, linked_incident_has_assignment: false }] }) };
    const result = await recommendationService.getTeamRecommendations(incidentId, database);
    expect(result.assignment_allowed).toBe(false);
    expect(result.recommendations).toEqual([]);
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('exposes recommendations to operators but not responders', async () => {
    vi.spyOn(recommendationService, 'getTeamRecommendations').mockResolvedValue({ incident_id: incidentId, assignment_allowed: true, recommendations: [] });
    const operatorResponse = await request(app).get(`/api/incidents/${incidentId}/team-recommendations`).set('Authorization', `Bearer ${operatorToken}`);
    const responderResponse = await request(app).get(`/api/incidents/${incidentId}/team-recommendations`).set('Authorization', `Bearer ${responderToken}`);
    expect(operatorResponse.status).toBe(200);
    expect(operatorResponse.body.data.assignment_allowed).toBe(true);
    expect(responderResponse.status).toBe(403);
  });

  it('returns a clear explanation when no eligible team matches', async () => {
    const database = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: incidentId, emergency_type: 'flood', status: 'pending', assigned_team_id: null, is_linked_duplicate: false, linked_incident_has_assignment: false, latitude: 0, longitude: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: teamId, team_name: 'Fire Only', availability: 'available', capabilities: ['Fire suppression'], latitude: 0, longitude: 0 }] }) };
    const result = await recommendationService.getTeamRecommendations(incidentId, database);
    expect(result.recommendations).toEqual([]);
    expect(result.message).toMatch(/no available team has a verified capability match/i);
  });
});
