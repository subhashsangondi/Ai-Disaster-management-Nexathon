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
const { analyzeCapabilities, profileCompleteness, presentTeam } = require('../src/domain/teamProfile');

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
  primary_category: 'flood_water_rescue',
  capabilities: ['flood_response', 'boat_rescue', 'first_aid'],
  base_location_name: 'Harbor Station',
  latitude: 12.9716,
  longitude: 77.5946,
  availability: 'available',
};

function completeTeam(overrides = {}) {
  return {
    id: 'team-a',
    team_name: 'Complete Team',
    primary_category: 'flood_water_rescue',
    availability: 'available',
    capabilities: ['flood_response'],
    base_location_name: 'Station One',
    latitude: 0,
    longitude: 1,
    ...overrides,
  };
}

function fakeDatabase(responses) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  return { database: { pool: { connect: vi.fn().mockResolvedValue(client) }, query }, client };
}

beforeEach(() => vi.restoreAllMocks());

describe('standardized team registration and role authorization', () => {
  it('allows an admin to register a validated team with multiple capabilities', async () => {
    vi.spyOn(teamService, 'createTeam').mockResolvedValue({ id: teamId, ...validTeam });
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`).send(validTeam);
    expect(response.status).toBe(201);
    expect(response.body.data.capabilities).toEqual(validTeam.capabilities);
    expect(teamService.createTeam).toHaveBeenCalledWith(expect.objectContaining({ actorId: adminId, data: validTeam }));
  });

  it.each([
    [{ ...validTeam, team_name: 'x' }, 'team_name'],
    [{ ...validTeam, primary_category: undefined }, 'primary_category'],
    [{ ...validTeam, primary_category: 'invented_category' }, 'primary_category'],
    [{ ...validTeam, latitude: 91 }, 'latitude'],
    [{ ...validTeam, longitude: -181 }, 'longitude'],
    [{ ...validTeam, capabilities: [] }, 'capabilities'],
    [{ ...validTeam, capabilities: ['made_up_skill'] }, 'capabilities.0'],
  ])('rejects invalid registration data', async (body, field) => {
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(response.status).toBe(400);
    expect(response.body.errors.some((error) => error.field === field)).toBe(true);
  });

  it('allows an explicitly busy initial state without creating an assignment', async () => {
    vi.spyOn(teamService, 'createTeam').mockResolvedValue({ id: teamId, ...validTeam, availability: 'busy' });
    const response = await request(app).post('/api/teams').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validTeam, availability: 'busy' });
    expect(response.status).toBe(201);
  });

  it('stores stable category and capability identifiers', async () => {
    const storedRow = { id: teamId, created_at: new Date(), contact_info: null, ...validTeam };
    const { database, client } = fakeDatabase([
      {},
      { rows: [storedRow] },
      {},
      {},
    ]);
    const result = await teamService.createTeam({ data: validTeam, actorId: adminId }, database);
    const insertCall = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO rescue_teams'));
    expect(insertCall[1][1]).toBe('flood_water_rescue');
    expect(insertCall[1][2]).toEqual(['flood_response', 'boat_rescue', 'first_aid']);
    expect(result.profile_complete).toBe(true);
  });

  it('keeps operators read-only and responders outside team management', async () => {
    vi.spyOn(teamRepository, 'listTeams').mockResolvedValue([presentTeam({ id: teamId, team_name: 'Legacy', capabilities: null })]);
    const operatorRead = await request(app).get('/api/teams').set('Authorization', `Bearer ${operatorToken}`);
    const operatorWrite = await request(app).post('/api/teams').set('Authorization', `Bearer ${operatorToken}`).send(validTeam);
    const responderRead = await request(app).get('/api/teams').set('Authorization', `Bearer ${responderToken}`);
    expect(operatorRead.status).toBe(200);
    expect(operatorRead.body.data.teams[0].profile_complete).toBe(false);
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

  it('allows operators to retrieve incomplete details but not edit them', async () => {
    vi.spyOn(teamRepository, 'findById').mockResolvedValue(presentTeam({ id: teamId, team_name: 'Legacy Team', capabilities: null }));
    const detail = await request(app).get(`/api/teams/${teamId}`).set('Authorization', `Bearer ${operatorToken}`);
    const edit = await request(app).patch(`/api/teams/${teamId}`).set('Authorization', `Bearer ${operatorToken}`).send({ team_name: 'Not Allowed' });
    expect(detail.status).toBe(200);
    expect(detail.body.data.profile_complete).toBe(false);
    expect(edit.status).toBe(403);
  });

  it('normalizes known legacy values and preserves unknown values on explicit edit', async () => {
    const current = {
      id: teamId, team_name: 'Legacy Team', availability: 'available', primary_category: null,
      capabilities: ['Flood response', 'Rope specialty'], active_assignment_count: 0,
    };
    const updatedRow = {
      ...current, primary_category: 'flood_water_rescue',
      capabilities: ['flood_response', 'Rope specialty'], base_location_name: 'Legacy Base', latitude: 1, longitude: 2,
    };
    const { database, client } = fakeDatabase([
      {},
      { rows: [current] },
      { rows: [updatedRow] },
      {},
      {},
    ]);
    const result = await teamService.updateTeam({
      teamId,
      actorId: adminId,
      data: { primary_category: 'flood_water_rescue', capabilities: ['Flood response', 'Rope specialty'] },
    }, database);
    const updateCall = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE rescue_teams'));
    expect(updateCall[1]).toContainEqual(['flood_response', 'Rope specialty']);
    expect(result.legacy_capabilities).toEqual(['Rope specialty']);
  });

  it('rejects a newly invented legacy capability during update', async () => {
    const { database, client } = fakeDatabase([
      {},
      { rows: [{ id: teamId, availability: 'available', capabilities: ['Flood response'], active_assignment_count: 0 }] },
      {},
    ]);
    await expect(teamService.updateTeam({
      teamId, actorId: adminId, data: { capabilities: ['flood_response', 'Invented qualification'] },
    }, database)).rejects.toMatchObject({ statusCode: 400 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
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

describe('profile completeness and legacy normalization', () => {
  it('loads incomplete legacy teams without inventing qualifications', () => {
    const team = presentTeam({ id: teamId, team_name: 'Legacy Team', capabilities: null, latitude: null, longitude: null });
    expect(team.profile_complete).toBe(false);
    expect(team.normalized_capabilities).toEqual([]);
    expect(team.profile_issues).toEqual(expect.arrayContaining(['primary_category', 'capabilities', 'base_location_name', 'coordinates']));
  });

  it('maps only known legacy capabilities and preserves unknown values', () => {
    const result = analyzeCapabilities(['Flood response', 'Medical first aid', 'Rope specialty']);
    expect(result.recognized).toEqual(['flood_response', 'first_aid']);
    expect(result.legacy).toEqual(['Rope specialty']);
  });

  it('requires every dispatch-profile field for completeness', () => {
    expect(profileCompleteness(completeTeam()).complete).toBe(true);
    expect(profileCompleteness(completeTeam({ longitude: null })).complete).toBe(false);
  });
});

describe('deterministic team recommendations', () => {
  it('calculates Haversine straight-line distance', () => {
    expect(recommendationService.haversineDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.2, 1);
    expect(recommendationService.haversineDistanceKm(null, 0, 0, 1)).toBeNull();
  });

  it('ranks more matching capabilities before distance and excludes unavailable teams', () => {
    const ranked = recommendationService.rankTeams([
      completeTeam({ id: 'b', team_name: 'Nearby General', primary_category: 'general_disaster_response', capabilities: ['general_rescue'], longitude: 0.1 }),
      completeTeam({ id: 'a', team_name: 'Flood Specialists', capabilities: ['flood_response', 'boat_rescue'], longitude: 1 }),
      completeTeam({ id: 'c', team_name: 'Busy Flood Team', availability: 'busy', capabilities: ['flood_response', 'boat_rescue'], longitude: 0.01 }),
      completeTeam({ id: 'd', team_name: 'Offline Flood Team', availability: 'offline', capabilities: ['flood_response', 'boat_rescue'], longitude: 0.01 }),
    ], { emergency_type: 'Flood', latitude: 0, longitude: 0 });
    expect(ranked.map((team) => team.team_name)).toEqual(['Flood Specialists', 'Nearby General']);
    expect(ranked[0].capability_matches).toEqual(['flood_response', 'boat_rescue']);
    expect(ranked[0].explanation).toMatch(/Flood response and Boat rescue/);
  });

  it('orders comparable matches by distance, then deterministically by name', () => {
    const ranked = recommendationService.rankTeams([
      completeTeam({ id: 'b', team_name: 'Bravo', longitude: 1 }),
      completeTeam({ id: 'a', team_name: 'Alpha', longitude: 1 }),
      completeTeam({ id: 'c', team_name: 'Closer', longitude: 0.5 }),
    ], { emergency_type: 'flood', latitude: 0, longitude: 0 });
    expect(ranked.map((team) => team.team_name)).toEqual(['Closer', 'Alpha', 'Bravo']);
  });

  it('excludes incomplete profiles from location-aware recommendations', () => {
    const ranked = recommendationService.rankTeams([
      completeTeam({ id: 'missing-category', primary_category: null }),
      completeTeam({ id: 'missing-location', latitude: null, longitude: null }),
      completeTeam({ id: 'complete' }),
    ], { emergency_type: 'flood', latitude: 0, longitude: 0 });
    expect(ranked.map((team) => team.team_id)).toEqual(['complete']);
  });

  it('uses advisory AI classification when it adds a verified match', () => {
    const ranked = recommendationService.rankTeams([
      completeTeam({ primary_category: 'medical_response', capabilities: ['first_aid'] }),
    ], { emergency_type: 'Other', analyzed_disaster_type: 'Medical Emergency', latitude: 0, longitude: 0 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].capability_match).toBe('first_aid');
  });

  it('returns no invented recommendation for missing or unsuitable capabilities', () => {
    const ranked = recommendationService.rankTeams([
      completeTeam({ id: 'legacy', capabilities: null }),
      completeTeam({ id: 'fire', primary_category: 'fire_urban_rescue', capabilities: ['fire_suppression'] }),
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
    expect(responderResponse.status).toBe(403);
  });

  it('returns a clear explanation when no eligible complete team matches', async () => {
    const database = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: incidentId, emergency_type: 'flood', status: 'pending', assigned_team_id: null, is_linked_duplicate: false, linked_incident_has_assignment: false, latitude: 0, longitude: 0 }] })
      .mockResolvedValueOnce({ rows: [completeTeam({ primary_category: 'fire_urban_rescue', capabilities: ['fire_suppression'] })] }) };
    const result = await recommendationService.getTeamRecommendations(incidentId, database);
    expect(result.recommendations).toEqual([]);
    expect(result.message).toMatch(/complete profile and a verified capability match/i);
  });
});
