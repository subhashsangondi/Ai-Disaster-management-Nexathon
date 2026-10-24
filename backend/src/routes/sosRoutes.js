const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const controller = require('../controllers/sosController');
const validateRequest = require('../middleware/validateRequest');
const { optionalAuthenticate } = require('../middleware/authMiddleware');
const { sosHeadersSchema, sosSchema } = require('../validators/sosValidator');

const router = express.Router();
const sosLimiter = rateLimit({
  windowMs: env.SOS_RATE_LIMIT_WINDOW_MS,
  limit: env.SOS_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many SOS submissions; please retry shortly' }),
});

router.post(
  '/',
  sosLimiter,
  optionalAuthenticate,
  validateRequest(sosHeadersSchema, 'headers'),
  validateRequest(sosSchema),
  controller.createSos,
);

module.exports = router;
