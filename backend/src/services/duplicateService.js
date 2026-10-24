const env = require('../config/env');
const incidentRepository = require('../repositories/incidentRepository');

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function textSimilarity(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function scoreCandidate(incident, candidate, radiusKm) {
  let score = 0;
  const type = String(incident.emergency_type || '').toLowerCase();
  // Two unassessed Quick SOS reports share the placeholder type, which is not evidence of a match.
  const sameType = type !== 'unknown' && type === String(candidate.emergency_type || '').toLowerCase();
  if (sameType) score += 0.35;

  const text = textSimilarity(
    `${incident.description || ''} ${incident.location_text || ''}`,
    `${candidate.description || ''} ${candidate.location_text || ''}`,
  );
  score += text * 0.35;

  let distanceKm = null;
  if (
    incident.latitude != null && incident.longitude != null
    && candidate.latitude != null && candidate.longitude != null
  ) {
    distanceKm = haversineKm(
      Number(incident.latitude), Number(incident.longitude),
      Number(candidate.latitude), Number(candidate.longitude),
    );
    if (distanceKm <= radiusKm) score += 0.2 * (1 - distanceKm / radiusKm);
    else return null;
  }

  const hoursApart = Math.abs(new Date(incident.created_at) - new Date(candidate.created_at)) / 3_600_000;
  score += Math.max(0, 0.1 * (1 - hoursApart / env.DUPLICATE_LOOKBACK_HOURS));

  return {
    incident_id: candidate.id,
    similarity_score: Number(Math.min(score, 1).toFixed(4)),
    distance_km: distanceKm === null ? null : Number(distanceKm.toFixed(3)),
  };
}

async function findPossibleDuplicates(incident, options = {}) {
  const repository = options.repository || incidentRepository;
  const lookbackHours = options.lookbackHours || env.DUPLICATE_LOOKBACK_HOURS;
  const radiusKm = options.radiusKm || env.DUPLICATE_RADIUS_KM;
  const threshold = options.threshold ?? 0.45;
  const candidates = await repository.findDuplicateCandidates(incident, lookbackHours);

  return candidates
    .map((candidate) => scoreCandidate(incident, candidate, radiusKm))
    .filter((candidate) => candidate && candidate.similarity_score >= threshold)
    .sort((a, b) => b.similarity_score - a.similarity_score);
}

module.exports = { findPossibleDuplicates, haversineKm, textSimilarity };
