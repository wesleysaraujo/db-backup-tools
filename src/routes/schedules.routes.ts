import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store/index.js';
import { validateCron, startSchedule, stopSchedule } from '../services/scheduler.service.js';
import type { ApiResponse, ScheduleConfig } from '../types/index.js';

const router = Router();

const createScheduleSchema = z.object({
  connectionId: z.string().min(1),
  cronExpression: z.string().min(1),
  enabled: z.boolean().optional(),
});

const updateScheduleSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

// POST /api/schedules
router.post('/', (req, res) => {
  const parsed = createScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse = { success: false, error: parsed.error.message };
    res.status(400).json(response);
    return;
  }

  const { data } = parsed;

  const connection = store.getConnection(data.connectionId);
  if (!connection) {
    const response: ApiResponse = { success: false, error: 'Conexao nao encontrada' };
    res.status(404).json(response);
    return;
  }

  if (!validateCron(data.cronExpression)) {
    const response: ApiResponse = { success: false, error: 'Expressao cron invalida' };
    res.status(400).json(response);
    return;
  }

  const schedule: ScheduleConfig = {
    id: uuidv4(),
    connectionId: data.connectionId,
    cronExpression: data.cronExpression,
    enabled: data.enabled ?? true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date().toISOString(),
  };

  store.addSchedule(schedule);

  if (schedule.enabled) {
    startSchedule(schedule);
  }

  const response: ApiResponse = { success: true, data: schedule, message: 'Agendamento criado' };
  res.status(201).json(response);
});

// GET /api/schedules
router.get('/', (_req, res) => {
  const schedules = store.getSchedules();
  const response: ApiResponse = { success: true, data: schedules };
  res.json(response);
});

// PUT /api/schedules/:id
router.put('/:id', (req, res) => {
  const parsed = updateScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse = { success: false, error: parsed.error.message };
    res.status(400).json(response);
    return;
  }

  const { data } = parsed;
  const id = req.params['id']!;

  if (data.cronExpression && !validateCron(data.cronExpression)) {
    const response: ApiResponse = { success: false, error: 'Expressao cron invalida' };
    res.status(400).json(response);
    return;
  }

  const updated = store.updateSchedule(id, data as Partial<ScheduleConfig>);
  if (!updated) {
    const response: ApiResponse = { success: false, error: 'Agendamento nao encontrado' };
    res.status(404).json(response);
    return;
  }

  stopSchedule(id);
  if (updated.enabled) {
    startSchedule(updated);
  }

  const response: ApiResponse = { success: true, data: updated, message: 'Agendamento atualizado' };
  res.json(response);
});

// DELETE /api/schedules/:id
router.delete('/:id', (req, res) => {
  const id = req.params['id']!;
  stopSchedule(id);

  const deleted = store.deleteSchedule(id);
  if (!deleted) {
    const response: ApiResponse = { success: false, error: 'Agendamento nao encontrado' };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse = { success: true, message: 'Agendamento removido' };
  res.json(response);
});

export default router;
