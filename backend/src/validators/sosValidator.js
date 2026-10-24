const { z } = require('zod');

const optionalCoordinate = z.union([
  z.number(),
  z.string().trim().min(1).transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a valid number' });
      return z.NEVER;
    }
    return parsed;
  }),
]).nullish();

const sosSchema = z.object({
  emergency_type: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(5000),
  latitude: optionalCoordinate,
  longitude: optionalCoordinate,
  location_text: z.string().trim().max(500).nullish(),
}).strict().superRefine((data, ctx) => {
  const hasLatitude = data.latitude !== null && data.latitude !== undefined;
  const hasLongitude = data.longitude !== null && data.longitude !== undefined;
  const hasLocationText = Boolean(data.location_text?.trim());

  if (hasLatitude !== hasLongitude) {
    ctx.addIssue({
      code: 'custom',
      path: hasLatitude ? ['longitude'] : ['latitude'],
      message: 'Latitude and longitude must be provided together',
    });
  }
  if (hasLatitude && (data.latitude < -90 || data.latitude > 90)) {
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Latitude must be between -90 and 90' });
  }
  if (hasLongitude && (data.longitude < -180 || data.longitude > 180)) {
    ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'Longitude must be between -180 and 180' });
  }
  if (!(hasLatitude && hasLongitude) && !hasLocationText) {
    ctx.addIssue({
      code: 'custom',
      path: ['location_text'],
      message: 'Provide valid coordinates or a nonempty location description',
    });
  }
});

const sosHeadersSchema = z.object({
  'idempotency-key': z.string().uuid().optional(),
}).passthrough();

module.exports = { sosSchema, sosHeadersSchema };
