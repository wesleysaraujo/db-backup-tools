import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import connectionsRoutes from './routes/connections.routes.js';
import backupsRoutes from './routes/backups.routes.js';
import schedulesRoutes from './routes/schedules.routes.js';
import { loadAllSchedules } from './services/scheduler.service.js';
import { getStorageProvider } from './services/storage.service.js';

export function createApp(): express.Express
{
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Middleware de logging — registra todas as requisições
  app.use((req, res, next) =>
  {
    const start = Date.now();
    const { method, originalUrl } = req;

    res.on('finish', () =>
    {
      const duration = Date.now() - start;
      const { statusCode } = res;
      process.stdout.write(`[${new Date().toISOString()}] ${method} ${originalUrl} → ${statusCode} (${duration}ms)\n`);
    });

    next();
  });

  app.get('/api/health', (_req, res) =>
  {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(authMiddleware);

  app.use('/api/connections', connectionsRoutes);
  app.use('/api/backups', backupsRoutes);
  app.use('/api/schedules', schedulesRoutes);

  return app;
}

export function startServer(port?: number): void
{
  const app = createApp();
  const p = port ?? config.port;

  getStorageProvider(); // Carrega logs das credenciais S3 ao iniciar
  loadAllSchedules();

  app.listen(p, () =>
  {
    console.log(`DB Backup Tool API rodando em http://localhost:${p}`);
  });
}

// Executa direto se chamado como entrypoint
const isDirectRun = process.argv[1]?.includes('server');
if (isDirectRun)
{
  startServer();
}
