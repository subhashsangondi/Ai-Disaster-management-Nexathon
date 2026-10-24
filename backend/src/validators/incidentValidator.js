const { z } = require('zod');

const uuidParamsSchema = z.object({ id: z.uuid() });

const incidentFiltersSchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_progress', 'resolved']).optional(),
  urgency: z.enum(['critical', 'high', 'medium', 'low', 'unknown']).optional(),
  emergency_type: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const assignmentSchema = z.object({ team_id: z.uuid() }).strict();
const statusSchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_progress', 'resolved']),
}).strict();

const triageSchema = z.object({
  emergency_type: z.string().trim().min(2).max(100),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
}).strict();

module.exports = {
  uuidParamsSchema,
  incidentFiltersSchema,
  assignmentSchema,
  statusSchema,
  triageSchema,
};
