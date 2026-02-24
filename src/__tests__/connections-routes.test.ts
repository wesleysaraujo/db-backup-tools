import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ConnectionConfig, BackupResult, DatabaseDriver } from '../types/index.js';

let tempDir: string;
let tempFile: string;

// Create mock store functions
const mockGetConnections = jest.fn<() => ConnectionConfig[]>();
const mockGetConnection = jest.fn<(id: string) => ConnectionConfig | undefined>();
const mockAddConnection = jest.fn<(conn: ConnectionConfig) => void>();
const mockUpdateConnection = jest.fn<(id: string, updates: Partial<ConnectionConfig>) => ConnectionConfig | undefined>();
const mockDeleteConnection = jest.fn<(id: string) => boolean>();

jest.unstable_mockModule('../store/index.js', () => ({
  store: {
    getConnections: mockGetConnections,
    getConnection: mockGetConnection,
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
    deleteConnection: mockDeleteConnection,
    getBackups: jest.fn().mockReturnValue([]),
    getBackup: jest.fn(),
    addBackup: jest.fn(),
    updateBackup: jest.fn(),
    getSchedules: jest.fn().mockReturnValue([]),
    getSchedule: jest.fn(),
    addSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    deleteSchedule: jest.fn(),
  },
}));

// Mock driver-registry
const mockTestConnectionDriver = jest.fn<(config: ConnectionConfig) => Promise<boolean>>();

const mockDriver: DatabaseDriver = {
  type: 'mysql',
  displayName: 'MySQL',
  defaultPort: 3306,
  fileExtension: '.sql',
  testConnection: mockTestConnectionDriver,
  backup: jest.fn<(config: ConnectionConfig, outputPath: string) => Promise<BackupResult>>(),
  getBackupCommand: jest.fn<(config: ConnectionConfig, outputPath: string) => string>().mockReturnValue('mysqldump ...'),
  restore: jest.fn<any>().mockResolvedValue({ success: true, duration: 100 }),
  getRestoreCommand: jest.fn<any>().mockReturnValue('mysql ...'),
};

jest.unstable_mockModule('../drivers/driver-registry.js', () => ({
  getDriver: jest.fn().mockReturnValue(mockDriver),
  getSupportedTypes: jest.fn().mockReturnValue(['mysql']),
}));

// Mock scheduler
jest.unstable_mockModule('../services/scheduler.service.js', () => ({
  loadAllSchedules: jest.fn(),
  startSchedule: jest.fn(),
  stopSchedule: jest.fn(),
  stopAll: jest.fn(),
  validateCron: jest.fn().mockReturnValue(true),
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
    name: 'My MySQL',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'supersecret',
    database: 'mydb',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('connections routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    mockGetConnections.mockReturnValue([]);
  });

  describe('POST /api/connections', () => {
    it('should create a new connection and mask the password', async () => {
      mockAddConnection.mockImplementation(() => {});

      const res = await supertest.default(app)
        .post('/api/connections')
        .send({
          name: 'My MySQL',
          type: 'mysql',
          host: 'localhost',
          port: 3306,
          username: 'root',
          password: 'supersecret',
          database: 'mydb',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('My MySQL');
      expect(res.body.data.password).toBe('****');
      expect(res.body.data.id).toBeDefined();
      expect(mockAddConnection).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid input with 400', async () => {
      const res = await supertest.default(app)
        .post('/api/connections')
        .send({ name: '' })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject unsupported database type', async () => {
      const res = await supertest.default(app)
        .post('/api/connections')
        .send({
          name: 'PG',
          type: 'postgresql',
          host: 'localhost',
          username: 'user',
          password: 'pass',
          database: 'db',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Tipo nao suportado');
    });

    it('should use default port when not provided', async () => {
      mockAddConnection.mockImplementation(() => {});

      const res = await supertest.default(app)
        .post('/api/connections')
        .send({
          name: 'NoPorts',
          type: 'mysql',
          host: 'localhost',
          username: 'root',
          password: 'pass',
          database: 'db',
        })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(201);
      expect(res.body.data.port).toBe(3306);
    });
  });

  describe('GET /api/connections', () => {
    it('should return empty array when no connections exist', async () => {
      mockGetConnections.mockReturnValue([]);

      const res = await supertest.default(app).get('/api/connections').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should return all connections with masked passwords', async () => {
      mockGetConnections.mockReturnValue([
        makeConnection({ id: 'c1', name: 'DB1', password: 'secret1' }),
        makeConnection({ id: 'c2', name: 'DB2', password: 'secret2' }),
      ]);

      const res = await supertest.default(app).get('/api/connections').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].password).toBe('****');
      expect(res.body.data[1].password).toBe('****');
    });
  });

  describe('GET /api/connections/:id', () => {
    it('should return 404 for non-existent connection', async () => {
      mockGetConnection.mockReturnValue(undefined);

      const res = await supertest.default(app).get('/api/connections/non-existent').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return a connection by id with masked password', async () => {
      const conn = makeConnection({ id: 'test-id', password: 'realpassword' });
      mockGetConnection.mockReturnValue(conn);

      const res = await supertest.default(app).get('/api/connections/test-id').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('test-id');
      expect(res.body.data.password).toBe('****');
    });
  });

  describe('PUT /api/connections/:id', () => {
    it('should update an existing connection', async () => {
      const updated = makeConnection({ id: 'test-id', name: 'Updated' });
      mockUpdateConnection.mockReturnValue(updated);

      const res = await supertest.default(app)
        .put('/api/connections/test-id')
        .send({ name: 'Updated' })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
      expect(res.body.data.password).toBe('****');
    });

    it('should return 404 for updating non-existent connection', async () => {
      mockUpdateConnection.mockReturnValue(undefined);

      const res = await supertest.default(app)
        .put('/api/connections/non-existent')
        .send({ name: 'X' })
        .set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/connections/:id', () => {
    it('should delete an existing connection', async () => {
      mockDeleteConnection.mockReturnValue(true);

      const res = await supertest.default(app).delete('/api/connections/test-id').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockDeleteConnection).toHaveBeenCalledWith('test-id');
    });

    it('should return 404 for deleting non-existent connection', async () => {
      mockDeleteConnection.mockReturnValue(false);

      const res = await supertest.default(app).delete('/api/connections/non-existent').set('Authorization', 'Bearer test-key');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/connections/:id/test', () => {
    it('should return reachable true when driver succeeds', async () => {
      const conn = makeConnection({ id: 'test-id' });
      mockGetConnection.mockReturnValue(conn);
      mockTestConnectionDriver.mockResolvedValue(true);

      const res = await supertest.default(app).post('/api/connections/test-id/test').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(200);
      expect(res.body.data.reachable).toBe(true);
    });

    it('should return 404 for testing non-existent connection', async () => {
      mockGetConnection.mockReturnValue(undefined);

      const res = await supertest.default(app).post('/api/connections/non-existent/test').set('Authorization', 'Bearer test-key');

      expect(res.status).toBe(404);
    });
  });
});
