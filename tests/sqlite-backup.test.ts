import { runBackupTask } from '../src/main/backup-task';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteJourneyRepository } from '../src/main/sqlite-repository';
import { inspectBackup, prepareRestore } from '../src/main/sqlite-backup';
import { activeSqlitePath } from '../src/main/sqlite-files';
import { selectStorage, saveSelection } from '../src/main/storage-selection';
import { at } from './fixtures';

describe('backup e restauração SQLite reais', () => {
  let profile: string;
  let repo: SqliteJourneyRepository;
  beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'journeyhub-backup-'));
    repo = new SqliteJourneyRepository(join(profile, 'journey.sqlite'), 'Backup test');
    await saveSelection(profile, { version: 1, provider: 'sqlite' });
  });
  afterEach(async () => { await repo.close(); await rm(profile, { recursive: true, force: true }); });

  async function startPaused() {
    const start = await repo.mutate({ type: 'start', at: at('09:00') });
    return repo.mutate({ type: 'pause', id: start.id, version: start.version, at: at('12:00'), reason: 'jantar' });
  }
  it('encerra validação que excede o prazo e preserva banco ativo', async () => {
    const session = await startPaused();
    const saved = join(profile, 'timeout.sqlite');
    await repo.createBackup(saved);
    await expect(runBackupTask('inspect', saved, undefined, 1)).rejects.toMatchObject({ code: 'BACKUP_LIMIT' });
    expect(await repo.current()).toEqual(session);
    expect(activeSqlitePath(profile)).toBe(join(profile, 'journey.sqlite'));
    const staged = await prepareRestore(saved, profile);
    expect(staged.summary.open).toBe(1);
  });
  it('recusa diretórios antes de iniciar a validação', async () => {
    await expect(runBackupTask('inspect', profile)).rejects.toMatchObject({ code: 'BACKUP_LIMIT' });
  });
  it('inclui WAL e restaura jornada aberta, histórico administrativo e lixeira', async () => {
    let session = await startPaused();
    session = await repo.mutate({ type: 'finish', id: session.id, version: session.version, at: at('18:00') });
    session = await repo.mutate({ type: 'edit', id: session.id, version: session.version, reason: 'Correção', value: { startedAt: session.startedAt, endedAt: session.endedAt, notes: 'observação preservada', breaks: session.breaks } });
    session = await repo.mutate({ type: 'delete', id: session.id, version: session.version });
    const open = await repo.mutate({ type: 'start', at: at('09:00', '2026-10-21') });
    const originalAudit = await repo.audit(session.id);
    const destination = join(profile, 'saved.sqlite');
    await repo.createBackup(destination);
    expect(inspectBackup(destination)).toEqual({ sessions: 1, trash: 1, open: 1, audits: 6 });
    const stopped = await repo.mutate({ type: 'finish', id: open.id, version: open.version, at: at('18:00', '2026-10-21') });
    const staged = await prepareRestore(destination, profile);
    const recovery = await repo.restoreBackup(staged.path, profile);
    expect(await repo.current()).toEqual(open);
    expect(await repo.trash()).toEqual([session]);
    expect(await repo.audit(session.id)).toEqual(originalAudit);
    const savedBefore = new SqliteJourneyRepository(recovery);
    try { expect(await savedBefore.current()).toBeNull(); expect((await savedBefore.list({ from: stopped.workDate, to: stopped.workDate }))[0]).toEqual(stopped); }
    finally { await savedBefore.close(); }
    await repo.close(); repo = new SqliteJourneyRepository(activeSqlitePath(profile));
    expect(await repo.current()).toEqual(open);
    expect((await selectStorage(profile)).selection.provider).toBe('sqlite');
  });
  it('não sobrescreve destino existente nem muda a jornada se backup falha', async () => {
    const session = await startPaused();
    const destination = join(profile, 'existing.sqlite'); await writeFile(destination, 'preservar');
    await expect(repo.createBackup(destination)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(destination, 'utf8')).toBe('preservar');
    expect(await repo.current()).toEqual(session);
  });
  it('rejeita arquivo corrompido ou banco alheio sem trocar o banco atual', async () => {
    const session = await startPaused();
    const corrupt = join(profile, 'invalid.sqlite'); await writeFile(corrupt, 'not a database');
    await expect(prepareRestore(corrupt, profile)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    const foreign = join(profile, 'other.sqlite'); const db = new DatabaseSync(foreign);
    db.exec('PRAGMA user_version=1; CREATE TABLE Unrelated(Value TEXT)'); db.close();
    await expect(prepareRestore(foreign, profile)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await repo.current()).toEqual(session);
    expect(activeSqlitePath(profile)).toBe(join(profile, 'journey.sqlite'));
  });
  it('recusa schema futuro, trigger inesperado e horários inconsistentes', async () => {
    await startPaused();
    for (const change of ['PRAGMA user_version=2', "CREATE TRIGGER Unexpected AFTER INSERT ON Breaks BEGIN SELECT 1; END", "UPDATE Breaks SET StartedAt='2000-01-01T00:00:00Z'", "UPDATE WorkSessions SET Notes='diverge da auditoria'"]) {
      const destination = join(profile, `invalid-${Math.random()}.sqlite`);
      await repo.createBackup(destination);
      const db = new DatabaseSync(destination); db.exec(change); db.close();
      expect(() => inspectBackup(destination)).toThrow(/compatível/);
    }
  });
  it('falha na ativação preserva banco ativo e cópia prévia', async () => {
    const session = await startPaused();
    const saved = join(profile, 'saved.sqlite'); await repo.createBackup(saved);
    const staged = await prepareRestore(saved, profile);
    await mkdir(join(profile, 'sqlite-active-v1.json'));
    await expect(repo.restoreBackup(staged.path, profile)).rejects.toBeDefined();
    expect(await repo.current()).toEqual(session);
    expect((await readdir(join(profile, 'backups'))).filter(name => name.endsWith('.sqlite'))).toHaveLength(1);
  });
  it('bloqueia comandos concorrentes durante o snapshot e os libera ao terminar', async () => {
    const session = await startPaused();
    const work = repo.createBackup(join(profile, 'busy.sqlite'));
    await expect(repo.mutate({ type: 'resume', id: session.id, version: session.version, at: at('13:00') })).rejects.toMatchObject({ code: 'STORAGE_BUSY' });
    await work;
    expect(await repo.current()).toEqual(session);
  });
  it('ignora uma cópia preparada se houver interrupção antes de sua ativação', async () => {
    const session = await startPaused();
    const saved = join(profile, 'saved.sqlite'); await repo.createBackup(saved);
    await prepareRestore(saved, profile);
    const finished = await repo.mutate({ type: 'finish', id: session.id, version: session.version, at: at('18:00') });
    await repo.close(); repo = new SqliteJourneyRepository(activeSqlitePath(profile));
    expect(await repo.current()).toBeNull();
    expect((await repo.list({ from: finished.workDate, to: finished.workDate }))[0]).toEqual(finished);
  });
});
