import { describe, it, expect } from '@jest/globals';
import { getDriver, getSupportedTypes, getDriverOrNull } from '../drivers/driver-registry.js';
import { MySQLDriver } from '../drivers/mysql.driver.js';
import { PostgreSQLDriver } from '../drivers/postgresql.driver.js';
import type { DatabaseType } from '../types/index.js';

describe('driver-registry', () => {
  describe('getSupportedTypes', () => {
    it('should return an array containing mysql and postgresql', () => {
      const types = getSupportedTypes();
      expect(types).toContain('mysql');
      expect(types).toContain('postgresql');
    });

    it('should return an array of strings', () => {
      const types = getSupportedTypes();
      expect(Array.isArray(types)).toBe(true);
      types.forEach(t => expect(typeof t).toBe('string'));
    });
  });

  describe('getDriver', () => {
    it('should return a MySQLDriver instance for mysql type', () => {
      const driver = getDriver('mysql');
      expect(driver).toBeInstanceOf(MySQLDriver);
    });

    it('should return a driver with correct properties', () => {
      const driver = getDriver('mysql');
      expect(driver.type).toBe('mysql');
      expect(driver.displayName).toBe('MySQL');
      expect(driver.defaultPort).toBe(3306);
      expect(driver.fileExtension).toBe('.sql');
    });

    it('should return a PostgreSQLDriver instance for postgresql type', () => {
      const driver = getDriver('postgresql');
      expect(driver).toBeInstanceOf(PostgreSQLDriver);
    });

    it('should return a postgresql driver with correct properties', () => {
      const driver = getDriver('postgresql');
      expect(driver.type).toBe('postgresql');
      expect(driver.displayName).toBe('PostgreSQL');
      expect(driver.defaultPort).toBe(5432);
      expect(driver.fileExtension).toBe('.sql');
    });

    it('should throw an error for completely unknown type', () => {
      expect(() => getDriver('oracle' as DatabaseType)).toThrow();
    });
  });

  describe('getDriverOrNull', () => {
    it('should return the driver for a supported type', () => {
      const driver = getDriverOrNull('mysql');
      expect(driver).not.toBeNull();
      expect(driver!.type).toBe('mysql');
    });

    it('should return the driver for postgresql type', () => {
      const driver = getDriverOrNull('postgresql');
      expect(driver).not.toBeNull();
      expect(driver!.type).toBe('postgresql');
    });

    it('should return null for an unsupported type', () => {
      const driver = getDriverOrNull('oracle' as DatabaseType);
      expect(driver).toBeNull();
    });
  });
});
