const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

module.exports = { registerSchema, loginSchema };
