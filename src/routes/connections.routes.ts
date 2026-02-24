import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store/index.js';
import { getSupportedTypes } from '../drivers/driver-registry.js';
import { testConnection } from '../services/backup.service.js';
import type { ApiResponse, ConnectionConfig } from '../types/index.js';

const router = Router();

const createConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['mysql', 'postgresql', 'mongodb']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1),
});

const updateConnectionSchema = createConnectionSchema.partial();

function maskConnection(conn: ConnectionConfig): Omit<ConnectionConfig, 'password'> & { password: string } {
  return { ...conn, password: '****' };
}

// POST /api/connections
router.post('/', (req, res) => {
  const parsed = createConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse = { success: false, error: parsed.error.message };
    res.status(400).json(response);
    return;
  }

  const { data } = parsed;
  const supportedTypes = getSupportedTypes();
  if (!supportedTypes.includes(data.type)) {
    const response: ApiResponse = { success: false, error: `Tipo nao suportado: ${data.type}. Tipos disponiveis: ${supportedTypes.join(', ')}` };
    res.status(400).json(response);
    return;
  }

  const now = new Date().toISOString();
  const connection: ConnectionConfig = {
    id: uuidv4(),
    name: data.name,
    type: data.type,
    host: data.host,
    port: data.port ?? 3306,
    username: data.username,
    password: data.password,
    database: data.database,
    createdAt: now,
    updatedAt: now,
  };

  store.addConnection(connection);

  const response: ApiResponse = { success: true, data: maskConnection(connection), message: 'Conexao criada' };
  res.status(201).json(response);
});

// GET /api/connections
router.get('/', (_req, res) => {
  const connections = store.getConnections().map(maskConnection);
  const response: ApiResponse = { success: true, data: connections };
  res.json(response);
});

// GET /api/connections/:id
router.get('/:id', (req, res) => {
  const connection = store.getConnection(req.params['id']!);
  if (!connection) {
    const response: ApiResponse = { success: false, error: 'Conexao nao encontrada' };
    res.status(404).json(response);
    return;
  }
  const response: ApiResponse = { success: true, data: maskConnection(connection) };
  res.json(response);
});

// POST /api/connections/:id/test
router.post('/:id/test', async (req, res) => {
  try {
    const reachable = await testConnection(req.params['id']!);
    const response: ApiResponse = { success: true, data: { reachable }, message: reachable ? 'Conexao OK' : 'Conexao falhou' };
    res.json(response);
  } catch (err: any) {
    const response: ApiResponse = { success: false, error: err.message };
    res.status(404).json(response);
  }
});

// PUT /api/connections/:id
router.put('/:id', (req, res) => {
  const parsed = updateConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse = { success: false, error: parsed.error.message };
    res.status(400).json(response);
    return;
  }

  const updated = store.updateConnection(req.params['id']!, parsed.data as Partial<ConnectionConfig>);
  if (!updated) {
    const response: ApiResponse = { success: false, error: 'Conexao nao encontrada' };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse = { success: true, data: maskConnection(updated), message: 'Conexao atualizada' };
  res.json(response);
});

// DELETE /api/connections/:id
router.delete('/:id', (req, res) => {
  const deleted = store.deleteConnection(req.params['id']!);
  if (!deleted) {
    const response: ApiResponse = { success: false, error: 'Conexao nao encontrada' };
    res.status(404).json(response);
    return;
  }
  const response: ApiResponse = { success: true, message: 'Conexao removida' };
  res.json(response);
});

export default router;
