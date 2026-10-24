const db = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const EARTH_RADIUS_KM = 6371.0088;
const GENERAL_CAPABILITIES = new Set(['all hazards', 'all hazard', 'general rescue', 'multi hazard']);
const STOP_WORDS = new Set(['response', 'rescue', 'team', 'unit', 'service', 'services', 'emergency']);
const TYPE_ALIASES = {
  flood: ['water', 'swift water', 'flood'],
  fire: ['fire', 'firefighting', 'fire suppression'],
  medical: ['medical', 'first aid', 'trauma', 'paramedic'],
  earthquake: ['earthquake', 'structural collapse', 'urban search'],
  landslide: ['landslide', 'search and rescue', 'debris'],
  cyclone: ['cyclone', 'storm', 'wind'],
  storm: ['storm', 'cyclone', 'wind'],
};

function toRadians(value) {
  return value * (Math.PI / 180);
}

function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const rawValues = [latitudeA, longitudeA, latitudeB, longitudeB];
  if (rawValues.some((value) => value === null || value === undefined || value === '')) return null;
  const values = rawValues.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [latA, lonA, latB, lonB] = values;
  const deltaLatitude = toRadians(latB - latA);
  const deltaLongitude = toRadians(lonB - lonA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB))
    * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function meaningfulTokens(value) {
  return new Set(normalize(value).split(' ').filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function aliasesFor(type) {
  const normalized = normalize(type);
  const aliases = new Set([normalized]);
  for (const [key, values] of Object.entries(TYPE_ALIASES)) {
    if (normalized.includes(key) || values.some((value) => normalized.includes(value))) {
      aliases.add(key);
      values.forEach((value) => aliases.add(value));
    }
  }
  return aliases;
}

function scoreCapabilities(capabilities, reportedType, analyzedType) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return { score: 0, matched: null, source: null };
  const sources = [
    { type: reportedType, source: 'reported incident type', priority: 3 },
    ...(analyzedType ? [{ type: analyzedType, source: 'operator-reviewed AI classification', priority: 2 }] : []),
  ];
  let best = { score: 0, matched: null, source: null };
  for (const capability of capabilities) {
    const normalizedCapability = normalize(capability);
    if (GENERAL_CAPABILITIES.has(normalizedCapability) && best.score < 1) {
      best = { score: 1, matched: capability, source: 'general multi-hazard capability' };
    }
    for (const item of sources) {
      const aliases = aliasesFor(item.type);
      const direct = [...aliases].some((alias) => alias && (normalizedCapability.includes(alias) || alias.includes(normalizedCapability)));
      const capabilityTokens = meaningfulTokens(capability);
      const tokenMatch = [...aliases].some((alias) => [...meaningfulTokens(alias)].some((token) => capabilityTokens.has(token)));
      const score = direct ? item.priority + 2 : tokenMatch ? item.priority + 1 : 0;
      if (score > best.score) best = { score, matched: capability, source: item.source };
    }
  }
  return best;
}

function rankTeams(teams, incident) {
  return teams.filter((team) => team.availability === 'available').map((team) => {
    const capability = scoreCapabilities(team.capabilities, incident.emergency_type, incident.analyzed_disaster_type);
    const distance = haversineDistanceKm(incident.latitude, incident.longitude, team.latitude, team.longitude);
    return {
      team_id: team.id,
      team_name: team.team_name,
      capabilities: team.capabilities,
      availability: team.availability,
      base_location_name: team.base_location_name,
      distance_km: distance === null ? null : Number(distance.toFixed(2)),
      capability_match: capability.matched,
      capability_score: capability.score,
      explanation: capability.score > 0
        ? `${capability.matched} matches the ${capability.source}; ${distance === null ? 'distance is unknown because coordinates are unavailable' : `straight-line distance is ${distance.toFixed(2)} km`}.`
        : 'No verified capability match was found for this incident type.',
    };
  }).filter((team) => team.capability_score > 0)
    .sort((left, right) => right.capability_score - left.capability_score
      || (left.distance_km === null) - (right.distance_km === null)
      || (left.distance_km ?? Infinity) - (right.distance_km ?? Infinity)
      || left.team_name.localeCompare(right.team_name)
      || left.team_id.localeCompare(right.team_id))
    .map((team, index) => ({ rank: index + 1, ...team }));
}

async function getTeamRecommendations(incidentId, database = db) {
  const incidentResult = await database.query(
    `SELECT incident.id, incident.emergency_type, incident.latitude, incident.longitude,
            incident.status, incident.assigned_team_id,
            analysis.disaster_type AS analyzed_disaster_type,
            EXISTS (SELECT 1 FROM incident_duplicate_links link
                    WHERE link.duplicate_incident_id = incident.id) AS is_linked_duplicate,
            EXISTS (SELECT 1 FROM incident_duplicate_links link
                    JOIN incidents linked ON linked.id = link.duplicate_incident_id
                    WHERE link.primary_incident_id = incident.id
                      AND linked.assigned_team_id IS NOT NULL) AS linked_incident_has_assignment
     FROM incidents incident
     LEFT JOIN LATERAL (
       SELECT disaster_type FROM ai_analyses
       WHERE incident_id = incident.id ORDER BY analyzed_at DESC LIMIT 1
     ) analysis ON true
     WHERE incident.id = $1`,
    [incidentId],
  );
  const incident = incidentResult.rows[0];
  if (!incident) throw new AppError(404, 'Incident not found');

  let restriction = null;
  if (incident.is_linked_duplicate) restriction = 'Linked duplicate incidents are handled through their primary incident.';
  else if (incident.linked_incident_has_assignment) restriction = 'A linked incident already has an assignment and requires explicit operator conflict handling.';
  else if (incident.assigned_team_id || incident.status !== 'pending') restriction = 'This incident already has an assignment or is not pending.';
  if (restriction) {
    return { incident_id: incident.id, assignment_allowed: false, message: restriction, recommendations: [] };
  }

  const teamResult = await database.query(
    `SELECT id, team_name, availability, capabilities, latitude, longitude, base_location_name
     FROM rescue_teams WHERE availability = 'available' ORDER BY team_name, id`,
  );
  const recommendations = rankTeams(teamResult.rows, incident);
  return {
    incident_id: incident.id,
    assignment_allowed: true,
    incident_type: incident.emergency_type,
    advisory_disaster_type: incident.analyzed_disaster_type || null,
    distance_method: 'straight_line_haversine_km',
    message: recommendations.length > 0
      ? 'Recommendations are advisory. An operator must review and dispatch a team.'
      : 'No available team has a verified capability match. Review team data or use the manual assignment list.',
    recommendations,
  };
}

module.exports = {
  haversineDistanceKm,
  scoreCapabilities,
  rankTeams,
  getTeamRecommendations,
};
