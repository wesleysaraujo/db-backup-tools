import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store/index.js';
import { getSupportedTypes } from '../drivers/driver-registry.js';
import { runBackup, runRestore, testConnection } from '../services/backup.service.js';
import { validateCron } from '../services/scheduler.service.js';
import { startServer } from '../server.js';
import type { ConnectionConfig, ScheduleConfig } from '../types/index.js';

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

function printHelp(): void {
  console.log(`
DB Backup Tool - CLI

Uso:
  cli connections list                    Listar conexoes
  cli connections add                     Adicionar conexao (via args)
  cli connections test <id>               Testar conexao
  cli connections remove <id>             Remover conexao

  cli backup run <connectionId> [--limit <n>]  Executar backup (--limit para parcial)
  cli backup list [--connection <id>]         Listar backups
  cli backup download <backupId>          Info do backup para download
  cli backup restore <backupId> --confirm [--connection <id>]  Restaurar backup

  cli schedule add <connId> "<cron>"      Criar agendamento
  cli schedule list                       Listar agendamentos
  cli schedule toggle <id>                Ativar/desativar agendamento
  cli schedule remove <id>                Remover agendamento

  cli apikey generate                     Gerar API key e salvar no .env
  cli encryptionkey generate              Gerar ENCRYPTION_KEY e salvar no .env

  cli serve [--port 3777]                 Iniciar servidor API
  `);
}

function maskPassword(conn: ConnectionConfig): string {
  return `[${conn.id.substring(0, 8)}] ${conn.name} | ${conn.type}://${conn.username}:****@${conn.host}:${conn.port}/${conn.database}`;
}

async function handleConnections(): Promise<void> {
  switch (subcommand) {
    case 'list': {
      const connections = store.getConnections();
      if (connections.length === 0) {
        console.log('Nenhuma conexao cadastrada.');
        return;
      }
      for (const conn of connections) {
        console.log(maskPassword(conn));
      }
      break;
    }

    case 'add': {
      const name = args[2];
      const type = args[3];
      const host = args[4];
      const port = args[5];
      const username = args[6];
      const password = args[7];
      const database = args[8];

      if (!name || !type || !host || !port || !username || !password || !database) {
        console.log('Uso: cli connections add <name> <type> <host> <port> <username> <password> <database>');
        console.log(`Tipos suportados: ${getSupportedTypes().join(', ')}`);
        process.exit(1);
      }

      const supportedTypes = getSupportedTypes();
      if (!supportedTypes.includes(type as any)) {
        console.error(`Tipo nao suportado: ${type}. Disponiveis: ${supportedTypes.join(', ')}`);
        process.exit(1);
      }

      const now = new Date().toISOString();
      const connection: ConnectionConfig = {
        id: uuidv4(),
        name,
        type: type as ConnectionConfig['type'],
        host,
        port: parseInt(port, 10),
        username,
        password,
        database,
        createdAt: now,
        updatedAt: now,
      };

      store.addConnection(connection);
      console.log(`Conexao criada: ${connection.id}`);
      break;
    }

    case 'test': {
      const id = args[2];
      if (!id) {
        console.log('Uso: cli connections test <id>');
        process.exit(1);
      }
      try {
        const ok = await testConnection(id);
        console.log(ok ? 'Conexao OK' : 'Conexao falhou');
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
      break;
    }

    case 'remove': {
      const id = args[2];
      if (!id) {
        console.log('Uso: cli connections remove <id>');
        process.exit(1);
      }
      const deleted = store.deleteConnection(id);
      console.log(deleted ? 'Conexao removida' : 'Conexao nao encontrada');
      break;
    }

    default:
      console.log('Subcomandos: list, add, test, remove');
  }
}

async function handleBackup(): Promise<void> {
  switch (subcommand) {
    case 'run': {
      const connectionId = args[2];
      if (!connectionId) {
        console.log('Uso: cli backup run <connectionId> [--limit <n>]');
        process.exit(1);
      }

      const limitFlag = args.indexOf('--limit');
      const rowLimit = limitFlag !== -1 ? parseInt(args[limitFlag + 1]!, 10) : undefined;
      if (limitFlag !== -1 && (!rowLimit || isNaN(rowLimit) || rowLimit < 1)) {
        console.error('--limit deve ser um numero inteiro positivo');
        process.exit(1);
      }

      const options = rowLimit ? { rowLimit } : undefined;

      try {
        console.log(rowLimit ? `Executando backup parcial (limit: ${rowLimit} rows)...` : 'Executando backup...');
        const record = await runBackup(connectionId, options);
        console.log(`Backup ${record.status}: ${record.filename}`);
        if (record.sizeBytes) {
          console.log(`Tamanho: ${(record.sizeBytes / 1024).toFixed(1)} KB`);
        }
        if (record.duration) {
          console.log(`Duracao: ${record.duration}ms`);
        }
        if (record.errorMessage) {
          console.error(`Erro: ${record.errorMessage}`);
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
      break;
    }

    case 'list': {
      const connFlag = args.indexOf('--connection');
      const connectionId = connFlag !== -1 ? args[connFlag + 1] : undefined;
      const backups = store.getBackups(connectionId);
      if (backups.length === 0) {
        console.log('Nenhum backup encontrado.');
        return;
      }
      for (const b of backups) {
        const size = b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} KB` : '-';
        console.log(`[${b.id.substring(0, 8)}] ${b.status.padEnd(9)} | ${b.filename} | ${size} | ${b.startedAt}`);
      }
      break;
    }

    case 'download': {
      const backupId = args[2];
      if (!backupId) {
        console.log('Uso: cli backup download <backupId>');
        process.exit(1);
      }
      const backup = store.getBackup(backupId);
      if (!backup) {
        console.error('Backup nao encontrado');
        process.exit(1);
      }
      console.log(`Arquivo: ${backup.filepath}`);
      console.log(`Filename: ${backup.filename}`);
      break;
    }

    case 'restore': {
      const backupId = args[2];
      const connFlag = args.indexOf('--connection');
      const targetConnectionId = connFlag !== -1 ? args[connFlag + 1] : undefined;

      if (!backupId || !targetConnectionId) {
        console.log('Uso: cli backup restore <backupId> --confirm --connection <targetId>');
        process.exit(1);
      }

      if (!args.includes('--confirm')) {
        console.error('ATENCAO: Restore e uma operacao destrutiva que sobrescreve dados no banco.');
        console.error('Adicione --confirm para confirmar a operacao.');
        process.exit(1);
      }

      try {
        console.log('Executando restore...');
        const result = await runRestore(backupId, targetConnectionId);
        if (result.success) {
          console.log(`Restore concluido com sucesso em ${result.duration}ms`);
        } else {
          console.error(`Restore falhou: ${result.errorMessage}`);
          process.exit(1);
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
      break;
    }

    default:
      console.log('Subcomandos: run, list, download, restore');
  }
}

function handleSchedule(): void {
  switch (subcommand) {
    case 'add': {
      const connectionId = args[2];
      const cronExpr = args[3];

      if (!connectionId || !cronExpr) {
        console.log('Uso: cli schedule add <connectionId> "<cron>"');
        process.exit(1);
      }

      const connection = store.getConnection(connectionId);
      if (!connection) {
        console.error('Conexao nao encontrada');
        process.exit(1);
      }

      if (!validateCron(cronExpr)) {
        console.error('Expressao cron invalida');
        process.exit(1);
      }

      const schedule: ScheduleConfig = {
        id: uuidv4(),
        connectionId,
        cronExpression: cronExpr,
        enabled: true,
        lastRunAt: null,
        nextRunAt: null,
        createdAt: new Date().toISOString(),
      };

      store.addSchedule(schedule);
      console.log(`Agendamento criado: ${schedule.id}`);
      break;
    }

    case 'list': {
      const schedules = store.getSchedules();
      if (schedules.length === 0) {
        console.log('Nenhum agendamento cadastrado.');
        return;
      }
      for (const s of schedules) {
        const status = s.enabled ? 'ativo' : 'inativo';
        console.log(`[${s.id.substring(0, 8)}] ${status.padEnd(7)} | ${s.cronExpression} | conn: ${s.connectionId.substring(0, 8)}`);
      }
      break;
    }

    case 'toggle': {
      const id = args[2];
      if (!id) {
        console.log('Uso: cli schedule toggle <id>');
        process.exit(1);
      }
      const schedule = store.getSchedule(id);
      if (!schedule) {
        console.error('Agendamento nao encontrado');
        process.exit(1);
      }
      const updated = store.updateSchedule(id, { enabled: !schedule.enabled });
      console.log(`Agendamento ${updated?.enabled ? 'ativado' : 'desativado'}`);
      break;
    }

    case 'remove': {
      const id = args[2];
      if (!id) {
        console.log('Uso: cli schedule remove <id>');
        process.exit(1);
      }
      const deleted = store.deleteSchedule(id);
      console.log(deleted ? 'Agendamento removido' : 'Agendamento nao encontrado');
      break;
    }

    default:
      console.log('Subcomandos: add, list, toggle, remove');
  }
}

function setEnvVar(varName: string, value: string): string {
  const envPath = path.join(process.cwd(), '.env');
  const pattern = new RegExp(`^${varName}=.*$`, 'm');

  if (existsSync(envPath)) {
    let content = readFileSync(envPath, 'utf-8');
    if (pattern.test(content)) {
      content = content.replace(pattern, `${varName}=${value}`);
    } else {
      content = content.trimEnd() + `\n${varName}=${value}\n`;
    }
    writeFileSync(envPath, content);
  } else {
    writeFileSync(envPath, `${varName}=${value}\n`);
  }

  return envPath;
}

function handleApiKey(): void {
  if (subcommand !== 'generate') {
    console.log('Subcomandos: generate');
    return;
  }

  const key = randomBytes(32).toString('hex');
  const envPath = setEnvVar('API_KEY', key);

  console.log(`API Key gerada: ${key}`);
  console.log(`Salva em ${envPath}`);
  console.log('Reinicie o servidor para aplicar.');
}

function handleEncryptionKey(): void {
  if (subcommand !== 'generate') {
    console.log('Subcomandos: generate');
    return;
  }

  const envPath = path.join(process.cwd(), '.env');
  const insecureValues = ['', 'your-secret-encryption-key-here', 'db-backup-tool-dev-key-not-for-production'];

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^ENCRYPTION_KEY=(.*)$/m);
    if (match && !insecureValues.includes(match[1]!.trim())) {
      console.log('ENCRYPTION_KEY segura ja configurada. Nenhuma alteracao feita.');
      return;
    }
  }

  const key = randomBytes(32).toString('hex');
  setEnvVar('ENCRYPTION_KEY', key);

  console.log(`ENCRYPTION_KEY gerada: ${key}`);
  console.log(`Salva em ${envPath}`);
  console.log('Reinicie o servidor para aplicar.');
}

function handleServe(): void {
  const portFlag = args.indexOf('--port');
  const port = portFlag !== -1 ? parseInt(args[portFlag + 1]!, 10) : undefined;
  startServer(port);
}

async function main(): Promise<void> {
  switch (command) {
    case 'connections':
      await handleConnections();
      break;
    case 'backup':
      await handleBackup();
      break;
    case 'schedule':
      handleSchedule();
      break;
    case 'apikey':
      handleApiKey();
      break;
    case 'encryptionkey':
      handleEncryptionKey();
      break;
    case 'serve':
      handleServe();
      break;
    default:
      printHelp();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
