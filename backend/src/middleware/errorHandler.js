const { AppError, failure } = require('../utils/apiResponse');

function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'Route not found'));
}

function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return failure(res, {
      statusCode: error.statusCode,
      message: error.message,
      errors: error.errors,
    });
  }

  if (error?.type === 'entity.parse.failed') {
    return failure(res, { statusCode: 400, message: 'Invalid JSON body' });
  }

  console.error('Unhandled request error:', error?.message || error);
  return failure(res, { statusCode: 500, message: 'Internal server error' });
}

module.exports = { notFoundHandler, errorHandler };
