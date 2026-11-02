import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteJourneyRepository } from '../src/main/sqlite-repository';
import { at, fixture } from './fixtures';
import { operationalTimeline } from '../src/domain/timeline';
import type { WorkSession } from '../src/shared/contracts';

function input(session: WorkSession = fixture()) {
  return { startedAt: session.startedAt, endedAt: session.endedAt!, notes: session.notes, breaks: session.breaks };
}

describe('SQLite real — persistência e compatibilidade operacional', () => {
  let directory: string;
  let path: string;
  let repo: SqliteJourneyRepository;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'journeyhub-'));
    path = join(directory, 'data.sqlite');
    repo = new SqliteJourneyRepository(path, 'Vitest');
  });
  afterEach(async () => { await repo.close(); await rm(directory, { recursive: true, force: true }); });

  it('grava pausa sem descrição usando rótulo neutro compatível', async () => {
    const session = fixture(); session.breaks[0].reason = '   ';
    const saved = await repo.mutate({ type: 'create', value: input(session), reason: 'Teste' });
    expect(saved.breaks[0].reason).toBe('Pausa');
    expect((await repo.list({ from: saved.workDate, to: saved.workDate }))[0].breaks[0].reason).toBe('Pausa');
  });
  it('preserva jornadas, auditoria e referência após backup e reabertura', async () => {
    const s = await repo.mutate({ type: 'create', value: input(), reason: 'Histórico' });
    const original = await repo.audit(s.id);
    expect(await repo.rules()).toEqual([]);
    const rule = { from: '2026-11-02', minutes: 450 };
    await repo.saveRule({ ...rule, minutes: 360 });
    await repo.saveRule(rule);
    const snapshot = join(directory, 'snapshot.sqlite');
    await repo.createBackup(snapshot);
    const saved = new SqliteJourneyRepository(snapshot);
    try {
      expect(await saved.rules()).toEqual([rule]);
      expect(await saved.list({ from: s.workDate, to: s.workDate })).toEqual([s]);
      expect(await saved.audit(s.id)).toEqual(original);
    } finally { await saved.close(); }
  });
  it('recupera jornada pausada com horários e auditoria intactos ao reabrir', async () => {
    let session = await repo.mutate({ type: 'start', at: at('09:00') });
    session = await repo.mutate({ type: 'pause', id: session.id, version: session.version, at: at('12:00'), reason: "kent's" });
    const audit = await repo.audit(session.id);
    await repo.close(); repo = new SqliteJourneyRepository(path, 'Vitest');
    expect(await repo.current()).toEqual(session);
    expect(await repo.audit(session.id)).toEqual(audit);
    session = await repo.mutate({ type: 'resume', id: session.id, version: session.version, at: at('13:00') });
    session = await repo.mutate({ type: 'finish', id: session.id, version: session.version, at: at('18:00') });
    expect(await repo.current()).toBeNull();
    expect((await repo.audit(session.id)).map(a => a.action)).toEqual(['start', 'pause', 'resume', 'finish']);
  });
  it('rejeita versões obsoletas e uma segunda jornada aberta', async () => {
    const session = await repo.mutate({ type: 'start', at: at('09:00') });
    const attempts = await Promise.allSettled([1, 2].map(() => repo.mutate({ type: 'pause', id: session.id, version: session.version, at: at('12:00'), reason: 'Almoço' })));
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    await expect(repo.mutate({ type: 'start', at: at('10:00', '2026-10-21') })).rejects.toMatchObject({ code: 'OVERLAP' });
    expect(await repo.audit(session.id)).toHaveLength(2);
  });
  it('corrige nome sem reescrever a auditoria original', async () => {
    const value = input();
    let session = await repo.mutate({ type: 'create', value, reason: 'Histórico' });
    const original = await repo.audit(session.id);
    session = await repo.mutate({ type: 'edit', id: session.id, version: session.version, reason: 'Correção manual pelo usuário', value: { ...input(session), breaks: session.breaks.map(b => ({ ...b, reason: 'jantar' })) } });
    const audit = await repo.audit(session.id);
    expect(audit[0]).toEqual(original[0]);
    expect(audit[1].before?.breaks[0].reason).toBe('Almoço');
    expect(audit[1].after.breaks[0].reason).toBe('jantar');
    expect(operationalTimeline(session).some(e => e.type === 'pause' && e.reason === 'jantar')).toBe(true);
  });
  it('preserva lixeira, libera a data e impede restauração conflitante', async () => {
    let session = await repo.mutate({ type: 'create', value: input(), reason: 'Histórico' });
    session = await repo.mutate({ type: 'delete', id: session.id, version: session.version });
    const period = { from: session.workDate, to: session.workDate };
    expect(await repo.report(period)).toEqual({ sessions: [], audits: [] });
    expect(await repo.trash()).toEqual([session]);
    const replacement = await repo.mutate({ type: 'create', value: { ...input(), breaks: [] }, reason: 'Reposição' });
    await expect(repo.mutate({ type: 'restore', id: session.id, version: session.version })).rejects.toMatchObject({ code: 'OVERLAP' });
    await repo.mutate({ type: 'delete', id: replacement.id, version: replacement.version });
    session = await repo.mutate({ type: 'restore', id: session.id, version: session.version });
    expect(await repo.list(period)).toEqual([session]);
  });
  it('reverte estado e auditoria se uma pausa falha após a alteração da jornada', async () => {
    const first = await repo.mutate({ type: 'create', value: input(), reason: 'Histórico' });
    const second = await repo.mutate({ type: 'create', value: { ...input(), startedAt: at('09:00', '2026-10-21'), endedAt: at('18:00', '2026-10-21'), breaks: [] }, reason: 'Histórico' });
    await expect(repo.mutate({ type: 'edit', id: second.id, version: second.version, reason: 'Conflito de PK', value: { ...input(second), notes: 'não deve persistir', breaks: [{ ...first.breaks[0], startedAt: at('12:00', '2026-10-21'), endedAt: at('13:00', '2026-10-21') }] } })).rejects.toBeDefined();
    expect((await repo.list({ from: second.workDate, to: second.workDate }))[0]).toEqual(second);
    expect(await repo.audit(second.id)).toHaveLength(1);
  });
  it('não migra nem substitui um banco com schema desconhecido', async () => {
    const unknown = join(directory, 'future.sqlite');
    const db = new DatabaseSync(unknown); db.exec('PRAGMA user_version=99; CREATE TABLE FutureData(Value TEXT);'); db.close();
    const before = await readFile(unknown);
    expect(() => new SqliteJourneyRepository(unknown)).toThrow(/incompatível/);
    expect(await readFile(unknown)).toEqual(before);
    const corrupt = join(directory, 'corrupt.sqlite'); await writeFile(corrupt, 'existing invalid data');
    expect(() => new SqliteJourneyRepository(corrupt)).toThrow();
    expect(await readFile(corrupt, 'utf8')).toBe('existing invalid data');
  });
});
