import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonStore } from '../store/json-store.js';
import type { ConnectionConfig, BackupRecord, ScheduleConfig } from '../types/index.js';

function makeConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'Test DB',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'secret',
    database: 'testdb',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBackup(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    id: 'backup-1',
    connectionId: 'conn-1',
    connectionName: 'Test DB',
    databaseType: 'mysql',
    database: 'testdb',
    filename: 'test_backup.sql',
    filepath: '/tmp/test_backup.sql',
    sizeBytes: 1024,
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

describe('JsonStore', () => {
  let store: JsonStore;
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-test-'));
    tempFile = path.join(tempDir, 'store.json');
    // Write a clean initial state to the file to avoid the shallow-copy bug
    // in DEFAULT_DATA (the spread operator shares array references)
    fs.writeFileSync(tempFile, JSON.stringify({ connections: [], backups: [], schedules: [] }, null, 2));
    store = new JsonStore(tempFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create the store file if it does not exist', () => {
      expect(fs.existsSync(tempFile)).toBe(true);
    });

    it('should create the directory recursively if it does not exist', () => {
      const deepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-deep-'));
      const deepPath = path.join(deepDir, 'nested', 'dir', 'store.json');
      new JsonStore(deepPath);
      expect(fs.existsSync(deepPath)).toBe(true);
      fs.rmSync(deepDir, { recursive: true, force: true });
    });

    it('should initialize with empty arrays', () => {
      expect(store.getConnections()).toEqual([]);
      expect(store.getBackups()).toEqual([]);
      expect(store.getSchedules()).toEqual([]);
    });

    it('should load existing data from file', () => {
      const conn = makeConnection();
      store.addConnection(conn);

      const store2 = new JsonStore(tempFile);
      expect(store2.getConnections()).toHaveLength(1);
      expect(store2.getConnection('conn-1')).toEqual(conn);
    });
  });

  // === Connections ===
  describe('connections', () => {
    it('should add a connection', () => {
      const conn = makeConnection();
      store.addConnection(conn);
      expect(store.getConnections()).toHaveLength(1);
      expect(store.getConnection('conn-1')).toEqual(conn);
    });

    it('should return undefined for non-existent connection', () => {
      expect(store.getConnection('non-existent')).toBeUndefined();
    });

    it('should list all connections', () => {
      store.addConnection(makeConnection({ id: 'conn-1' }));
      store.addConnection(makeConnection({ id: 'conn-2', name: 'Second DB' }));
      expect(store.getConnections()).toHaveLength(2);
    });

    it('should update a connection and set updatedAt', () => {
      store.addConnection(makeConnection());
      const updated = store.updateConnection('conn-1', { name: 'Updated DB' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated DB');
      expect(updated!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should return undefined when updating non-existent connection', () => {
      const result = store.updateConnection('non-existent', { name: 'X' });
      expect(result).toBeUndefined();
    });

    it('should delete a connection', () => {
      store.addConnection(makeConnection());
      expect(store.deleteConnection('conn-1')).toBe(true);
      expect(store.getConnections()).toHaveLength(0);
    });

    it('should return false when deleting non-existent connection', () => {
      expect(store.deleteConnection('non-existent')).toBe(false);
    });

    it('should persist connection changes to disk', () => {
      store.addConnection(makeConnection());
      const raw = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
      expect(raw.connections).toHaveLength(1);
    });
  });

  // === Backups ===
  describe('backups', () => {
    it('should add a backup', () => {
      const backup = makeBackup();
      store.addBackup(backup);
      expect(store.getBackups()).toHaveLength(1);
    });

    it('should get a backup by id', () => {
      const backup = makeBackup();
      store.addBackup(backup);
      expect(store.getBackup('backup-1')).toEqual(backup);
    });

    it('should return undefined for non-existent backup', () => {
      expect(store.getBackup('non-existent')).toBeUndefined();
    });

    it('should filter backups by connectionId', () => {
      store.addBackup(makeBackup({ id: 'b1', connectionId: 'conn-1' }));
      store.addBackup(makeBackup({ id: 'b2', connectionId: 'conn-2' }));
      store.addBackup(makeBackup({ id: 'b3', connectionId: 'conn-1' }));

      const filtered = store.getBackups('conn-1');
      expect(filtered).toHaveLength(2);
      expect(filtered.every(b => b.connectionId === 'conn-1')).toBe(true);
    });

    it('should sort backups by startedAt descending', () => {
      store.addBackup(makeBackup({ id: 'b1', startedAt: '2026-01-01T00:00:00.000Z' }));
      store.addBackup(makeBackup({ id: 'b2', startedAt: '2026-01-03T00:00:00.000Z' }));
      store.addBackup(makeBackup({ id: 'b3', startedAt: '2026-01-02T00:00:00.000Z' }));

      const backups = store.getBackups();
      expect(backups[0]!.id).toBe('b2');
      expect(backups[1]!.id).toBe('b3');
      expect(backups[2]!.id).toBe('b1');
    });

    it('should update a backup', () => {
      store.addBackup(makeBackup());
      const updated = store.updateBackup('backup-1', { status: 'failed', errorMessage: 'disk full' });
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('failed');
      expect(updated!.errorMessage).toBe('disk full');
    });

    it('should return undefined when updating non-existent backup', () => {
      expect(store.updateBackup('non-existent', { status: 'failed' })).toBeUndefined();
    });
  });

  // === Schedules ===
  describe('schedules', () => {
    it('should add a schedule', () => {
      store.addSchedule(makeSchedule());
      expect(store.getSchedules()).toHaveLength(1);
    });

    it('should get a schedule by id', () => {
      const schedule = makeSchedule();
      store.addSchedule(schedule);
      expect(store.getSchedule('sched-1')).toEqual(schedule);
    });

    it('should return undefined for non-existent schedule', () => {
      expect(store.getSchedule('non-existent')).toBeUndefined();
    });

    it('should filter schedules by connectionId', () => {
      store.addSchedule(makeSchedule({ id: 's1', connectionId: 'conn-1' }));
      store.addSchedule(makeSchedule({ id: 's2', connectionId: 'conn-2' }));

      expect(store.getSchedules('conn-1')).toHaveLength(1);
      expect(store.getSchedules('conn-2')).toHaveLength(1);
    });

    it('should update a schedule', () => {
      store.addSchedule(makeSchedule());
      const updated = store.updateSchedule('sched-1', { enabled: false });
      expect(updated).toBeDefined();
      expect(updated!.enabled).toBe(false);
    });

    it('should return undefined when updating non-existent schedule', () => {
      expect(store.updateSchedule('non-existent', { enabled: false })).toBeUndefined();
    });

    it('should delete a schedule', () => {
      store.addSchedule(makeSchedule());
      expect(store.deleteSchedule('sched-1')).toBe(true);
      expect(store.getSchedules()).toHaveLength(0);
    });

    it('should return false when deleting non-existent schedule', () => {
      expect(store.deleteSchedule('non-existent')).toBe(false);
    });

    it('should persist schedule changes to disk', () => {
      store.addSchedule(makeSchedule());
      const raw = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
      expect(raw.schedules).toHaveLength(1);
    });
  });
});
