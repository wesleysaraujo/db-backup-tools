import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ConnectionConfig, BackupResult, ScheduleConfig, DatabaseDriver } from '../types/index.js';

// Create mock store functions
const mockGetConnection = jest.fn<(id: string) => ConnectionConfig | undefined>();
const mockGetSchedules = jest.fn<(connectionId?: string) => ScheduleConfig[]>();
const mockGetSchedule = jest.fn<(id: string) => ScheduleConfig | undefined>();
const mockAddSchedule = jest.fn<(schedule: ScheduleConfig) => void>();
const mockUpdateSchedule = jest.fn<(id: string, updates: Partial<ScheduleConfig>) => ScheduleConfig | undefined>();
const mockDeleteSchedule = jest.fn<(id: string) => boolean>();

jest.unstable_mockModule('../store/index.js', () => ({
  store: {
    getConnection: mockGetConnection,
    getConnections: jest.fn().mockReturnValue([]),
    addConnection: jest.fn(),
    updateConnection: jest.fn(),
    deleteConnection: jest.fn(),
    getBackups: jest.fn().mockReturnValue([]),
    getBackup: jest.fn(),
    addBackup: jest.fn(),
    updateBackup: jest.fn(),
    getSchedules: mockGetSchedules,
    getSchedule: mockGetSchedule,
    addSchedule: mockAddSchedule,
    updateSchedule: mockUpdateSchedule,
    deleteSchedule: mockDeleteSchedule,
  },
}));

// Mock driver-registry
jest.unstable_mockModule('../drivers/driver-registry.js', () => ({
  getDriver: jest.fn().mockReturnValue({
    type: 'mysql',
    displayName: 'MySQL',
    defaultPort: 3306,
    fileExtension: '.sql',
    testConnection: jest.fn(),
    backup: jest.fn(),
    getBackupCommand: jest.fn().mockReturnValue(''),
    restore: jest.fn<any>().mockResolvedValue({ success: true, duration: 100 }),
    getRestoreCommand: jest.fn<any>().mockReturnValue(''),
  } as DatabaseDriver),
  getSupportedTypes: jest.fn().mockReturnValue(['mysql']),
}));

// Mock scheduler
const mockStartSchedule = jest.fn();
const mockStopSchedule = jest.fn();
const mockValidateCron = jest.fn<(expression: string) => boolean>().mockReturnValue(true);

jest.unstable_mockModule('../services/scheduler.service.js', () => ({
  loadAllSchedules: jest.fn(),
  startSchedule: mockStartSchedule,
  stopSchedule: mockStopSchedule,
  stopAll: jest.fn(),
  validateCron: mockValidateCron,
}));

// Mock config with apiKey for auth middleware
jest.unstable_mockModule('../config/index.js', () => ({
  config: {
    port: 3777,
    backupDir: '/tmp/test-backups',
    dataDir: '/tmp/test-data',
    apiKey: 'test-key',
  },
}));

const supertest = await import('supertest');
const { createApp } = await import('../server.js');

function makeConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'TestDB',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'pass',
    database: 'testdb',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    id: 'sched-1',
    connectionId: 'conn-1',
    cronExpression: '0 0 * * *',
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('schedules routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    mockValidateCron.mockReturnValue(true);
    mockGetSchedules.mockReturnValue([]);
  });

  describe('POST /api/schedules', () => {
    it('should create a new schedule', async () => {
      mockGetConnection.mockReturnValue(makeConnection());
      mockAddSchedule.mockImplementation(() => {});

      const res = await supertest.default(app)
        .post('/api/schedules')
        .send({
          connectionId: 'conn-1',
          cronExpression: '0 0 * * *',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connectionId).toBe('conn-1');
      expect(res.body.data.cronExpression).toBe('0 0 * * *');
      expect(res.body.data.enabled).toBe(true);
    });

    it('should reject invalid input', async () => {
      const res = await supertest.default(app)
        .post('/api/schedules')
        .send({})
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when connection does not exist', async () => {
      mockGetConnection.mockReturnValue(undefined);

      const res = await supertest.default(app)
        .post('/api/schedules')
        .send({
          connectionId: 'non-existent',
          cronExpression: '0 0 * * *',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
    });

    it('should reject invalid cron expression', async () => {
      mockGetConnection.mockReturnValue(makeConnection());
      mockValidateCron.mockReturnValue(false);

      const res = await supertest.default(app)
        .post('/api/schedules')
        .send({
          connectionId: 'conn-1',
          cronExpression: 'invalid-cron',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cron invalida');
    });

    it('should call startSchedule when enabled', async () => {
      mockGetConnection.mockReturnValue(makeConnection());
      mockAddSchedule.mockImplementation(() => {});

      await supertest.default(app)
        .post('/api/schedules')
        .send({
          connectionId: 'conn-1',
          cronExpression: '0 0 * * *',
          enabled: true,
        })
        .set('Authorization', 'Bearer test-key');

      expect(mockStartSchedule).toHaveBeenCalled();
    });

    it('should not call startSchedule when disabled', async () => {
      mockGetConnection.mockReturnValue(makeConnection());
      mockAddSchedule.mockImplementation(() => {});

      await supertest.default(app)
        .post('/api/schedules')
        .send({
          connectionId: 'conn-1',
          cronExpression: '0 0 * * *',
          enabled: false,
        })
        .set('Authorization', 'Bearer test-key');

      expect(mockStartSchedule).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/schedules', () => {
    it('should return empty array when no schedules exist', async () => {
      mockGetSchedules.mockReturnValue([]);

      const res = await supertest.default(app).get('/api/schedules').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('should return all schedules', async () => {
      mockGetSchedules.mockReturnValue([
        makeSchedule({ id: 's1' }),
        makeSchedule({ id: 's2', cronExpression: '0 12 * * *' }),
      ]);

      const res = await supertest.default(app).get('/api/schedules').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('PUT /api/schedules/:id', () => {
    it('should update an existing schedule', async () => {
      const updated = makeSchedule({ enabled: false });
      mockUpdateSchedule.mockReturnValue(updated);

      const res = await supertest.default(app)
        .put('/api/schedules/sched-1')
        .send({ enabled: false })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
    });

    it('should return 404 for non-existent schedule', async () => {
      mockUpdateSchedule.mockReturnValue(undefined);

      const res = await supertest.default(app)
        .put('/api/schedules/non-existent')
        .send({ enabled: false })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
    });

    it('should reject invalid cron when updating cronExpression', async () => {
      mockValidateCron.mockReturnValue(false);

      const res = await supertest.default(app)
        .put('/api/schedules/sched-1')
        .send({ cronExpression: 'bad-cron' })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
    });

    it('should call stopSchedule and startSchedule when updating to enabled', async () => {
      const updated = makeSchedule({ id: 'sched-1', enabled: true });
      mockUpdateSchedule.mockReturnValue(updated);

      const res = await supertest.default(app)
        .put('/api/schedules/sched-1')
        .send({ enabled: true })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(mockStopSchedule).toHaveBeenCalledWith('sched-1');
      expect(mockStartSchedule).toHaveBeenCalled();
    });

    it('should call stopSchedule but not startSchedule when disabling', async () => {
      const updated = makeSchedule({ id: 'sched-1', enabled: false });
      mockUpdateSchedule.mockReturnValue(updated);

      const res = await supertest.default(app)
        .put('/api/schedules/sched-1')
        .send({ enabled: false })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(mockStopSchedule).toHaveBeenCalledWith('sched-1');
      expect(mockStartSchedule).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/schedules/:id', () => {
    it('should delete an existing schedule', async () => {
      mockDeleteSchedule.mockReturnValue(true);

      const res = await supertest.default(app).delete('/api/schedules/sched-1').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockStopSchedule).toHaveBeenCalledWith('sched-1');
    });

    it('should return 404 for non-existent schedule', async () => {
      mockDeleteSchedule.mockReturnValue(false);

      const res = await supertest.default(app).delete('/api/schedules/non-existent').set('Authorization', 'Bearer test-key');
      expect(res.status).toBe(404);
    });

    it('should call stopSchedule when deleting', async () => {
      mockDeleteSchedule.mockReturnValue(true);

      await supertest.default(app).delete('/api/schedules/sched-1').set('Authorization', 'Bearer test-key');

      expect(mockStopSchedule).toHaveBeenCalledWith('sched-1');
    });
  });
});
