import { inspectBackupIsolated } from './backup-task';
import type { DailyRule } from '../domain/work-policy';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { DomainError, transition, validatePeriod } from '../domain/journey';
import { clockNow } from '../shared/time';
import type { AuditEntry, Command, Health, Period, Report, WorkSession } from '../shared/contracts';
import type { JourneyPersistence } from './persistence';

import { sqliteSchema, referenceSchema } from './sqlite-schema';
import { writeSnapshot } from './sqlite-backup';
import { activateSqlite } from './sqlite-files';

type Row = Record<string, unknown>;


/** No SQL Server imports, credentials or automatic conversion of existing files. */
export class SqliteJourneyRepository implements JourneyPersistence {
  private db: DatabaseSync;
  private maintenance = false;
  constructor(path: string, private actor = `${process.env.USERDOMAIN ?? 'local'}\\${userInfo().username}`) {
    const fresh = !existsSync(path);
    if (fresh) {
      mkdirSync(dirname(path), { recursive: true });
      closeSync(openSync(path, 'wx', 0o600));
    }
    this.db = new DatabaseSync(path);
    try {
      if (fresh) {
        this.db.exec('BEGIN IMMEDIATE');
        try { this.db.exec(sqliteSchema); this.db.exec('COMMIT'); }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
      if (version !== 1) throw new DomainError('DATABASE_NOT_READY', 'Versão do banco local incompatível. Preserve o arquivo e utilize uma versão compatível do JourneyHub.');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(write: boolean, work: () => T): T {
    this.assertAvailable();
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original failure if SQLite already rolled back. */ }
      throw error;
    }
  }
  private session(row: Row): WorkSession {
    const breaks = this.db.prepare('SELECT * FROM Breaks WHERE SessionId=? ORDER BY Position').all(String(row.Id));
    return {
      id: String(row.Id), workDate: String(row.WorkDate), startedAt: String(row.StartedAt),
      endedAt: row.EndedAt as string | null, notes: String(row.Notes), version: Number(row.Version), deletedAt: row.DeletedAt as string | null,
      breaks: breaks.map(b => ({ id: String(b.Id), startedAt: String(b.StartedAt), endedAt: b.EndedAt as string | null, reason: String(b.Reason) })),
    };
  }
  private audits(rows: Row[]): AuditEntry[] {
    return rows.map(row => ({ id: String(row.Id), sessionId: String(row.SessionId), action: String(row.Action), reason: String(row.Reason), actor: String(row.Actor), recordedAt: String(row.RecordedAt), before: row.BeforeJson ? JSON.parse(String(row.BeforeJson)) : null, after: JSON.parse(String(row.AfterJson)) }));
  }
  async health(): Promise<Health> {
    this.assertAvailable();
    this.db.prepare('SELECT 1').get();
    return { connected: true, ready: true, message: 'Banco local conectado e pronto.', checkedAt: clockNow(), provider: 'sqlite' };
  }
  async rules() {
    return this.transaction(false, () => {
      if (!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='DailyReference'").get()) return [];
      return this.db.prepare('SELECT EffectiveDate, Minutes FROM DailyReference ORDER BY EffectiveDate DESC').all()
        .map(row => ({ from: String(row.EffectiveDate), minutes: Number(row.Minutes) }));
    });
  }
  async saveRule(rule: DailyRule) {
    this.transaction(true, () => {
      this.db.exec(referenceSchema);
      this.db.prepare(`INSERT INTO DailyReference VALUES (?, ?) ON CONFLICT(EffectiveDate)
        DO UPDATE SET Minutes=excluded.Minutes`).run(rule.from, rule.minutes);
    });
  }
  async list(period: Period): Promise<WorkSession[]> { return (await this.report(period, false)).sessions; }
  async report(period: Period, audits = true): Promise<Report> {
    validatePeriod(period);
    return this.transaction(false, () => ({
      sessions: this.db.prepare('SELECT * FROM WorkSessions WHERE DeletedAt IS NULL AND WorkDate BETWEEN ? AND ? ORDER BY StartedAt DESC').all(period.from, period.to).map(row => this.session(row)),
      audits: audits ? this.audits(this.db.prepare(`SELECT a.* FROM AuditLog a JOIN WorkSessions s ON s.Id=a.SessionId WHERE s.DeletedAt IS NULL AND s.WorkDate BETWEEN ? AND ? ORDER BY a.RecordedAt, json_extract(a.AfterJson,'$.version'), a.Id`).all(period.from, period.to)) : [],
    }));
  }
  async current(): Promise<WorkSession | null> {
    return this.transaction(false, () => {
      const row = this.db.prepare('SELECT * FROM WorkSessions WHERE EndedAt IS NULL AND DeletedAt IS NULL').get();
      return row ? this.session(row) : null;
    });
  }
  async trash(): Promise<WorkSession[]> {
    return this.transaction(false, () => this.db.prepare('SELECT * FROM WorkSessions WHERE DeletedAt IS NOT NULL ORDER BY DeletedAt DESC, Id').all().map(row => this.session(row)));
  }
  async audit(id: string): Promise<AuditEntry[]> {
    this.assertAvailable();
    return this.audits(this.db.prepare(`SELECT * FROM AuditLog WHERE SessionId=? ORDER BY RecordedAt, json_extract(AfterJson,'$.version'), Id`).all(id));
  }
  async mutate(command: Command): Promise<WorkSession> {
    return this.transaction(true, () => {
      const row = command.type !== 'start' && command.type !== 'create' ? this.db.prepare('SELECT * FROM WorkSessions WHERE Id=?').get(command.id) : undefined;
      const before = row ? this.session(row) : null;
      const now = clockNow();
      const after = transition(before, command, now, randomUUID);
      const overlap = !after.deletedAt && this.db.prepare(`SELECT Id FROM WorkSessions WHERE DeletedAt IS NULL AND Id<>? AND (WorkDate=? OR ((? IS NULL OR StartedAt<?) AND (EndedAt IS NULL OR EndedAt>?))) LIMIT 1`).get(after.id, after.workDate, after.endedAt, after.endedAt, after.startedAt);
      if (overlap) throw new DomainError('OVERLAP', 'Já existe uma jornada nessa data ou nesse intervalo. Edite a existente; encerre a jornada aberta antes de iniciar outra.');
      if (before) {
        this.db.prepare('UPDATE WorkSessions SET WorkDate=?, StartedAt=?, EndedAt=?, Notes=?, Version=?, DeletedAt=? WHERE Id=?').run(after.workDate, after.startedAt, after.endedAt, after.notes, after.version, after.deletedAt ?? null, after.id);
        this.db.prepare('DELETE FROM Breaks WHERE SessionId=?').run(after.id);
      } else {
        this.db.prepare('INSERT INTO WorkSessions(Id,WorkDate,StartedAt,EndedAt,Notes,Version,DeletedAt) VALUES (?,?,?,?,?,?,?)').run(after.id, after.workDate, after.startedAt, after.endedAt, after.notes, after.version, after.deletedAt ?? null);
      }
      const insertBreak = this.db.prepare('INSERT INTO Breaks(Id,SessionId,Position,StartedAt,EndedAt,Reason) VALUES (?,?,?,?,?,?)');
      for (const [position, pause] of after.breaks.entries()) insertBreak.run(pause.id, after.id, position, pause.startedAt, pause.endedAt, pause.reason);
      const reason = command.type === 'edit' || command.type === 'create' || command.type === 'pause' ? command.reason : ({ start: 'Entrada manual', resume: 'Retorno manual', finish: 'Encerramento manual', delete: 'Enviada à lixeira após dupla confirmação', restore: 'Restaurada da lixeira' } as const)[command.type];
      this.db.prepare('INSERT INTO AuditLog(Id,SessionId,Action,Reason,Actor,RecordedAt,BeforeJson,AfterJson) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), after.id, command.type, reason, this.actor, now, before ? JSON.stringify(before) : null, JSON.stringify(after));
      return after;
    });
  }
  async close(): Promise<void> { this.db.close(); }

  private assertAvailable(): void {
    if (this.maintenance) throw new DomainError('STORAGE_BUSY', 'Aguarde a conclusão do backup ou da restauração antes de continuar.');
  }

  async createBackup(destination: string): Promise<void> {
    this.assertAvailable();
    this.maintenance = true;
    try { await writeSnapshot(this.db, destination, inspectBackupIsolated); }
    finally { this.maintenance = false; }
  }

  async restoreBackup(candidate: string, profile: string): Promise<string> {
    this.assertAvailable();
    this.maintenance = true;
    let replacement: DatabaseSync | undefined;
    try {
      await inspectBackupIsolated(candidate);
      const directory = join(profile, 'backups');
      mkdirSync(directory, { recursive: true });
      const recovery = join(directory, `before-restore-${randomUUID()}.sqlite`);
      await writeSnapshot(this.db, recovery, inspectBackupIsolated);
      replacement = new DatabaseSync(candidate);
      replacement.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      // No await between persistent pointer activation and the live connection switch.
      activateSqlite(profile, basename(candidate));
      const previous = this.db;
      this.db = replacement;
      replacement = undefined;
      try { previous.close(); } catch { /* Both complete generations and the recovery snapshot remain available. */ }
      return recovery;
    } finally {
      replacement?.close();
      this.maintenance = false;
    }
  }
}
