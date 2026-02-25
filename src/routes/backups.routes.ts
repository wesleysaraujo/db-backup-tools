import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store/index.js';
import { runBackup, runRestore } from '../services/backup.service.js';
import { getStorageProvider } from '../services/storage.service.js';
import type { ApiResponse } from '../types/index.js';

const router = Router();

const runBackupBodySchema = z.object({
  rowLimit: z.number().int().min(1).max(1_000_000).optional(),
}).strict().optional();

// POST /api/backups/:connectionId
router.post('/:connectionId', async (req, res) =>
{
  try
  {
    const body = runBackupBodySchema.parse(req.body);
    const options = body?.rowLimit ? { rowLimit: body.rowLimit } : undefined;
    const record = await runBackup(req.params['connectionId']!, options);
    const response: ApiResponse = { success: true, data: record, message: 'Backup executado' };
    res.status(201).json(response);
  } catch (err: any)
  {
    if (err instanceof z.ZodError)
    {
      const response: ApiResponse = { success: false, error: err.errors.map(e => e.message).join(', ') };
      res.status(400).json(response);
      return;
    }
    const response: ApiResponse = { success: false, error: err.message };
    res.status(400).json(response);
  }
});

// GET /api/backups
router.get('/', (req, res) =>
{
  const connectionId = req.query['connectionId'] as string | undefined;
  const backups = store.getBackups(connectionId);
  const response: ApiResponse = { success: true, data: backups };
  res.json(response);
});

// GET /api/backups/:id/download
router.get('/:id/download', async (req, res) =>
{
  const backup = store.getBackup(req.params['id']!);
  if (!backup)
  {
    const response: ApiResponse = { success: false, error: 'Backup não encontrado' };
    res.status(404).json(response);
    return;
  }

  try
  {
    const storageProvider = getStorageProvider();
    const stream = await storageProvider.getDownloadStream(backup.filepath);

    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);
  } catch (error: any)
  {
    if (!res.headersSent)
    {
      const response: ApiResponse = { success: false, error: error.message || 'Arquivo de backup não encontrado' };
      res.status(404).json(response);
    }
  }
});

// DELETE /api/backups/:id
router.delete('/:id', async (req, res) =>
{
  const backup = store.getBackup(req.params['id']!);
  if (!backup)
  {
    const response: ApiResponse = { success: false, error: 'Backup não encontrado' };
    res.status(404).json(response);
    return;
  }

  try
  {
    const storageProvider = getStorageProvider();
    await storageProvider.delete(backup.filepath);
  } catch (error: any)
  {
    const response: ApiResponse = { success: false, error: error.message || 'Falha ao remover arquivo do storage' };
    res.status(400).json(response);
    return;
  }

  const deleted = store.deleteBackup(backup.id);
  if (!deleted)
  {
    const response: ApiResponse = { success: false, error: 'Falha ao remover backup do banco de dados' };
    res.status(400).json(response);
    return;
  }

  const response: ApiResponse = { success: true, message: 'Backup removido' };
  res.json(response);
});

// POST /api/backups/:id/restore
const restoreBodySchema = z.object({
  connectionId: z.string().uuid(),
  confirm: z.literal(true, { errorMap: () => ({ message: 'confirm deve ser true para executar restore' }) }),
}).strict();

router.post('/:id/restore', async (req, res) =>
{
  try
  {
    const body = restoreBodySchema.parse(req.body);
    const result = await runRestore(req.params['id']!, body.connectionId);
    const response: ApiResponse = { success: true, data: result, message: 'Restore executado' };
    res.json(response);
  } catch (err: any)
  {
    if (err instanceof z.ZodError)
    {
      const response: ApiResponse = { success: false, error: err.errors.map(e => e.message).join(', ') };
      res.status(400).json(response);
      return;
    }
    const response: ApiResponse = { success: false, error: err.message };
    res.status(400).json(response);
  }
});

export default router;
