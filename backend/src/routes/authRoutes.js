const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const controller = require('../controllers/authController');
const validateRequest = require('../middleware/validateRequest');
const { authenticate } = require('../middleware/authMiddleware');
const { registerSchema, loginSchema } = require('../validators/authValidator');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many authentication attempts' }),
});

router.post('/register', authLimiter, validateRequest(registerSchema), controller.register);
router.post('/login', authLimiter, validateRequest(loginSchema), controller.login);
router.get('/me', authenticate, controller.me);

module.exports = router;
