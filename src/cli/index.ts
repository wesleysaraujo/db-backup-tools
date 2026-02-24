import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store/index.js';
import { getSupportedTypes } from '../drivers/driver-registry.js';
import { runBackup, runRestore, testConnection } from '../services/backup.service.js';
import { validateCron } from '../services/scheduler.service.js';
import { startServer } from '../server.js';
import type { ConnectionConfig, ScheduleConfig } from '../types/index.js';

function printHelp(interactive: boolean = false): void {
  const prefix = interactive ? '' : 'cli ';
  console.log(`
DB Backup Tool - CLI

Uso:
  ${prefix}connections list                    Listar conexões
  ${prefix}connections add                     Adicionar conexão (via args)
  ${prefix}connections test <id>               Testar conexão
  ${prefix}connections remove <id>             Remover conexão

  ${prefix}backup run <connectionId> [--limit <n>]  Executar backup (--limit para parcial)
  ${prefix}backup list [--connection <id>]         Listar backups
  ${prefix}backup download <backupId>          Info do backup para download
  ${prefix}backup restore <backupId> --confirm [--connection <id>]  Restaurar backup

  ${prefix}schedule add <connId> "<cron>"      Criar agendamento
  ${prefix}schedule list                       Listar agendamentos
  ${prefix}schedule toggle <id>                Ativar/desativar agendamento
  ${prefix}schedule remove <id>                Remover agendamento

  ${prefix}apikey generate                     Gerar API key e salvar no .env
  ${prefix}encryptionkey generate              Gerar ENCRYPTION_KEY e salvar no .env

  ${prefix}serve [--port 3777]                 Iniciar servidor API
  `);
}

function maskPassword(conn: ConnectionConfig): string {
  return `[${conn.id}] ${conn.name} | ${conn.type}://${conn.username}:****@${conn.host}:${conn.port}/${conn.database}`;
}

async function handleConnections(inputArgs: string[]): Promise<void> {
  const subcommand = inputArgs[1];

  switch (subcommand) {
    case 'list': {
      const connections = store.getConnections();
      if (connections.length === 0) {
        console.log('Nenhuma conexão cadastrada.');
        return;
      }
      for (const conn of connections) {
        console.log(maskPassword(conn));
      }
      break;
    }

    case 'add': {
      const name = inputArgs[2];
      const type = inputArgs[3];
      const host = inputArgs[4];
      const port = inputArgs[5];
      const username = inputArgs[6];
      const password = inputArgs[7];
      const database = inputArgs[8];

      if (!name || !type || !host || !port || !username || !password || !database) {
        console.error('Uso: connections add <name> <type> <host> <port> <username> <password> <database>');
        console.log(`Tipos suportados: ${getSupportedTypes().join(', ')}`);
        return;
      }

      const supportedTypes = getSupportedTypes();
      if (!supportedTypes.includes(type as any)) {
        console.error(`Tipo não suportado: ${type}. Disponiveis: ${supportedTypes.join(', ')}`);
        return;
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
      console.log(`conexão criada: ${connection.id}`);
      break;
    }

    case 'test': {
      const id = inputArgs[2];
      if (!id) {
        console.error('Uso: connections test <id>');
        return;
      }
      const result = await testConnection(id);
      if (result.reachable) {
        console.log('conexão OK');
      } else {
        console.error(`conexão falhou: ${result.error || 'motivo desconhecido'}`);
      }
      break;
    }

    case 'remove': {
      const id = inputArgs[2];
      if (!id) {
        console.error('Uso: connections remove <id>');
        return;
      }
      const deleted = store.deleteConnection(id);
      console.log(deleted ? 'conexão removida' : 'conexão não encontrada');
      break;
    }

    default:
      console.log('Subcomandos: list, add, test, remove');
  }
}

async function handleBackup(inputArgs: string[]): Promise<void> {
  const subcommand = inputArgs[1];

  switch (subcommand) {
    case 'run': {
      const connectionId = inputArgs[2];
      if (!connectionId) {
        console.error('Uso: backup run <connectionId> [--limit <n>]');
        return;
      }

      const limitFlag = inputArgs.indexOf('--limit');
      const rowLimit = limitFlag !== -1 ? parseInt(inputArgs[limitFlag + 1]!, 10) : undefined;
      if (limitFlag !== -1 && (!rowLimit || isNaN(rowLimit) || rowLimit < 1)) {
        console.error('--limit deve ser um numero inteiro positivo');
        return;
      }

      const options = rowLimit ? { rowLimit } : undefined;

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
      break;
    }

    case 'list': {
      const connFlag = inputArgs.indexOf('--connection');
      const connectionId = connFlag !== -1 ? inputArgs[connFlag + 1] : undefined;
      const backups = store.getBackups(connectionId);
      if (backups.length === 0) {
        console.log('Nenhum backup encontrado.');
        return;
      }
      for (const b of backups) {
        const size = b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} KB` : '-';
        console.log(`[${b.id}] ${b.status.padEnd(9)} | ${b.filename} | ${size} | ${b.startedAt}`);
      }
      break;
    }

    case 'download': {
      const backupId = inputArgs[2];
      if (!backupId) {
        console.error('Uso: backup download <backupId>');
        return;
      }
      const backup = store.getBackup(backupId);
      if (!backup) {
        console.error('Backup não encontrado');
        return;
      }
      console.log(`Arquivo: ${backup.filepath}`);
      console.log(`Filename: ${backup.filename}`);
      break;
    }

    case 'restore': {
      const backupId = inputArgs[2];
      const connFlag = inputArgs.indexOf('--connection');
      const targetConnectionId = connFlag !== -1 ? inputArgs[connFlag + 1] : undefined;

      if (!backupId || !targetConnectionId) {
        console.error('Uso: backup restore <backupId> --confirm --connection <targetId>');
        return;
      }

      if (!inputArgs.includes('--confirm')) {
        console.error('ATENCAO: Restore e uma operacao destrutiva que sobrescreve dados no banco.');
        console.error('Adicione --confirm para confirmar a operacao.');
        return;
      }

      console.log('Executando restore...');
      const result = await runRestore(backupId, targetConnectionId);
      if (result.success) {
        console.log(`Restore concluido com sucesso em ${result.duration}ms`);
      } else {
        console.error(`Restore falhou: ${result.errorMessage}`);
      }
      break;
    }

    default:
      console.log('Subcomandos: run, list, download, restore');
  }
}

function handleSchedule(inputArgs: string[]): void {
  const subcommand = inputArgs[1];

  switch (subcommand) {
    case 'add': {
      const connectionId = inputArgs[2];
      const cronExpr = inputArgs[3];

      if (!connectionId || !cronExpr) {
        console.error('Uso: schedule add <connectionId> "<cron>"');
        return;
      }

      const connection = store.getConnection(connectionId);
      if (!connection) {
        console.error('conexão não encontrada');
        return;
      }

      if (!validateCron(cronExpr)) {
        console.error('Expressao cron invalida');
        return;
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
        console.log(`[${s.id}] ${status.padEnd(7)} | ${s.cronExpression} | conn: ${s.connectionId}`);
      }
      break;
    }

    case 'toggle': {
      const id = inputArgs[2];
      if (!id) {
        console.error('Uso: schedule toggle <id>');
        return;
      }
      const schedule = store.getSchedule(id);
      if (!schedule) {
        console.error('Agendamento não encontrado');
        return;
      }
      const updated = store.updateSchedule(id, { enabled: !schedule.enabled });
      console.log(`Agendamento ${updated?.enabled ? 'ativado' : 'desativado'}`);
      break;
    }

    case 'remove': {
      const id = inputArgs[2];
      if (!id) {
        console.error('Uso: schedule remove <id>');
        return;
      }
      const deleted = store.deleteSchedule(id);
      console.log(deleted ? 'Agendamento removido' : 'Agendamento não encontrado');
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

function handleApiKey(inputArgs: string[]): void {
  const subcommand = inputArgs[1];
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

function handleEncryptionKey(inputArgs: string[]): void {
  const subcommand = inputArgs[1];
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

function handleServe(inputArgs: string[]): void {
  const portFlag = inputArgs.indexOf('--port');
  const port = portFlag !== -1 ? parseInt(inputArgs[portFlag + 1]!, 10) : undefined;
  startServer(port);
}

async function executeCommand(inputArgs: string[]): Promise<void> {
  const command = inputArgs[0];

  switch (command) {
    case 'connections':
      await handleConnections(inputArgs);
      break;
    case 'backup':
      await handleBackup(inputArgs);
      break;
    case 'schedule':
      handleSchedule(inputArgs);
      break;
    case 'apikey':
      handleApiKey(inputArgs);
      break;
    case 'encryptionkey':
      handleEncryptionKey(inputArgs);
      break;
    case 'serve':
      handleServe(inputArgs);
      break;
    case 'help':
      printHelp(true);
      break;
    default:
      printHelp(false);
  }
}

async function startInteractive(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('DB Backup Tool - Modo interativo');
  console.log('Digite "help" para ver comandos, "exit" para sair.\n');

  while (true) {
    const line = await rl.question('db-backup> ');
    const parts = line.trim().split(/\s+/);

    if (!parts[0] || parts[0] === '') continue;
    if (parts[0] === 'exit' || parts[0] === 'quit') {
      console.log('Ate logo!');
      rl.close();
      break;
    }

    try {
      await executeCommand(parts);
    } catch (err: any) {
      console.error(err.message);
    }
  }
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);

  if (cliArgs.length === 0 || cliArgs[0] === '--interactive') {
    await startInteractive();
  } else {
    try {
      await executeCommand(cliArgs);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
