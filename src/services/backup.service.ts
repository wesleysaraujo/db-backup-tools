import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getDriver } from '../drivers/driver-registry.js';
import { store } from '../store/index.js';
import { getStorageProvider } from './storage.service.js';
import type { BackupRecord, BackupOptions, RestoreResult, TestConnectionResult } from '../types/index.js';

function buildFilename(connectionName: string, database: string, extension: string, isPartial: boolean): string
{
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = connectionName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const partialSuffix = isPartial ? '_partial' : '';
  return `${safeName}_${database}_${timestamp}${partialSuffix}${extension}`;
}

export async function runBackup(connectionId: string, options?: BackupOptions): Promise<BackupRecord>
{
  const connection = store.getConnection(connectionId);
  if (!connection)
  {
    throw new Error(`conexão não encontrada: ${connectionId}`);
  }

  const driver = getDriver(connection.type);
  const storageProvider = getStorageProvider();

  const isPartial = !!options?.rowLimit;
  const filename = buildFilename(connection.name, connection.database, driver.fileExtension, isPartial);

  // Dump to a temporary file first
  const tempFilepath = path.join(os.tmpdir(), filename);
  console.log(`[BackupService] Iniciando rotina de backup para a conexão: ${connection.name} (${connectionId})`);

  const record: BackupRecord = {
    id: uuidv4(),
    connectionId: connection.id,
    connectionName: connection.name,
    databaseType: connection.type,
    database: connection.database,
    filename,
    filepath: tempFilepath, // Will be updated after upload
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

  // 1. Executa o backup criando o arquivo temporario
  console.log(`[BackupService] Executando driver de dump do banco para arquivo temporário: ${tempFilepath}`);
  const result = await driver.backup(connection, tempFilepath, options);

  let finalFilepath = tempFilepath;
  let finalStatus: BackupRecord['status'] = result.success ? 'completed' : 'failed';
  let errorMessage: string | null = result.errorMessage ?? null;

  // 2. Se o dump funcionou, faz upload para o Storage configurado
  if (result.success)
  {
    console.log(`[BackupService] Dump finalizado com sucesso. Enviando para Storage Provider...`);
    try
    {
      finalFilepath = await storageProvider.upload(tempFilepath, filename);
    } catch (uploadError: any)
    {
      finalStatus = 'failed';
      errorMessage = `Dump succeeded but upload failed: ${uploadError.message}`;
    }
  } else
  {
    // Se o dump falhou, tentamos remover o temporário
    if (fs.existsSync(tempFilepath))
    {
      try { await fs.promises.unlink(tempFilepath); } catch (e) { /* ignore */ }
    }
  }

  const updates: Partial<BackupRecord> = {
    status: finalStatus,
    filepath: finalFilepath,
    sizeBytes: result.sizeBytes,
    completedAt: new Date().toISOString(),
    duration: result.duration,
    errorMessage: errorMessage,
  };

  store.updateBackup(record.id, updates);

  return { ...record, ...updates };
}

export async function runRestore(backupId: string, targetConnectionId: string): Promise<RestoreResult>
{
  const backup = store.getBackup(backupId);
  if (!backup)
  {
    throw new Error(`Backup não encontrado: ${backupId}`);
  }

  if (backup.status !== 'completed')
  {
    throw new Error(`Backup não está completo (status: ${backup.status})`);
  }

  const connection = store.getConnection(targetConnectionId);
  if (!connection)
  {
    throw new Error(`conexão não encontrada: ${targetConnectionId}`);
  }

  if (connection.type !== backup.databaseType)
  {
    throw new Error(
      `Tipo incompativel: backup e ${backup.databaseType}, conexão e ${connection.type}. Restore cross-database não e permitido.`
    );
  }

  const storageProvider = getStorageProvider();
  const tempRestorePath = path.join(os.tmpdir(), backup.filename);

  try
  {
    // 1. Download do storage para o arquivo temporário local (se já não estiver)
    await storageProvider.downloadToTemp(backup.filepath, tempRestorePath);

    const driver = getDriver(connection.type);
    // 2. Roda o restore
    const result = await driver.restore(connection, tempRestorePath);

    return result;
  } finally
  {
    // 3. Remove o arquivo temporário
    if (fs.existsSync(tempRestorePath))
    {
      try { await fs.promises.unlink(tempRestorePath); } catch (e) { /* ignore */ }
    }
  }
}

export async function testConnection(connectionId: string): Promise<TestConnectionResult>
{
  const connection = store.getConnection(connectionId);
  if (!connection)
  {
    throw new Error(`conexão não encontrada: ${connectionId}`);
  }

  const driver = getDriver(connection.type);
  return driver.testConnection(connection);
}
