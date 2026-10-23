const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./config/env');
const db = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const sosRoutes = require('./routes/sosRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const teamRoutes = require('./routes/teamRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const publicRoutes = require('./routes/publicRoutes');
const responderRoutes = require('./routes/responderRoutes');
const { AppError, success } = require('./utils/apiResponse');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'Origin is not allowed by CORS'));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    const database = await db.checkConnection();
    if (!database.connected) {
      return res.status(503).json({
        success: false,
        message: 'RescueGrid API is running with degraded dependencies',
        data: { application: 'up', database },
      });
    }
    return success(res, {
      message: 'RescueGrid API is healthy',
      data: { application: 'up', database },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/sos', sosRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/responder', responderRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
