const { z } = require('zod');

const teamIdParamsSchema = z.object({ id: z.uuid() });
const availabilityQuerySchema = z.object({
  availability: z.enum(['available', 'busy', 'offline']).optional(),
});

const teamName = z.string().trim().min(2).max(150);
const capabilities = z.array(z.string().trim().min(2).max(100)).min(1).max(20)
  .transform((items) => [...new Set(items.map((item) => item.replace(/\s+/g, ' ')))]);
const baseLocationName = z.string().trim().min(2).max(255);
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);
const contactInfo = z.string().trim().max(255).nullable().optional();

const createTeamSchema = z.object({
  team_name: teamName,
  capabilities,
  base_location_name: baseLocationName,
  latitude,
  longitude,
  availability: z.enum(['available', 'offline']),
  contact_info: contactInfo,
}).strict();

const updateTeamSchema = z.object({
  team_name: teamName.optional(),
  capabilities: capabilities.optional(),
  base_location_name: baseLocationName.nullable().optional(),
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
  availability: z.enum(['available', 'offline']).optional(),
  contact_info: contactInfo,
}).strict().superRefine((data, context) => {
  if (Object.keys(data).length === 0) {
    context.addIssue({ code: 'custom', message: 'At least one field is required' });
  }
  const hasLatitude = Object.hasOwn(data, 'latitude');
  const hasLongitude = Object.hasOwn(data, 'longitude');
  if (hasLatitude !== hasLongitude || (hasLatitude && ((data.latitude === null) !== (data.longitude === null)))) {
    context.addIssue({
      code: 'custom',
      path: ['latitude'],
      message: 'Latitude and longitude must be supplied together',
    });
  }
});

module.exports = {
  teamIdParamsSchema,
  availabilityQuerySchema,
  createTeamSchema,
  updateTeamSchema,
};
