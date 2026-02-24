import cron from 'node-cron';
import { store } from '../store/index.js';
import { runBackup } from './backup.service.js';
import type { ScheduleConfig } from '../types/index.js';

const activeJobs = new Map<string, cron.ScheduledTask>();

export function startSchedule(schedule: ScheduleConfig): void {
  if (activeJobs.has(schedule.id)) {
    stopSchedule(schedule.id);
  }

  if (!schedule.enabled) return;

  const task = cron.schedule(schedule.cronExpression, async () => {
    console.log(`[Scheduler] Executando backup agendado: ${schedule.id} (connection: ${schedule.connectionId})`);
    try {
      const result = await runBackup(schedule.connectionId);
      store.updateSchedule(schedule.id, { lastRunAt: new Date().toISOString() });
      console.log(`[Scheduler] Backup concluido: ${result.id} - ${result.status}`);
    } catch (err) {
      console.error(`[Scheduler] Erro no backup agendado ${schedule.id}:`, err);
    }
  });

  activeJobs.set(schedule.id, task);
}

export function stopSchedule(id: string): void {
  const job = activeJobs.get(id);
  if (job) {
    job.stop();
    activeJobs.delete(id);
  }
}

export function stopAll(): void {
  for (const [id, job] of activeJobs) {
    job.stop();
    activeJobs.delete(id);
  }
}

export function loadAllSchedules(): void {
  const schedules = store.getSchedules();
  for (const schedule of schedules) {
    if (schedule.enabled) {
      startSchedule(schedule);
    }
  }
  console.log(`[Scheduler] ${activeJobs.size} agendamento(s) ativo(s)`);
}

export function validateCron(expression: string): boolean {
  return cron.validate(expression);
}
