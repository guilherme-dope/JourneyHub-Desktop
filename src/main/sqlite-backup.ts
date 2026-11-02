import { runBackupTask } from './backup-task';
import { validDate } from '../shared/time';
import { minutesSchema } from '../domain/work-policy';
import { DatabaseSync, backup } from 'node:sqlite';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sqliteSchema, referenceSchema } from './sqlite-schema';
import { DomainError, validateSession } from '../domain/journey';
import { dateSchema, instantSchema, sessionInputSchema } from '../shared/contracts';

const snapshotSchema = sessionInputSchema.extend({ id: z.string().uuid(), workDate: dateSchema, version: z.number().int().positive(), deletedAt: instantSchema.nullable().optional() }).strict();
export interface BackupSummary { sessions: number; trash: number; audits: number; open: number }

function schemaDescription(db: DatabaseSync): string {
  return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row => ({ ...row, sql: String(row.sql).replace(/\s+/g, ' ').trim() })));
}
const reference = new DatabaseSync(':memory:');
reference.exec(sqliteSchema);
const expectedSchema = schemaDescription(reference);
reference.exec(referenceSchema);
const extendedSchema = schemaDescription(reference);
reference.close();

function validateSnapshot(value: unknown) {
  const session = snapshotSchema.parse(value);
  // Validation preserves recorded instants even if the computer clock moved backwards.
  validateSession(session, '9999-12-31T23:59:59Z');
  return session;
}

export function inspectBackup(path: string): BackupSummary {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA trusted_schema=OFF;');
    if (db.prepare('PRAGMA user_version').get()!.user_version !== 1 || ![expectedSchema, extendedSchema].includes(schemaDescription(db))) throw Error('Unsupported schema');
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='DailyReference'").get()) {
      for (const row of db.prepare('SELECT EffectiveDate, Minutes FROM DailyReference').all()) {
        if (!validDate(String(row.EffectiveDate))) throw Error('Invalid reference date');
        minutesSchema.parse(row.Minutes);
      }
    }
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Invalid integrity');
    const sessions = db.prepare('SELECT * FROM WorkSessions').all();
    const active = sessions.filter(row => row.DeletedAt === null).sort((a, b) => Date.parse(String(a.StartedAt)) - Date.parse(String(b.StartedAt)));
    for (let index = 1; index < active.length; index++) {
      const previous = active[index - 1];
      if (previous.EndedAt === null || Date.parse(String(previous.EndedAt)) > Date.parse(String(active[index].StartedAt))) throw Error('Overlapping sessions');
    }
    for (const row of sessions) {
      const pauses = db.prepare('SELECT * FROM Breaks WHERE SessionId=? ORDER BY Position').all(row.Id!);
      if (pauses.some((pause, index) => pause.Position !== index)) throw Error('Invalid pause ordering');
      const session = validateSnapshot({ id: row.Id, workDate: row.WorkDate, startedAt: row.StartedAt, endedAt: row.EndedAt, notes: row.Notes, version: row.Version, deletedAt: row.DeletedAt,
        breaks: pauses.map(pause => ({ id: pause.Id, startedAt: pause.StartedAt, endedAt: pause.EndedAt, reason: pause.Reason })) });
      const audits = db.prepare('SELECT * FROM AuditLog WHERE SessionId=?').all(session.id);
      if (audits.length !== session.version) throw Error('Missing audit');
      const versions = new Set<number>();
      for (const audit of audits) {
        z.string().uuid().parse(audit.Id);
        instantSchema.parse(audit.RecordedAt);
        const after = validateSnapshot(JSON.parse(String(audit.AfterJson)));
        const before = audit.BeforeJson ? validateSnapshot(JSON.parse(String(audit.BeforeJson))) : null;
        if (after.id !== session.id || after.version > session.version || (before && before.id !== session.id)) throw Error('Invalid audit association');
        if (versions.has(after.version) || (before ? before.version + 1 !== after.version : after.version !== 1)) throw Error('Invalid audit version');
        versions.add(after.version);
        if (after.version === session.version && !isDeepStrictEqual({ ...after, deletedAt: after.deletedAt ?? null }, session)) throw Error('Audit does not match current state');
      }
    }
    return { sessions: sessions.filter(row => row.DeletedAt === null).length, trash: sessions.filter(row => row.DeletedAt !== null).length,
      open: sessions.filter(row => row.EndedAt === null && row.DeletedAt === null).length, audits: Number(db.prepare('SELECT count(*) AS Total FROM AuditLog').get()!.Total) };
  } catch {
    throw new DomainError('BACKUP_INVALID', 'O arquivo não é um backup SQLite compatível e íntegro do JourneyHub. Escolha outro arquivo.');
  } finally { db?.close(); }
}

/** Uses SQLite's online backup API, including committed data still in the WAL. */
export async function writeSnapshot(source: DatabaseSync, destination: string, validate: (path: string) => BackupSummary | Promise<BackupSummary> = inspectBackup): Promise<void> {
  const file = await open(destination, 'wx', 0o600);
  await file.close();
  try {
    await backup(source, destination);
    await validate(destination);
    const completed = await open(destination, 'r+');
    try { await completed.sync(); } finally { await completed.close(); }
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}

export async function prepareRestoreLocally(source: string, profile: string): Promise<{ path: string; summary: BackupSummary }> {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    db.exec('PRAGMA trusted_schema=OFF;');
    const path = profile;
    await writeSnapshot(db, path);
    return { path, summary: inspectBackup(path) };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('BACKUP_INVALID', 'Não foi possível ler e validar o backup. Confira o arquivo e as permissões.');
  } finally { db?.close(); }
}

export async function prepareRestore(source: string, profile: string): Promise<{ path: string; summary: BackupSummary }> {
  const path = join(profile, `restored-${randomUUID()}.sqlite`);
  try {
    return await runBackupTask('restore', source, path) as { path: string; summary: BackupSummary };
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}
