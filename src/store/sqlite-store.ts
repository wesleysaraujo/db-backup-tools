import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { encrypt, decrypt } from '../crypto.js';
import type { ConnectionConfig, BackupRecord, ScheduleConfig } from '../types/index.js';

const CREATE_CONNECTIONS = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  database_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREATE_BACKUPS = `
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  connection_name TEXT NOT NULL,
  database_type TEXT NOT NULL,
  database_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  size_bytes INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  is_partial INTEGER NOT NULL DEFAULT 0,
  row_limit INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration INTEGER
)`;

const CREATE_SCHEDULES = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL
)`;

interface ConnectionRow {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database_name: string;
  created_at: string;
  updated_at: string;
}

interface BackupRow {
  id: string;
  connection_id: string;
  connection_name: string;
  database_type: string;
  database_name: string;
  filename: string;
  filepath: string;
  size_bytes: number | null;
  status: string;
  error_message: string | null;
  is_partial: number;
  row_limit: number | null;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
}

interface ScheduleRow {
  id: string;
  connection_id: string;
  cron_expression: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

function rowToConnection(row: ConnectionRow, encryptionKey: string): ConnectionConfig {
  let password: string;
  try {
    password = decrypt(row.password, encryptionKey);
  } catch {
    password = row.password;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type as ConnectionConfig['type'],
    host: row.host,
    port: row.port,
    username: row.username,
    password,
    database: row.database_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBackup(row: BackupRow): BackupRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    databaseType: row.database_type as BackupRecord['databaseType'],
    database: row.database_name,
    filename: row.filename,
    filepath: row.filepath,
    sizeBytes: row.size_bytes,
    status: row.status as BackupRecord['status'],
    errorMessage: row.error_message,
    isPartial: row.is_partial === 1,
    rowLimit: row.row_limit,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    duration: row.duration,
  };
}

function rowToSchedule(row: ScheduleRow): ScheduleConfig {
  return {
    id: row.id,
    connectionId: row.connection_id,
    cronExpression: row.cron_expression,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

export class SqliteStore {
  private db: Database.Database;
  private encryptionKey: string;

  constructor(dbPath?: string, encryptionKey?: string) {
    const resolvedPath = dbPath || config.dbPath;
    this.encryptionKey = encryptionKey || config.encryptionKey;

    if (this.encryptionKey === 'db-backup-tool-dev-key-not-for-production') {
      console.warn('[WARN] ENCRYPTION_KEY not set. Using insecure fallback key. Do NOT use in production.');
    }

    if (resolvedPath !== ':memory:') {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();

    if (resolvedPath !== ':memory:') {
      this.migrateJsonToSqlite();
    }
  }

  private init(): void {
    this.db.exec(CREATE_CONNECTIONS);
    this.db.exec(CREATE_BACKUPS);
    this.db.exec(CREATE_SCHEDULES);
  }

  // === Migration ===
  migrateJsonToSqlite(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM connections').get() as { cnt: number }).cnt;
    if (count > 0) return;

    const jsonPath = path.join(config.dataDir, 'store.json');
    if (!fs.existsSync(jsonPath)) return;

    let data: { connections?: ConnectionConfig[]; backups?: BackupRecord[]; schedules?: ScheduleConfig[] };
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch {
      return;
    }

    const insertMany = this.db.transaction(() => {
      if (data.connections) {
        for (const c of data.connections) {
          this.addConnection(c);
        }
      }
      if (data.backups) {
        for (const b of data.backups) {
          this.addBackup(b);
        }
      }
      if (data.schedules) {
        for (const s of data.schedules) {
          this.addSchedule(s);
        }
      }
    });

    insertMany();
    console.log(`[INFO] Migrated data from ${jsonPath} to SQLite.`);
  }

  // === Connections ===
  getConnections(): ConnectionConfig[] {
    const rows = this.db.prepare('SELECT * FROM connections').all() as ConnectionRow[];
    return rows.map(r => rowToConnection(r, this.encryptionKey));
  }

  getConnection(id: string): ConnectionConfig | undefined {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow | undefined;
    return row ? rowToConnection(row, this.encryptionKey) : undefined;
  }

  addConnection(conn: ConnectionConfig): void {
    const encryptedPassword = encrypt(conn.password, this.encryptionKey);
    this.db.prepare(`
      INSERT INTO connections (id, name, type, host, port, username, password, database_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conn.id, conn.name, conn.type, conn.host, conn.port, conn.username, encryptedPassword, conn.database, conn.createdAt, conn.updatedAt);
  }

  updateConnection(id: string, updates: Partial<ConnectionConfig>): ConnectionConfig | undefined {
    const existing = this.getConnection(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const encryptedPassword = encrypt(merged.password, this.encryptionKey);

    this.db.prepare(`
      UPDATE connections SET name = ?, type = ?, host = ?, port = ?, username = ?, password = ?, database_name = ?, updated_at = ?
      WHERE id = ?
    `).run(merged.name, merged.type, merged.host, merged.port, merged.username, encryptedPassword, merged.database, merged.updatedAt, id);

    return this.getConnection(id);
  }

  deleteConnection(id: string): boolean {
    const result = this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Backups ===
  getBackups(connectionId?: string): BackupRecord[] {
    if (connectionId) {
      const rows = this.db.prepare('SELECT * FROM backups WHERE connection_id = ? ORDER BY started_at DESC').all(connectionId) as BackupRow[];
      return rows.map(rowToBackup);
    }
    const rows = this.db.prepare('SELECT * FROM backups ORDER BY started_at DESC').all() as BackupRow[];
    return rows.map(rowToBackup);
  }

  getBackup(id: string): BackupRecord | undefined {
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as BackupRow | undefined;
    return row ? rowToBackup(row) : undefined;
  }

  addBackup(backup: BackupRecord): void {
    this.db.prepare(`
      INSERT INTO backups (id, connection_id, connection_name, database_type, database_name, filename, filepath, size_bytes, status, error_message, is_partial, row_limit, started_at, completed_at, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      backup.id, backup.connectionId, backup.connectionName, backup.databaseType, backup.database,
      backup.filename, backup.filepath, backup.sizeBytes, backup.status, backup.errorMessage,
      backup.isPartial ? 1 : 0, backup.rowLimit, backup.startedAt, backup.completedAt, backup.duration
    );
  }

  updateBackup(id: string, updates: Partial<BackupRecord>): BackupRecord | undefined {
    const existing = this.getBackup(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...updates };
    this.db.prepare(`
      UPDATE backups SET connection_id = ?, connection_name = ?, database_type = ?, database_name = ?,
        filename = ?, filepath = ?, size_bytes = ?, status = ?, error_message = ?,
        is_partial = ?, row_limit = ?, started_at = ?, completed_at = ?, duration = ?
      WHERE id = ?
    `).run(
      merged.connectionId, merged.connectionName, merged.databaseType, merged.database,
      merged.filename, merged.filepath, merged.sizeBytes, merged.status, merged.errorMessage,
      merged.isPartial ? 1 : 0, merged.rowLimit, merged.startedAt, merged.completedAt, merged.duration, id
    );

    return this.getBackup(id);
  }

  // === Schedules ===
  getSchedules(connectionId?: string): ScheduleConfig[] {
    if (connectionId) {
      const rows = this.db.prepare('SELECT * FROM schedules WHERE connection_id = ?').all(connectionId) as ScheduleRow[];
      return rows.map(rowToSchedule);
    }
    const rows = this.db.prepare('SELECT * FROM schedules').all() as ScheduleRow[];
    return rows.map(rowToSchedule);
  }

  getSchedule(id: string): ScheduleConfig | undefined {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row ? rowToSchedule(row) : undefined;
  }

  addSchedule(schedule: ScheduleConfig): void {
    this.db.prepare(`
      INSERT INTO schedules (id, connection_id, cron_expression, enabled, last_run_at, next_run_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(schedule.id, schedule.connectionId, schedule.cronExpression, schedule.enabled ? 1 : 0, schedule.lastRunAt, schedule.nextRunAt, schedule.createdAt);
  }

  updateSchedule(id: string, updates: Partial<ScheduleConfig>): ScheduleConfig | undefined {
    const existing = this.getSchedule(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...updates };
    this.db.prepare(`
      UPDATE schedules SET connection_id = ?, cron_expression = ?, enabled = ?, last_run_at = ?, next_run_at = ?
      WHERE id = ?
    `).run(merged.connectionId, merged.cronExpression, merged.enabled ? 1 : 0, merged.lastRunAt, merged.nextRunAt, id);

    return this.getSchedule(id);
  }

  deleteSchedule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

export const store = new SqliteStore();
