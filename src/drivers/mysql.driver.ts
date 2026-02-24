import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import type { DatabaseDriver, ConnectionConfig, BackupResult, BackupOptions, RestoreResult } from '../types/index.js';

const execFileAsync = promisify(execFile);

export class MySQLDriver implements DatabaseDriver {
  readonly type = 'mysql' as const;
  readonly displayName = 'MySQL';
  readonly defaultPort = 3306;
  readonly fileExtension = '.sql';

  async testConnection(config: ConnectionConfig): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('mysqladmin', [
        `-h${config.host}`,
        `-P${config.port}`,
        `-u${config.username}`,
        `--password=${config.password}`,
        'ping',
      ], { timeout: 10000 });

      return stdout.includes('alive');
    } catch {
      return false;
    }
  }

  getBackupCommand(config: ConnectionConfig, outputPath: string, options?: BackupOptions): string {
    const parts = [
      'mysqldump',
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.username}`,
      `--password=****`,
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      '--set-gtid-purged=OFF',
      '--no-tablespaces',
      '--column-statistics=0',
      '--force',
    ];

    if (options?.rowLimit) {
      parts.push(`--where='1 ORDER BY id DESC LIMIT ${options.rowLimit}'`);
      parts.push('(tabelas com id; tabelas sem id usam LIMIT sem ORDER BY)');
    }

    parts.push(config.database, `> ${outputPath}`);
    return parts.join(' ');
  }

  async backup(config: ConnectionConfig, outputPath: string, options?: BackupOptions): Promise<BackupResult> {
    const startTime = Date.now();

    try {
      await this.spawnDump(config, outputPath, options);

      const stats = fs.statSync(outputPath);
      const duration = Date.now() - startTime;

      if (stats.size === 0) {
        return {
          success: false,
          filepath: outputPath,
          sizeBytes: 0,
          duration,
          errorMessage: 'Backup gerou arquivo vazio',
        };
      }

      return {
        success: true,
        filepath: outputPath,
        sizeBytes: stats.size,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        filepath: outputPath,
        sizeBytes: 0,
        duration,
        errorMessage: error?.message || 'Unknown error during MySQL backup',
      };
    }
  }

  getRestoreCommand(config: ConnectionConfig, inputPath: string): string {
    return [
      'mysql',
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.username}`,
      `--password=****`,
      config.database,
      `< ${inputPath}`,
    ].join(' ');
  }

  async restore(config: ConnectionConfig, inputPath: string): Promise<RestoreResult> {
    const startTime = Date.now();

    try {
      await this.execRestore(config, inputPath);
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        duration: Date.now() - startTime,
        errorMessage: error?.message || 'Unknown error during MySQL restore',
      };
    }
  }

  private execRestore(config: ConnectionConfig, inputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        `--host=${config.host}`,
        `--port=${config.port}`,
        `--user=${config.username}`,
        `--password=${config.password}`,
        config.database,
      ];

      const inputStream = fs.createReadStream(inputPath);
      const proc = spawn('mysql', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stderrChunks: Buffer[] = [];

      inputStream.pipe(proc.stdin);
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('mysql restore timeout (10min)'));
      }, 600000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString().trim();
          reject(new Error(stderr || `mysql exited with code ${code}`));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      inputStream.on('error', (err) => {
        clearTimeout(timer);
        proc.kill('SIGTERM');
        reject(err);
      });
    });
  }

  private async spawnDump(config: ConnectionConfig, outputPath: string, options?: BackupOptions): Promise<void> {
    if (!options?.rowLimit) {
      return this.execDump(config, outputPath, [config.database], false);
    }

    const allTables = await this.queryTables(config);
    const tablesWithId = await this.queryTablesWithIdColumn(config);
    const tablesWithoutId = allTables.filter(t => !tablesWithId.has(t));

    let firstRun = true;

    if (tablesWithId.size > 0) {
      await this.execDump(config, outputPath, [
        '--where', `1 ORDER BY id DESC LIMIT ${options.rowLimit}`,
        config.database, ...tablesWithId,
      ], false);
      firstRun = false;
    }

    if (tablesWithoutId.length > 0) {
      await this.execDump(config, outputPath, [
        '--where', `1 LIMIT ${options.rowLimit}`,
        '--skip-routines',
        '--skip-triggers',
        '--skip-events',
        config.database, ...tablesWithoutId,
      ], !firstRun);
    }
  }

  private async queryTables(config: ConnectionConfig): Promise<string[]> {
    const { stdout } = await execFileAsync('mysql', [
      `-h${config.host}`,
      `-P${config.port}`,
      `-u${config.username}`,
      `--password=${config.password}`,
      '-N', '-e',
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${config.database}' AND TABLE_TYPE = 'BASE TABLE'`,
    ], { timeout: 15000 });

    return stdout.trim().split('\n').filter(Boolean);
  }

  private async queryTablesWithIdColumn(config: ConnectionConfig): Promise<Set<string>> {
    const { stdout } = await execFileAsync('mysql', [
      `-h${config.host}`,
      `-P${config.port}`,
      `-u${config.username}`,
      `--password=${config.password}`,
      '-N', '-e',
      `SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${config.database}' AND COLUMN_NAME = 'id'`,
    ], { timeout: 15000 });

    return new Set(stdout.trim().split('\n').filter(Boolean));
  }

  private baseArgs(config: ConnectionConfig): string[] {
    return [
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.username}`,
      `--password=${config.password}`,
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      '--set-gtid-purged=OFF',
      '--no-tablespaces',
      '--column-statistics=0',
      '--force',
    ];
  }

  private execDump(config: ConnectionConfig, outputPath: string, extraArgs: string[], append: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [...this.baseArgs(config), ...extraArgs];

      const proc = spawn('mysqldump', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const outStream = fs.createWriteStream(outputPath, { flags: append ? 'a' : 'w' });
      const stderrChunks: Buffer[] = [];

      proc.stdout.pipe(outStream);
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('mysqldump timeout (10min)'));
      }, 600000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        outStream.end();

        const stderr = Buffer.concat(stderrChunks).toString();
        const hasRealError = stderr.split('\n').some(
          (line) => line.includes('[ERROR]') && !line.includes('1109')
        );

        if (code !== 0 && hasRealError) {
          reject(new Error(stderr.trim()));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
