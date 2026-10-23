const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const controller = require('../controllers/publicTrackingController');

const router = express.Router();
const trackingLimiter = rateLimit({
  windowMs: env.PUBLIC_TRACK_RATE_LIMIT_WINDOW_MS,
  limit: env.PUBLIC_TRACK_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many tracking requests; please retry shortly' }),
});

router.get('/incidents/track', trackingLimiter, controller.trackIncident);

module.exports = router;
