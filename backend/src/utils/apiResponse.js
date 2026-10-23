class AppError extends Error {
  constructor(statusCode, message, errors = undefined, code = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
  }
}

function success(res, { statusCode = 200, message = 'Operation successful', data = {} } = {}) {
  return res.status(statusCode).json({ success: true, message, data });
}

function failure(res, { statusCode = 500, message = 'Internal server error', errors } = {}) {
  const body = { success: false, message };
  if (errors !== undefined) body.errors = errors;
  return res.status(statusCode).json(body);
}

module.exports = { AppError, success, failure };
