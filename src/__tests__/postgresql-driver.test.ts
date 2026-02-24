import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { PostgreSQLDriver } from '../drivers/postgresql.driver.js';
import type { ConnectionConfig } from '../types/index.js';

const mockConfig: ConnectionConfig = {
  id: 'test-pg-1',
  name: 'Test PG',
  type: 'postgresql',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'secret',
  database: 'testdb',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('PostgreSQLDriver', () => {
  let driver: PostgreSQLDriver;

  beforeEach(() => {
    driver = new PostgreSQLDriver();
  });

  describe('properties', () => {
    it('should have correct type', () => {
      expect(driver.type).toBe('postgresql');
    });

    it('should have correct displayName', () => {
      expect(driver.displayName).toBe('PostgreSQL');
    });

    it('should have correct defaultPort', () => {
      expect(driver.defaultPort).toBe(5432);
    });

    it('should have correct fileExtension', () => {
      expect(driver.fileExtension).toBe('.sql');
    });
  });

  describe('getBackupCommand', () => {
    it('should return a pg_dump command string', () => {
      const cmd = driver.getBackupCommand(mockConfig, '/tmp/backup.sql');
      expect(cmd).toContain('pg_dump');
      expect(cmd).toContain('--host=localhost');
      expect(cmd).toContain('--port=5432');
      expect(cmd).toContain('--username=postgres');
      expect(cmd).toContain('--no-password');
      expect(cmd).toContain('--format=plain');
      expect(cmd).toContain('testdb');
      expect(cmd).toContain('> /tmp/backup.sql');
    });

    it('should not expose password in the command', () => {
      const cmd = driver.getBackupCommand(mockConfig, '/tmp/backup.sql');
      expect(cmd).not.toContain('secret');
    });

    it('should include rowLimit warning when rowLimit is set', () => {
      const cmd = driver.getBackupCommand(mockConfig, '/tmp/backup.sql', { rowLimit: 100 });
      expect(cmd).toContain('AVISO');
      expect(cmd).toContain('rowLimit ignorado');
    });
  });

  describe('testConnection', () => {
    it('should return reachable false when pg_isready is not available', async () => {
      const result = await driver.testConnection(mockConfig);
      expect(result.reachable).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('backup', () => {
    it('should return a BackupResult with success false when pg_dump is not available', async () => {
      const result = await driver.backup(mockConfig, '/tmp/nonexistent-backup.sql');
      expect(result.success).toBe(false);
      expect(result.filepath).toBe('/tmp/nonexistent-backup.sql');
      expect(result.errorMessage).toBeDefined();
      expect(typeof result.duration).toBe('number');
    });

    it('should warn and continue when rowLimit is provided', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await driver.backup(mockConfig, '/tmp/nonexistent-backup.sql', { rowLimit: 50 });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('rowLimit=50 ignorado')
      );
      warnSpy.mockRestore();
    });
  });
});
