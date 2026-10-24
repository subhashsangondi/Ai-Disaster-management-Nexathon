const TEAM_CATEGORIES = Object.freeze([
  { id: 'flood_water_rescue', label: 'Flood & Water Rescue' },
  { id: 'fire_urban_rescue', label: 'Fire & Urban Rescue' },
  { id: 'medical_response', label: 'Medical Response' },
  { id: 'search_evacuation', label: 'Search & Evacuation' },
  { id: 'general_disaster_response', label: 'General Disaster Response' },
]);

const CAPABILITY_GROUPS = Object.freeze([
  {
    category: 'flood_water_rescue',
    capabilities: [
      { id: 'flood_response', label: 'Flood response' },
      { id: 'swift_water_rescue', label: 'Swift-water rescue' },
      { id: 'boat_rescue', label: 'Boat rescue' },
      { id: 'water_evacuation', label: 'Water evacuation' },
    ],
  },
  {
    category: 'fire_urban_rescue',
    capabilities: [
      { id: 'fire_suppression', label: 'Fire suppression' },
      { id: 'structural_collapse_rescue', label: 'Structural collapse rescue' },
      { id: 'confined_space_rescue', label: 'Confined-space rescue' },
      { id: 'urban_search_and_rescue', label: 'Urban search and rescue' },
    ],
  },
  {
    category: 'medical_response',
    capabilities: [
      { id: 'first_aid', label: 'First aid' },
      { id: 'trauma_care', label: 'Trauma care' },
      { id: 'patient_stabilization', label: 'Patient stabilization' },
      { id: 'ambulance_support', label: 'Ambulance support' },
    ],
  },
  {
    category: 'search_evacuation',
    capabilities: [
      { id: 'missing_person_search', label: 'Missing-person search' },
      { id: 'ground_search_and_rescue', label: 'Ground search and rescue' },
      { id: 'evacuation', label: 'Evacuation' },
      { id: 'debris_search', label: 'Debris search' },
    ],
  },
  {
    category: 'general_disaster_response',
    capabilities: [
      { id: 'emergency_assessment', label: 'Emergency assessment' },
      { id: 'logistics_support', label: 'Logistics support' },
      { id: 'shelter_assistance', label: 'Shelter assistance' },
      { id: 'general_rescue', label: 'General rescue' },
    ],
  },
]);

const CATEGORY_IDS = Object.freeze(TEAM_CATEGORIES.map((category) => category.id));
const CAPABILITIES = Object.freeze(CAPABILITY_GROUPS.flatMap((group) => group.capabilities));
const CAPABILITY_IDS = Object.freeze(CAPABILITIES.map((capability) => capability.id));
const categoryIdSet = new Set(CATEGORY_IDS);
const categoryLabels = new Map(TEAM_CATEGORIES.map((category) => [category.id, category.label]));
const capabilityLabels = new Map(CAPABILITIES.map((capability) => [capability.id, capability.label]));

function lookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const capabilityAliases = new Map();
for (const capability of CAPABILITIES) {
  capabilityAliases.set(lookupKey(capability.id), capability.id);
  capabilityAliases.set(lookupKey(capability.label), capability.id);
}
Object.entries({
  'all hazard': 'general_rescue',
  'all hazards': 'general_rescue',
  'multi hazard': 'general_rescue',
  'medical first aid': 'first_aid',
  'swift water': 'swift_water_rescue',
  'water rescue': 'swift_water_rescue',
  firefighting: 'fire_suppression',
  'urban search': 'urban_search_and_rescue',
  'search and rescue': 'ground_search_and_rescue',
}).forEach(([alias, id]) => capabilityAliases.set(lookupKey(alias), id));

function normalizeCapability(value) {
  return capabilityAliases.get(lookupKey(value)) || null;
}

function categoryLabel(value) {
  return categoryLabels.get(value) || null;
}

function capabilityLabel(value) {
  const normalized = normalizeCapability(value);
  return normalized ? capabilityLabels.get(normalized) : String(value || '').trim();
}

function analyzeCapabilities(values) {
  const recognized = [];
  const legacy = [];
  const recognizedSet = new Set();
  const legacySet = new Set();
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = String(rawValue || '').trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const normalized = normalizeCapability(value);
    if (normalized) {
      if (!recognizedSet.has(normalized)) {
        recognizedSet.add(normalized);
        recognized.push(normalized);
      }
    } else if (!legacySet.has(value)) {
      legacySet.add(value);
      legacy.push(value);
    }
  }
  return { recognized, legacy };
}

function hasValidCoordinates(team) {
  if (team.latitude === null || team.latitude === undefined || team.latitude === ''
    || team.longitude === null || team.longitude === undefined || team.longitude === '') return false;
  const latitude = Number(team.latitude);
  const longitude = Number(team.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function profileCompleteness(team) {
  const issues = [];
  const capabilities = analyzeCapabilities(team.capabilities);
  if (String(team.team_name || '').trim().length < 2) issues.push('team_name');
  if (!categoryIdSet.has(team.primary_category)) issues.push('primary_category');
  if (capabilities.recognized.length === 0) issues.push('capabilities');
  if (String(team.base_location_name || '').trim().length < 2) issues.push('base_location_name');
  if (!hasValidCoordinates(team)) issues.push('coordinates');
  return { complete: issues.length === 0, issues, ...capabilities };
}

function presentTeam(team) {
  const profile = profileCompleteness(team);
  return {
    ...team,
    normalized_capabilities: profile.recognized,
    legacy_capabilities: profile.legacy,
    profile_complete: profile.complete,
    profile_issues: profile.issues,
  };
}

module.exports = {
  TEAM_CATEGORIES,
  CAPABILITY_GROUPS,
  CATEGORY_IDS,
  CAPABILITY_IDS,
  normalizeCapability,
  categoryLabel,
  capabilityLabel,
  analyzeCapabilities,
  hasValidCoordinates,
  profileCompleteness,
  presentTeam,
};
