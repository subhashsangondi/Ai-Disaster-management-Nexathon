const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('../utils/apiResponse');

function extractToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(new AppError(401, 'Authentication required'));

  try {
    req.user = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch (_error) {
    return next(new AppError(401, 'Invalid or expired token'));
  }
}

function optionalAuthenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch (_error) {
    return next(new AppError(401, 'Invalid or expired token'));
  }
}

function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(new AppError(403, 'Forbidden'));
    return next();
  };
}

module.exports = { authenticate, optionalAuthenticate, authorize };
