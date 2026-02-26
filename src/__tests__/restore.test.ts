import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MySQLDriver } from '../drivers/mysql.driver.js';
import { PostgreSQLDriver } from '../drivers/postgresql.driver.js';
import type { ConnectionConfig, BackupRecord, DatabaseDriver, RestoreResult } from '../types/index.js';

// === Driver unit tests (no mocks needed) ===

const mockMysqlConfig: ConnectionConfig = {
  id: 'test-mysql-1',
  name: 'Test MySQL',
  type: 'mysql',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: 'supersecret',
  database: 'testdb',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockPgConfig: ConnectionConfig = {
  id: 'test-pg-1',
  name: 'Test PG',
  type: 'postgresql',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'supersecret',
  database: 'testdb',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('MySQLDriver - restore commands', () => {
  const driver = new MySQLDriver();

  it('getRestoreCommand should return a mysql command string', () => {
    const cmd = driver.getRestoreCommand(mockMysqlConfig, '/tmp/backup.sql');
    expect(cmd).toContain('mysql');
    expect(cmd).toContain('--host=localhost');
    expect(cmd).toContain('--port=3306');
    expect(cmd).toContain('--user=root');
    expect(cmd).toContain('testdb');
    expect(cmd).toContain('< /tmp/backup.sql');
  });

  it('getRestoreCommand should mask password', () => {
    const cmd = driver.getRestoreCommand(mockMysqlConfig, '/tmp/backup.sql');
    expect(cmd).not.toContain('supersecret');
    expect(cmd).toContain('--password=****');
  });
});

describe('PostgreSQLDriver - restore commands', () => {
  const driver = new PostgreSQLDriver();

  it('getRestoreCommand should return a psql command string', () => {
    const cmd = driver.getRestoreCommand(mockPgConfig, '/tmp/backup.sql');
    expect(cmd).toContain('psql');
    expect(cmd).toContain('--host=localhost');
    expect(cmd).toContain('--port=5432');
    expect(cmd).toContain('--username=postgres');
    expect(cmd).toContain('--no-password');
    expect(cmd).toContain('testdb');
    expect(cmd).toContain('< /tmp/backup.sql');
  });

  it('getRestoreCommand should not expose password', () => {
    const cmd = driver.getRestoreCommand(mockPgConfig, '/tmp/backup.sql');
    expect(cmd).not.toContain('supersecret');
  });
});

// === Service tests (with mocks) ===

const mockGetDriver = jest.fn<(type: string) => DatabaseDriver>();
const mockStore = {
  getConnection: jest.fn<(id: string) => ConnectionConfig | undefined>(),
  getBackup: jest.fn<(id: string) => BackupRecord | undefined>(),
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
    storage: {
      provider: 'local' as const,
      s3: {
        region: 'us-east-1',
        accessKeyId: '',
        secretAccessKey: '',
        bucket: '',
        endpoint: undefined,
      },
    },
  },
}));

const mockDownloadToTemp = jest.fn<(filepath: string, tempPath: string) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../services/storage.service.js', () => ({
  getStorageProvider: () => ({
    upload: jest.fn().mockResolvedValue('/tmp/uploaded.sql'),
    delete: jest.fn().mockResolvedValue(true),
    getDownloadStream: jest.fn(),
    downloadToTemp: mockDownloadToTemp,
  }),
}));

const originalFs = await import('node:fs');
jest.unstable_mockModule('node:fs', () => ({
  default: {
    ...originalFs.default,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
  },
}));

const fs = (await import('node:fs')).default;
const { runRestore } = await import('../services/backup.service.js');

function makeBackupRecord(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    id: 'backup-1',
    connectionId: 'conn-1',
    connectionName: 'Test DB',
    databaseType: 'mysql',
    database: 'testdb',
    filename: 'test_backup.sql',
    filepath: '/tmp/test_backup.sql',
    sizeBytes: 2048,
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

function makeMockDriver(restoreResult?: RestoreResult): DatabaseDriver {
  return {
    type: 'mysql',
    displayName: 'MySQL',
    defaultPort: 3306,
    fileExtension: '.sql',
    testConnection: jest.fn<any>().mockResolvedValue({ reachable: true }),
    backup: jest.fn<any>().mockResolvedValue({ success: true, filepath: '/tmp/b.sql', sizeBytes: 1024, duration: 100 }),
    getBackupCommand: jest.fn<any>().mockReturnValue('mysqldump ...'),
    restore: jest.fn<(config: ConnectionConfig, inputPath: string) => Promise<RestoreResult>>()
      .mockResolvedValue(restoreResult ?? { success: true, duration: 200 }),
    getRestoreCommand: jest.fn<any>().mockReturnValue('mysql ...'),
  };
}

describe('runRestore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it('should throw when backup is not found', async () => {
    mockStore.getBackup.mockReturnValue(undefined);
    await expect(runRestore('non-existent', 'conn-1')).rejects.toThrow('Backup não encontrado');
  });

  it('should throw when backup status is not completed', async () => {
    mockStore.getBackup.mockReturnValue(makeBackupRecord({ status: 'failed' }));
    await expect(runRestore('backup-1', 'conn-1')).rejects.toThrow('Backup não está completo');
  });

  it('should throw when storage download fails', async () => {
    mockStore.getBackup.mockReturnValue(makeBackupRecord());
    mockStore.getConnection.mockReturnValue(makeConnection());
    mockGetDriver.mockReturnValue(makeMockDriver());
    mockDownloadToTemp.mockRejectedValueOnce(new Error('Arquivo não encontrado no disco: /tmp/test_backup.sql'));
    await expect(runRestore('backup-1', 'conn-1')).rejects.toThrow('Arquivo não encontrado no disco');
  });

  it('should throw when connection is not found', async () => {
    mockStore.getBackup.mockReturnValue(makeBackupRecord());
    mockStore.getConnection.mockReturnValue(undefined);
    await expect(runRestore('backup-1', 'conn-1')).rejects.toThrow('conexão não encontrada');
  });

  it('should throw when database types are incompatible', async () => {
    mockStore.getBackup.mockReturnValue(makeBackupRecord({ databaseType: 'mysql' }));
    mockStore.getConnection.mockReturnValue(makeConnection({ type: 'postgresql' }));
    await expect(runRestore('backup-1', 'conn-1')).rejects.toThrow('Tipo incompativel');
  });

  it('should execute restore successfully', async () => {
    const backup = makeBackupRecord();
    const conn = makeConnection();
    const driver = makeMockDriver({ success: true, duration: 300 });

    mockStore.getBackup.mockReturnValue(backup);
    mockStore.getConnection.mockReturnValue(conn);
    mockGetDriver.mockReturnValue(driver);

    const result = await runRestore('backup-1', 'conn-1');

    expect(result.success).toBe(true);
    expect(result.duration).toBe(300);
    expect(driver.restore).toHaveBeenCalledWith(conn, expect.stringContaining(backup.filename));
    expect(mockDownloadToTemp).toHaveBeenCalledWith(backup.filepath, expect.stringContaining(backup.filename));
  });

  it('should use targetConnectionId when provided', async () => {
    const backup = makeBackupRecord({ connectionId: 'conn-1' });
    const targetConn = makeConnection({ id: 'conn-2', name: 'Target DB' });
    const driver = makeMockDriver();

    mockStore.getBackup.mockReturnValue(backup);
    mockStore.getConnection.mockReturnValue(targetConn);
    mockGetDriver.mockReturnValue(driver);

    await runRestore('backup-1', 'conn-2');

    expect(mockStore.getConnection).toHaveBeenCalledWith('conn-2');
    expect(driver.restore).toHaveBeenCalledWith(targetConn, expect.stringContaining(backup.filename));
  });

  it('should return failed result when driver restore fails', async () => {
    const backup = makeBackupRecord();
    const conn = makeConnection();
    const driver = makeMockDriver({ success: false, duration: 50, errorMessage: 'mysql error' });

    mockStore.getBackup.mockReturnValue(backup);
    mockStore.getConnection.mockReturnValue(conn);
    mockGetDriver.mockReturnValue(driver);

    const result = await runRestore('backup-1', 'conn-1');

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('mysql error');
  });
});
