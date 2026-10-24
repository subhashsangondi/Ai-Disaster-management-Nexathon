const db = require('../config/database');
const {
  analyzeCapabilities,
  capabilityLabel,
  profileCompleteness,
} = require('../domain/teamProfile');
const { AppError } = require('../utils/apiResponse');

const EARTH_RADIUS_KM = 6371.0088;
const GENERAL_CAPABILITIES = new Set(['general_rescue', 'emergency_assessment']);

// Covers the public SOS values and conservative AI classifications already in use.
// Rules never grant qualifications; they only match capabilities stored on a team.
const INCIDENT_CAPABILITY_RULES = Object.freeze([
  {
    terms: ['flood', 'water emergency', 'drowning'],
    category: 'flood_water_rescue',
    capabilities: ['flood_response', 'swift_water_rescue', 'boat_rescue', 'water_evacuation'],
  },
  {
    terms: ['fire', 'urban fire', 'building fire'],
    category: 'fire_urban_rescue',
    capabilities: ['fire_suppression', 'urban_search_and_rescue', 'structural_collapse_rescue'],
  },
  {
    terms: ['medical emergency', 'medical', 'mass casualty', 'ambulance', 'trauma', 'injury'],
    category: 'medical_response',
    capabilities: ['first_aid', 'trauma_care', 'patient_stabilization', 'ambulance_support'],
  },
  {
    terms: ['earthquake', 'structural collapse', 'collapsed building'],
    category: 'fire_urban_rescue',
    capabilities: ['structural_collapse_rescue', 'urban_search_and_rescue', 'debris_search', 'first_aid'],
  },
  {
    terms: ['trapped person', 'trapped'],
    category: 'fire_urban_rescue',
    capabilities: ['confined_space_rescue', 'structural_collapse_rescue', 'urban_search_and_rescue', 'first_aid'],
  },
  {
    terms: ['road accident', 'vehicle accident', 'traffic accident'],
    category: 'medical_response',
    capabilities: ['first_aid', 'trauma_care', 'patient_stabilization', 'ambulance_support', 'general_rescue'],
  },
  {
    terms: ['landslide', 'debris'],
    category: 'search_evacuation',
    capabilities: ['debris_search', 'ground_search_and_rescue', 'evacuation'],
  },
  {
    terms: ['missing person', 'search and rescue', 'search & rescue'],
    category: 'search_evacuation',
    capabilities: ['missing_person_search', 'ground_search_and_rescue', 'evacuation', 'debris_search'],
  },
  {
    terms: ['cyclone', 'storm', 'hurricane'],
    category: 'general_disaster_response',
    capabilities: ['evacuation', 'emergency_assessment', 'shelter_assistance', 'general_rescue'],
  },
  {
    terms: ['rescue required', 'other'],
    category: 'general_disaster_response',
    capabilities: ['general_rescue', 'emergency_assessment', 'evacuation', 'logistics_support'],
  },
]);

function normalizeType(value) {
  return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 &]/g, '').replace(/\s+/g, ' ').trim();
}

function capabilityRuleFor(type) {
  const normalized = normalizeType(type);
  if (!normalized) return null;
  return INCIDENT_CAPABILITY_RULES.find((rule) => rule.terms.some((term) => (
    normalized === term || normalized.includes(term)
  ))) || null;
}

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

function scoreCapabilities(capabilities, reportedType, analyzedType, primaryCategory = null) {
  const recognized = analyzeCapabilities(capabilities).recognized;
  if (recognized.length === 0) return {
    score: 0, matched: null, matched_capabilities: [], source: null,
  };

  const reportedRule = capabilityRuleFor(reportedType);
  const analyzedRule = capabilityRuleFor(analyzedType);
  const reportedMatches = reportedRule
    ? reportedRule.capabilities.filter((id) => recognized.includes(id)) : [];
  const analyzedMatches = analyzedRule
    ? analyzedRule.capabilities.filter((id) => recognized.includes(id) && !reportedMatches.includes(id)) : [];
  let matchedCapabilities = [...reportedMatches, ...analyzedMatches];
  let score = (reportedMatches.length * 100) + (analyzedMatches.length * 50);
  if (score > 0 && reportedRule?.category === primaryCategory) score += 20;
  else if (score > 0 && analyzedRule?.category === primaryCategory) score += 10;

  let source = reportedMatches.length > 0 ? 'reported incident type'
    : analyzedMatches.length > 0 ? 'operator-reviewed AI classification' : null;
  if (score === 0) {
    const generalMatch = recognized.find((id) => GENERAL_CAPABILITIES.has(id));
    if (generalMatch) {
      score = 10;
      matchedCapabilities = [generalMatch];
      source = 'general disaster capability';
    }
  }

  return {
    score,
    matched: matchedCapabilities[0] || null,
    matched_capabilities: matchedCapabilities,
    source,
  };
}

function rankTeams(teams, incident) {
  return teams.filter((team) => team.availability === 'available').map((team) => {
    const profile = profileCompleteness(team);
    if (!profile.complete) return null;
    const capability = scoreCapabilities(
      team.capabilities,
      incident.emergency_type,
      incident.analyzed_disaster_type,
      team.primary_category,
    );
    if (capability.score === 0) return null;
    const distance = haversineDistanceKm(incident.latitude, incident.longitude, team.latitude, team.longitude);
    const labels = capability.matched_capabilities.map(capabilityLabel);
    return {
      team_id: team.id,
      team_name: team.team_name,
      primary_category: team.primary_category,
      capabilities: profile.recognized,
      availability: team.availability,
      base_location_name: team.base_location_name,
      profile_complete: true,
      distance_km: distance === null ? null : Number(distance.toFixed(2)),
      capability_match: capability.matched,
      capability_matches: capability.matched_capabilities,
      capability_score: capability.score,
      explanation: `Recommended because this team supports ${labels.join(' and ')} and is available; ${
        distance === null
          ? 'distance is unknown because the incident coordinates are unavailable'
          : `straight-line distance is ${distance.toFixed(2)} km`
      }.`,
    };
  }).filter(Boolean)
    .sort((left, right) => right.capability_score - left.capability_score
      || right.capability_matches.length - left.capability_matches.length
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
    `SELECT id, team_name, availability, primary_category, capabilities,
            latitude, longitude, base_location_name
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
      : 'No available team has both a complete profile and a verified capability match. Review team profiles or use the manual assignment list.',
    recommendations,
  };
}

module.exports = {
  INCIDENT_CAPABILITY_RULES,
  capabilityRuleFor,
  haversineDistanceKm,
  scoreCapabilities,
  rankTeams,
  getTeamRecommendations,
};
