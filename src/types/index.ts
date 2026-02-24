// ============================================
// DB Backup Tool - Core Types
// Strategy Pattern for multi-database support
// ============================================

export type DatabaseType = 'mysql' | 'postgresql' | 'mongodb'; // extensible

export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupOptions {
  rowLimit?: number | undefined;
}

export interface BackupRecord {
  id: string;
  connectionId: string;
  connectionName: string;
  databaseType: DatabaseType;
  database: string;
  filename: string;
  filepath: string;
  sizeBytes: number | null;
  status: BackupStatus;
  errorMessage: string | null;
  isPartial: boolean;
  rowLimit: number | null;
  startedAt: string;
  completedAt: string | null;
  duration: number | null; // ms
}

export interface ScheduleConfig {
  id: string;
  connectionId: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

// ============================================
// Strategy Pattern Interface
// Each database driver must implement this
// ============================================
export interface DatabaseDriver {
  readonly type: DatabaseType;
  readonly displayName: string;
  readonly defaultPort: number;
  readonly fileExtension: string;

  /** Test if connection is reachable */
  testConnection(config: ConnectionConfig): Promise<TestConnectionResult>;

  /** Execute a backup, return the output filepath */
  backup(config: ConnectionConfig, outputPath: string, options?: BackupOptions): Promise<BackupResult>;

  /** Get the CLI command needed (for display/debug) */
  getBackupCommand(config: ConnectionConfig, outputPath: string, options?: BackupOptions): string;

  /** Restore a database from a backup file */
  restore(config: ConnectionConfig, inputPath: string): Promise<RestoreResult>;

  /** Get the CLI command for restore (for display/debug, password masked) */
  getRestoreCommand(config: ConnectionConfig, inputPath: string): string;
}

export interface TestConnectionResult {
  reachable: boolean;
  error?: string;
}

export interface BackupResult {
  success: boolean;
  filepath: string;
  sizeBytes: number;
  duration: number; // ms
  errorMessage?: string;
}

export interface RestoreResult {
  success: boolean;
  duration: number; // ms
  errorMessage?: string;
}

// ============================================
// API DTOs
// ============================================
export interface CreateConnectionDTO {
  name: string;
  type: DatabaseType;
  host: string;
  port?: number;
  username: string;
  password: string;
  database: string;
}

export interface CreateScheduleDTO {
  connectionId: string;
  cronExpression: string;
  enabled?: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
