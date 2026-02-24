import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getDriver } from '../drivers/driver-registry.js';
import { store } from '../store/index.js';
import type { BackupRecord, BackupOptions, RestoreResult, TestConnectionResult } from '../types/index.js';

function ensureBackupDir(): void {
  if (!fs.existsSync(config.backupDir)) {
    fs.mkdirSync(config.backupDir, { recursive: true });
  }
}

function buildFilename(connectionName: string, database: string, extension: string, isPartial: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = connectionName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const partialSuffix = isPartial ? '_partial' : '';
  return `${safeName}_${database}_${timestamp}${partialSuffix}${extension}`;
}

export async function runBackup(connectionId: string, options?: BackupOptions): Promise<BackupRecord> {
  const connection = store.getConnection(connectionId);
  if (!connection) {
    throw new Error(`conexão não encontrada: ${connectionId}`);
  }

  const driver = getDriver(connection.type);
  ensureBackupDir();

  const isPartial = !!options?.rowLimit;
  const filename = buildFilename(connection.name, connection.database, driver.fileExtension, isPartial);
  const filepath = path.join(config.backupDir, filename);

  const record: BackupRecord = {
    id: uuidv4(),
    connectionId: connection.id,
    connectionName: connection.name,
    databaseType: connection.type,
    database: connection.database,
    filename,
    filepath,
    sizeBytes: null,
    status: 'running',
    errorMessage: null,
    isPartial,
    rowLimit: options?.rowLimit ?? null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    duration: null,
  };

  store.addBackup(record);

  const result = await driver.backup(connection, filepath, options);

  const updates: Partial<BackupRecord> = {
    status: result.success ? 'completed' : 'failed',
    sizeBytes: result.sizeBytes,
    completedAt: new Date().toISOString(),
    duration: result.duration,
    errorMessage: result.errorMessage ?? null,
  };

  store.updateBackup(record.id, updates);

  return { ...record, ...updates };
}

export async function runRestore(backupId: string, targetConnectionId: string): Promise<RestoreResult> {
  const backup = store.getBackup(backupId);
  if (!backup) {
    throw new Error(`Backup não encontrado: ${backupId}`);
  }

  if (backup.status !== 'completed') {
    throw new Error(`Backup não está completo (status: ${backup.status})`);
  }

  if (!fs.existsSync(backup.filepath)) {
    throw new Error(`Arquivo de backup não encontrado no disco: ${backup.filepath}`);
  }

  const connection = store.getConnection(targetConnectionId);
  if (!connection) {
    throw new Error(`conexão não encontrada: ${targetConnectionId}`);
  }

  if (connection.type !== backup.databaseType) {
    throw new Error(
      `Tipo incompativel: backup e ${backup.databaseType}, conexão e ${connection.type}. Restore cross-database não e permitido.`
    );
  }

  const driver = getDriver(connection.type);
  return driver.restore(connection, backup.filepath);
}

export async function testConnection(connectionId: string): Promise<TestConnectionResult> {
  const connection = store.getConnection(connectionId);
  if (!connection) {
    throw new Error(`conexão não encontrada: ${connectionId}`);
  }

  const driver = getDriver(connection.type);
  return driver.testConnection(connection);
}
