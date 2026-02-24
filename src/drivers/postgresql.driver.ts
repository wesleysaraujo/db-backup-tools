import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import type { DatabaseDriver, ConnectionConfig, BackupResult, BackupOptions, RestoreResult, TestConnectionResult } from '../types/index.js';

const execFileAsync = promisify(execFile);

export class PostgreSQLDriver implements DatabaseDriver {
  readonly type = 'postgresql' as const;
  readonly displayName = 'PostgreSQL';
  readonly defaultPort = 5432;
  readonly fileExtension = '.sql';

  async testConnection(config: ConnectionConfig): Promise<TestConnectionResult> {
    try {
      const { stdout } = await execFileAsync('pg_isready', [
        '-h', config.host,
        '-p', String(config.port),
        '-U', config.username,
        '-d', config.database,
      ], { timeout: 10000, env: { ...process.env, PGPASSWORD: config.password } });

      if (stdout.includes('accepting connections')) {
        return { reachable: true };
      }
      return { reachable: false, error: 'pg_isready did not confirm accepting connections' };
    } catch (err: any) {
      const msg = err?.stderr || err?.message || 'Unknown error';
      return { reachable: false, error: msg };
    }
  }

  getBackupCommand(config: ConnectionConfig, outputPath: string, options?: BackupOptions): string {
    const parts = [
      'pg_dump',
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--username=${config.username}`,
      '--no-password',
      '--format=plain',
      config.database,
      `> ${outputPath}`,
    ];

    if (options?.rowLimit) {
      parts.unshift('# AVISO: rowLimit ignorado — pg_dump não suporta limite de linhas nativo');
    }

    return parts.join(' ');
  }

  async backup(config: ConnectionConfig, outputPath: string, options?: BackupOptions): Promise<BackupResult> {
    const startTime = Date.now();

    if (options?.rowLimit) {
      console.warn(`[PostgreSQLDriver] rowLimit=${options.rowLimit} ignorado — pg_dump não suporta limite de linhas nativo. Executando dump completo.`);
    }

    try {
      await this.execDump(config, outputPath);

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
        errorMessage: error?.message || 'Unknown error during PostgreSQL backup',
      };
    }
  }

  getRestoreCommand(config: ConnectionConfig, inputPath: string): string {
    return [
      'psql',
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--username=${config.username}`,
      '--no-password',
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
        errorMessage: error?.message || 'Unknown error during PostgreSQL restore',
      };
    }
  }

  private execRestore(config: ConnectionConfig, inputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        `--host=${config.host}`,
        `--port=${config.port}`,
        `--username=${config.username}`,
        '--no-password',
        config.database,
      ];

      const inputStream = fs.createReadStream(inputPath);
      const proc = spawn('psql', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: config.password },
      });
      const stderrChunks: Buffer[] = [];

      inputStream.pipe(proc.stdin);
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('psql restore timeout (10min)'));
      }, 600000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString().trim();
          reject(new Error(stderr || `psql exited with code ${code}`));
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

  private execDump(config: ConnectionConfig, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        `--host=${config.host}`,
        `--port=${config.port}`,
        `--username=${config.username}`,
        '--no-password',
        '--format=plain',
        config.database,
      ];

      const proc = spawn('pg_dump', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: config.password },
      });

      const outStream = fs.createWriteStream(outputPath, { flags: 'w' });
      const stderrChunks: Buffer[] = [];

      proc.stdout.pipe(outStream);
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('pg_dump timeout (10min)'));
      }, 600000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        outStream.end();

        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString().trim();
          reject(new Error(stderr || `pg_dump exited with code ${code}`));
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
