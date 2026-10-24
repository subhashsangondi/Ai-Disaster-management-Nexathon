const { z } = require('zod');

const duplicateParamsSchema = z.object({
  id: z.uuid(),
  duplicateId: z.uuid(),
}).refine((value) => value.id !== value.duplicateId, {
  message: 'An incident cannot be reviewed as its own duplicate',
  path: ['duplicateId'],
});

const duplicateReviewSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  primary_incident_id: z.uuid().optional(),
  reason: z.string().trim().min(5).max(2000).optional(),
  assignment_conflict_acknowledged: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.decision === 'confirmed' && !value.primary_incident_id) {
    context.addIssue({ code: 'custom', path: ['primary_incident_id'], message: 'Primary incident is required when confirming a duplicate' });
  }
  if (value.decision === 'rejected' && value.primary_incident_id) {
    context.addIssue({ code: 'custom', path: ['primary_incident_id'], message: 'Primary incident must not be provided when rejecting a duplicate' });
  }
});

module.exports = { duplicateParamsSchema, duplicateReviewSchema };
