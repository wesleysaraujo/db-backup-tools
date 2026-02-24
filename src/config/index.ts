import path from 'node:path';

const DEFAULT_FALLBACK_KEY = 'db-backup-tool-dev-key-not-for-production';

export const config = {
  port: parseInt(process.env['PORT'] || '3777', 10),
  backupDir: process.env['BACKUP_DIR'] || path.join(process.cwd(), 'backups'),
  dataDir: process.env['DATA_DIR'] || path.join(process.cwd(), 'data'),
  dbPath: process.env['DATA_DIR']
    ? path.join(process.env['DATA_DIR'], 'db-backup-tool.db')
    : path.join(process.cwd(), 'data', 'db-backup-tool.db'),
  encryptionKey: process.env['ENCRYPTION_KEY'] || DEFAULT_FALLBACK_KEY,
  apiKey: process.env['API_KEY'] || '',
} as const;
