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

// Accepts common Indian and international formats ("+91 98765 43210", "(022) 2345-6789") and
// stores digits with an optional leading "+". Messages never echo the submitted number.
const PHONE_SEPARATORS = /[\s().-]/g;
const contactNumber = z.string().trim().max(32).transform((value, ctx) => {
  if (!value) return null;
  const normalized = value.replace(PHONE_SEPARATORS, '');
  if (!/^\+?[0-9]{6,15}$/.test(normalized)) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number with 6 to 15 digits and an optional leading +' });
    return z.NEVER;
  }
  return normalized;
}).nullish();

function refineLocation(data, ctx) {
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
}

const detailedSosSchema = z.object({
  submission_mode: z.literal('detailed').optional(),
  emergency_type: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(5000),
  latitude: optionalCoordinate,
  longitude: optionalCoordinate,
  location_text: z.string().trim().max(500).nullish(),
  contact_number: contactNumber,
}).strict().superRefine(refineLocation);

// Quick SOS carries no description or emergency type: those are left for operator triage.
const quickSosSchema = z.object({
  submission_mode: z.literal('quick_sos'),
  latitude: optionalCoordinate,
  longitude: optionalCoordinate,
  location_text: z.string().trim().max(500).nullish(),
  location_accuracy_meters: z.number().finite().min(0).max(100000).nullish(),
  location_captured_at: z.iso.datetime({ offset: true }).nullish(),
  contact_number: contactNumber,
}).strict().superRefine(refineLocation);

// Dispatches on submission_mode so detailed reports keep their original validation errors.
const sosSchema = {
  safeParse(body) {
    const schema = body?.submission_mode === 'quick_sos' ? quickSosSchema : detailedSosSchema;
    return schema.safeParse(body);
  },
};

const VICTIM_EMERGENCY_TYPES = ['Fire', 'Flood', 'Medical', 'Accident', 'Trapped', 'Other'];

const victimDetailsSchema = z.object({
  emergency_type: z.enum(VICTIM_EMERGENCY_TYPES).optional(),
  contact_number: contactNumber,
}).strict().refine(
  (data) => data.emergency_type !== undefined || (data.contact_number !== undefined && data.contact_number !== null),
  { message: 'Provide an emergency type or a contact number' },
);

module.exports = {
  sosSchema,
  detailedSosSchema,
  quickSosSchema,
  victimDetailsSchema,
  VICTIM_EMERGENCY_TYPES,
};
