import fs from 'node:fs';
import path from 'node:path';
import type { ConnectionConfig, BackupRecord, ScheduleConfig } from '../types/index.js';

interface StoreData {
  connections: ConnectionConfig[];
  backups: BackupRecord[];
  schedules: ScheduleConfig[];
}

function createDefaultData(): StoreData {
  return { connections: [], backups: [], schedules: [] };
}

export class JsonStore {
  private data: StoreData;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'store.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this.filePath)) {
        this.save(createDefaultData());
        return { ...createDefaultData() };
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as StoreData;
    } catch {
      return { ...createDefaultData() };
    }
  }

  private save(data?: StoreData): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data || this.data, null, 2));
  }

  private persist(): void {
    this.save();
  }

  // === Connections ===
  getConnections(): ConnectionConfig[] {
    return this.data.connections;
  }

  getConnection(id: string): ConnectionConfig | undefined {
    return this.data.connections.find(c => c.id === id);
  }

  addConnection(conn: ConnectionConfig): void {
    this.data.connections.push(conn);
    this.persist();
  }

  updateConnection(id: string, updates: Partial<ConnectionConfig>): ConnectionConfig | undefined {
    const idx = this.data.connections.findIndex(c => c.id === id);
    if (idx === -1) return undefined;
    Object.assign(this.data.connections[idx]!, updates, { updatedAt: new Date().toISOString() });
    this.persist();
    return this.data.connections[idx]!;
  }

  deleteConnection(id: string): boolean {
    const len = this.data.connections.length;
    this.data.connections = this.data.connections.filter(c => c.id !== id);
    if (this.data.connections.length < len) {
      this.persist();
      return true;
    }
    return false;
  }

  // === Backups ===
  getBackups(connectionId?: string): BackupRecord[] {
    const backups = connectionId
      ? this.data.backups.filter(b => b.connectionId === connectionId)
      : this.data.backups;
    return backups.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  getBackup(id: string): BackupRecord | undefined {
    return this.data.backups.find(b => b.id === id);
  }

  addBackup(backup: BackupRecord): void {
    this.data.backups.push(backup);
    this.persist();
  }

  updateBackup(id: string, updates: Partial<BackupRecord>): BackupRecord | undefined {
    const idx = this.data.backups.findIndex(b => b.id === id);
    if (idx === -1) return undefined;
    Object.assign(this.data.backups[idx]!, updates);
    this.persist();
    return this.data.backups[idx]!;
  }

  deleteBackup(id: string): boolean {
    const len = this.data.backups.length;
    this.data.backups = this.data.backups.filter(b => b.id !== id);
    if (this.data.backups.length < len) {
      this.persist();
      return true;
    }
    return false;
  }

  // === Schedules ===
  getSchedules(connectionId?: string): ScheduleConfig[] {
    return connectionId
      ? this.data.schedules.filter(s => s.connectionId === connectionId)
      : this.data.schedules;
  }

  getSchedule(id: string): ScheduleConfig | undefined {
    return this.data.schedules.find(s => s.id === id);
  }

  addSchedule(schedule: ScheduleConfig): void {
    this.data.schedules.push(schedule);
    this.persist();
  }

  updateSchedule(id: string, updates: Partial<ScheduleConfig>): ScheduleConfig | undefined {
    const idx = this.data.schedules.findIndex(s => s.id === id);
    if (idx === -1) return undefined;
    Object.assign(this.data.schedules[idx]!, updates);
    this.persist();
    return this.data.schedules[idx]!;
  }

  deleteSchedule(id: string): boolean {
    const len = this.data.schedules.length;
    this.data.schedules = this.data.schedules.filter(s => s.id !== id);
    if (this.data.schedules.length < len) {
      this.persist();
      return true;
    }
    return false;
  }
}

// Singleton removed — use SqliteStore via store/index.ts
