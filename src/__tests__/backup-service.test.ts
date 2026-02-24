import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ConnectionConfig, BackupResult, DatabaseDriver } from '../types/index.js';

// Mock dependencies before importing the module under test
const mockGetDriver = jest.fn<(type: string) => DatabaseDriver>();
const mockStore = {
  getConnection: jest.fn<(id: string) => ConnectionConfig | undefined>(),
  addBackup: jest.fn(),
  updateBackup: jest.fn(),
};

jest.unstable_mockModule('../drivers/driver-registry.js', () => ({
  getDriver: mockGetDriver,
}));

jest.unstable_mockModule('../store/index.js', () => ({
  store: mockStore,
}));

jest.unstable_mockModule('../config/index.js', () => ({
  config: {
    port: 3777,
    backupDir: '/tmp/db-backup-test-backups',
    dataDir: '/tmp/db-backup-test-data',
  },
}));

// Mock fs to avoid actually creating directories
const originalFs = await import('node:fs');
jest.unstable_mockModule('node:fs', () => ({
  default: {
    ...originalFs.default,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
  },
}));

const { runBackup, testConnection } = await import('../services/backup.service.js');

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

function makeMockDriver(overrides: Partial<{
  backupResult: BackupResult;
  testResult: boolean;
}> = {}): DatabaseDriver {
  return {
    type: 'mysql',
    displayName: 'MySQL',
    defaultPort: 3306,
    fileExtension: '.sql',
    testConnection: jest.fn<(config: ConnectionConfig) => Promise<boolean>>()
      .mockResolvedValue(overrides.testResult ?? true),
    backup: jest.fn<(config: ConnectionConfig, outputPath: string) => Promise<BackupResult>>()
      .mockResolvedValue(overrides.backupResult ?? {
        success: true,
        filepath: '/tmp/backup.sql',
        sizeBytes: 2048,
        duration: 500,
      }),
    getBackupCommand: jest.fn<(config: ConnectionConfig, outputPath: string) => string>()
      .mockReturnValue('mysqldump ...'),
    restore: jest.fn<any>().mockResolvedValue({ success: true, duration: 100 }),
    getRestoreCommand: jest.fn<any>().mockReturnValue('mysql ...'),
  };
}

describe('backup.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runBackup', () => {
    it('should throw when connection is not found', async () => {
      mockStore.getConnection.mockReturnValue(undefined);
      await expect(runBackup('non-existent')).rejects.toThrow('Conexao nao encontrada');
    });

    it('should execute backup and return a completed record on success', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      const driver = makeMockDriver();
      mockGetDriver.mockReturnValue(driver);

      const result = await runBackup('conn-1');

      expect(result.connectionId).toBe('conn-1');
      expect(result.status).toBe('completed');
      expect(result.sizeBytes).toBe(2048);
      expect(mockStore.addBackup).toHaveBeenCalled();
      expect(mockStore.updateBackup).toHaveBeenCalled();
    });

    it('should mark record as failed when driver backup fails', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      const driver = makeMockDriver({
        backupResult: {
          success: false,
          filepath: '/tmp/backup.sql',
          sizeBytes: 0,
          duration: 100,
          errorMessage: 'mysqldump failed',
        },
      });
      mockGetDriver.mockReturnValue(driver);

      const result = await runBackup('conn-1');

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('mysqldump failed');
    });

    it('should call getDriver with the connection type', async () => {
      const conn = makeConnection({ type: 'mysql' });
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      await runBackup('conn-1');
      expect(mockGetDriver).toHaveBeenCalledWith('mysql');
    });

    it('should generate a record with correct metadata', async () => {
      const conn = makeConnection({ name: 'ProdDB', database: 'production' });
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      const result = await runBackup('conn-1');

      expect(result.connectionName).toBe('ProdDB');
      expect(result.database).toBe('production');
      expect(result.databaseType).toBe('mysql');
      expect(result.id).toBeDefined();
      expect(result.startedAt).toBeDefined();
    });

    it('should pass options to driver when rowLimit is provided', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      const driver = makeMockDriver();
      mockGetDriver.mockReturnValue(driver);

      await runBackup('conn-1', { rowLimit: 500 });

      expect(driver.backup).toHaveBeenCalledWith(
        conn,
        expect.any(String),
        { rowLimit: 500 },
      );
    });

    it('should include _partial in filename when rowLimit is set', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      const result = await runBackup('conn-1', { rowLimit: 100 });

      expect(result.filename).toContain('_partial');
    });

    it('should not include _partial in filename for full backup', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      const result = await runBackup('conn-1');

      expect(result.filename).not.toContain('_partial');
    });

    it('should set isPartial and rowLimit in record when rowLimit is provided', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      const result = await runBackup('conn-1', { rowLimit: 250 });

      expect(result.isPartial).toBe(true);
      expect(result.rowLimit).toBe(250);
    });

    it('should set isPartial=false and rowLimit=null for full backup', async () => {
      const conn = makeConnection();
      mockStore.getConnection.mockReturnValue(conn);
      mockGetDriver.mockReturnValue(makeMockDriver());

      const result = await runBackup('conn-1');

      expect(result.isPartial).toBe(false);
      expect(result.rowLimit).toBeNull();
    });
  });

  describe('testConnection', () => {
    it('should throw when connection is not found', async () => {
      mockStore.getConnection.mockReturnValue(undefined);
      await expect(testConnection('non-existent')).rejects.toThrow('Conexao nao encontrada');
    });

    it('should return true when driver reports connection is reachable', async () => {
      mockStore.getConnection.mockReturnValue(makeConnection());
      mockGetDriver.mockReturnValue(makeMockDriver({ testResult: true }));

      const result = await testConnection('conn-1');
      expect(result).toBe(true);
    });

    it('should return false when driver reports connection is not reachable', async () => {
      mockStore.getConnection.mockReturnValue(makeConnection());
      mockGetDriver.mockReturnValue(makeMockDriver({ testResult: false }));

      const result = await testConnection('conn-1');
      expect(result).toBe(false);
    });
  });
});
