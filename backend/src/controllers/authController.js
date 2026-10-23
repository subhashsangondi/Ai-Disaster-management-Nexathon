const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { AppError, success } = require('../utils/apiResponse');

function signToken(user) {
  return jwt.sign(
    { user_id: user.id, role: user.role },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN },
  );
}

async function register(req, res) {
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  try {
    const user = await userRepository.createUser({
      name: req.body.name,
      email: req.body.email,
      passwordHash,
      role: 'public',
    });
    return success(res, {
      statusCode: 201,
      message: 'Registration successful',
      data: { user, token: signToken(user) },
    });
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'An account with this email already exists');
    throw error;
  }
}

async function login(req, res) {
  const user = await userRepository.findByEmail(req.body.email);
  const valid = user && await bcrypt.compare(req.body.password, user.password_hash);
  if (!valid) throw new AppError(401, 'Invalid email or password');

  return success(res, {
    message: 'Login successful',
    data: {
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
  });
}

async function me(req, res) {
  const user = await userRepository.findById(req.user.user_id);
  if (!user) throw new AppError(404, 'User not found');
  return success(res, { data: user });
}

module.exports = { register, login, me, signToken };
