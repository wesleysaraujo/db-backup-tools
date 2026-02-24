import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import connectionsRoutes from './routes/connections.routes.js';
import backupsRoutes from './routes/backups.routes.js';
import schedulesRoutes from './routes/schedules.routes.js';
import { loadAllSchedules } from './services/scheduler.service.js';

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(authMiddleware);

  app.use('/api/connections', connectionsRoutes);
  app.use('/api/backups', backupsRoutes);
  app.use('/api/schedules', schedulesRoutes);

  return app;
}

export function startServer(port?: number): void {
  const app = createApp();
  const p = port ?? config.port;

  loadAllSchedules();

  app.listen(p, () => {
    console.log(`DB Backup Tool API rodando em http://localhost:${p}`);
  });
}

// Executa direto se chamado como entrypoint
const isDirectRun = process.argv[1]?.includes('server');
if (isDirectRun) {
  startServer();
}
