import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ConnectionConfig, BackupResult, BackupRecord, DatabaseDriver } from '../types/index.js';

// Create mock store functions
const mockGetConnection = jest.fn<(id: string) => ConnectionConfig | undefined>();
const mockGetConnections = jest.fn<() => ConnectionConfig[]>().mockReturnValue([]);
const mockGetBackups = jest.fn<(connectionId?: string) => BackupRecord[]>();
const mockGetBackup = jest.fn<(id: string) => BackupRecord | undefined>();
const mockAddBackup = jest.fn<(backup: BackupRecord) => void>();
const mockUpdateBackup = jest.fn<(id: string, updates: Partial<BackupRecord>) => BackupRecord | undefined>();

jest.unstable_mockModule('../store/index.js', () => ({
  store: {
    getConnection: mockGetConnection,
    getConnections: mockGetConnections,
    addConnection: jest.fn(),
    updateConnection: jest.fn(),
    deleteConnection: jest.fn(),
    getBackups: mockGetBackups,
    getBackup: mockGetBackup,
    addBackup: mockAddBackup,
    updateBackup: mockUpdateBackup,
    getSchedules: jest.fn().mockReturnValue([]),
    getSchedule: jest.fn(),
    addSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    deleteSchedule: jest.fn(),
  },
}));

// Mock driver-registry
const mockDriverBackup = jest.fn<(config: ConnectionConfig, outputPath: string) => Promise<BackupResult>>();

const mockDriver: DatabaseDriver = {
  type: 'mysql',
  displayName: 'MySQL',
  defaultPort: 3306,
  fileExtension: '.sql',
  testConnection: jest.fn<any>().mockResolvedValue({ reachable: true }),
  backup: mockDriverBackup,
  getBackupCommand: jest.fn<(config: ConnectionConfig, outputPath: string) => string>().mockReturnValue('mysqldump ...'),
  restore: jest.fn<any>().mockResolvedValue({ success: true, duration: 100 }),
  getRestoreCommand: jest.fn<any>().mockReturnValue('mysql ...'),
};

jest.unstable_mockModule('../drivers/driver-registry.js', () => ({
  getDriver: jest.fn().mockReturnValue(mockDriver),
  getSupportedTypes: jest.fn().mockReturnValue(['mysql']),
}));

// Mock config
jest.unstable_mockModule('../config/index.js', () => ({
  config: {
    port: 3777,
    backupDir: '/tmp/test-backups',
    dataDir: '/tmp/test-data',
    apiKey: 'test-key',
    storage: { provider: 'local' }
  },
}));

// Mock StorageProvider
const mockStorageProvider = {
  upload: jest.fn<any>().mockResolvedValue('/tmp/backup.sql'),
  delete: jest.fn<any>().mockResolvedValue(true),
  getDownloadStream: jest.fn<any>().mockResolvedValue({ pipe: jest.fn() }),
  downloadToTemp: jest.fn<any>().mockResolvedValue(undefined)
};

jest.unstable_mockModule('../services/storage.service.js', () => ({
  getStorageProvider: jest.fn().mockReturnValue(mockStorageProvider),
}));

// Mock fs for backup dir creation
jest.unstable_mockModule('node:fs', () =>
{
  const actual = jest.requireActual('node:fs') as any;
  return {
    default: {
      ...actual,
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
      statSync: jest.fn().mockReturnValue({ size: 4096 }),
    },
  };
});

// Mock scheduler
jest.unstable_mockModule('../services/scheduler.service.js', () => ({
  loadAllSchedules: jest.fn(),
  startSchedule: jest.fn(),
  stopSchedule: jest.fn(),
  stopAll: jest.fn(),
  validateCron: jest.fn().mockReturnValue(true),
}));

const supertest = await import('supertest');
const { createApp } = await import('../server.js');

function makeConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig
{
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

function makeBackupRecord(overrides: Partial<BackupRecord> = {}): BackupRecord
{
  return {
    id: 'backup-1',
    connectionId: 'conn-1',
    connectionName: 'TestDB',
    databaseType: 'mysql',
    database: 'testdb',
    filename: 'test_backup.sql',
    filepath: '/tmp/test_backup.sql',
    sizeBytes: 4096,
    status: 'completed',
    errorMessage: null,
    isPartial: false,
    rowLimit: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    duration: 60000,
    ...overrides,
  };
}

describe('backups routes', () =>
{
  let app: ReturnType<typeof createApp>;

  beforeEach(() =>
  {
    app = createApp();
    jest.clearAllMocks();
  });

  describe('POST /api/backups/:connectionId', () =>
  {
    it('should execute a backup and return the record', async () =>
    {
      const conn = makeConnection();
      mockGetConnection.mockReturnValue(conn);
      mockAddBackup.mockImplementation(() => { });
      mockUpdateBackup.mockImplementation((_id, updates) => makeBackupRecord(updates));

      mockDriverBackup.mockResolvedValue({
        success: true,
        filepath: '/tmp/backup.sql',
        sizeBytes: 4096,
        duration: 300,
      });

      const res = await supertest.default(app).post('/api/backups/conn-1').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connectionId).toBe('conn-1');
      expect(res.body.data.status).toBe('completed');
    });

    it('should return 400 for non-existent connection', async () =>
    {
      mockGetConnection.mockReturnValue(undefined);

      const res = await supertest.default(app).post('/api/backups/non-existent').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should accept rowLimit in request body', async () =>
    {
      const conn = makeConnection();
      mockGetConnection.mockReturnValue(conn);
      mockAddBackup.mockImplementation(() => { });
      mockUpdateBackup.mockImplementation((_id, updates) => makeBackupRecord(updates));

      mockDriverBackup.mockResolvedValue({
        success: true,
        filepath: '/tmp/backup.sql',
        sizeBytes: 1024,
        duration: 200,
      });

      const res = await supertest.default(app)
        .post('/api/backups/conn-1')
        .set('Authorization', 'Bearer test-key')
        .send({ rowLimit: 500 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid rowLimit', async () =>
    {
      const res = await supertest.default(app)
        .post('/api/backups/conn-1')
        .set('Authorization', 'Bearer test-key')
        .send({ rowLimit: -1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for non-integer rowLimit', async () =>
    {
      const res = await supertest.default(app)
        .post('/api/backups/conn-1')
        .set('Authorization', 'Bearer test-key')
        .send({ rowLimit: 10.5 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should handle failed backup', async () =>
    {
      const conn = makeConnection();
      mockGetConnection.mockReturnValue(conn);
      mockAddBackup.mockImplementation(() => { });
      mockUpdateBackup.mockImplementation((_id, updates) => makeBackupRecord(updates));

      mockDriverBackup.mockResolvedValue({
        success: false,
        filepath: '/tmp/backup.sql',
        sizeBytes: 0,
        duration: 100,
        errorMessage: 'Connection refused',
      });

      const res = await supertest.default(app).post('/api/backups/conn-1').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('failed');
      expect(res.body.data.errorMessage).toBe('Connection refused');
    });
  });

  describe('GET /api/backups', () =>
  {
    it('should return empty array when no backups exist', async () =>
    {
      mockGetBackups.mockReturnValue([]);

      const res = await supertest.default(app).get('/api/backups').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('should return all backups', async () =>
    {
      mockGetBackups.mockReturnValue([
        makeBackupRecord({ id: 'b1' }),
        makeBackupRecord({ id: 'b2' }),
      ]);

      const res = await supertest.default(app).get('/api/backups').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('should pass connectionId filter to store', async () =>
    {
      mockGetBackups.mockReturnValue([makeBackupRecord()]);

      await supertest.default(app).get('/api/backups?connectionId=conn-1').set('Authorization', 'Bearer test-key');

      expect(mockGetBackups).toHaveBeenCalledWith('conn-1');
    });
  });

  describe('GET /api/backups/:id/download', () =>
  {
    it('should return 404 for non-existent backup', async () =>
    {
      mockGetBackup.mockReturnValue(undefined);

      const res = await supertest.default(app).get('/api/backups/non-existent/download').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Backup não encontrado');
    });
  });
});
