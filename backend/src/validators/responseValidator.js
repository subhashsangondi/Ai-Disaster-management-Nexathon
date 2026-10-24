const { z } = require('zod');

const uuidParamsSchema = z.object({ id: z.uuid() });
const progressSchema = z.object({
  progress_status: z.enum(['en_route', 'arrived', 'rescue_in_progress']),
  notes: z.string().trim().max(2000).optional(),
}).strict();
const completionSchema = z.object({
  completion_summary: z.string().trim().min(10).max(5000),
  people_assisted: z.coerce.number().int().min(0).max(100000).nullable().optional(),
}).strict();
const rejectionSchema = z.object({ reason: z.string().trim().min(5).max(2000) }).strict();
const emptyBodySchema = z.object({}).strict();

module.exports = { uuidParamsSchema, progressSchema, completionSchema, rejectionSchema, emptyBodySchema };
