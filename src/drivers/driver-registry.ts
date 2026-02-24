import type { DatabaseDriver, DatabaseType } from '../types/index.js';
import { MySQLDriver } from './mysql.driver.js';
import { PostgreSQLDriver } from './postgresql.driver.js';

const drivers = new Map<DatabaseType, DatabaseDriver>();

function register(driver: DatabaseDriver): void {
  drivers.set(driver.type, driver);
}

export function getDriver(type: DatabaseType): DatabaseDriver {
  const driver = drivers.get(type);
  if (!driver) {
    throw new Error(`Driver não encontrado para o tipo: ${type}`);
  }
  return driver;
}

export function getSupportedTypes(): DatabaseType[] {
  return [...drivers.keys()];
}

export function getDriverOrNull(type: DatabaseType): DatabaseDriver | null {
  return drivers.get(type) ?? null;
}

// Registrar drivers disponíveis
register(new MySQLDriver());
register(new PostgreSQLDriver());
