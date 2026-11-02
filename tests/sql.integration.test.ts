import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/main/database';
import { JourneyRepository } from '../src/main/repository';
import { fromLocal } from '../src/shared/time';
import type { WorkSession } from '../src/shared/contracts';
import { assertIsolatedSql } from '../scripts/test-safety';

// Explicit opt-in, separate env file, and database-name guard. Never use the production DB.
const enabled = process.env.JOURNEY_SQL_TEST === 'true';
if (enabled) config({ path: '.env.adapter-test', override: true, quiet: true });
describe.skipIf(!enabled)('SQL Server real — login restrito', () => {
  let db: Database; let repo: JourneyRepository; let s: WorkSession;
  let date: string;
  const at = (time: string) => fromLocal(`${date}T${time}:00`);
  beforeAll(async () => {
    if (!process.env.MSSQL_DATABASE?.endsWith('_test')) throw new Error('Integration tests require a dedicated _test database.');
    db = new Database(); repo = new JourneyRepository(db, 'Vitest integration');
    await assertIsolatedSql(db);
    const { pool } = await db.connect();
    const latest = (await pool.request().query('SELECT MAX(WorkDate) AS LastDate FROM journey.WorkSessions')).recordset[0].LastDate;
    const day = latest ? new Date(latest) : new Date('2001-01-01T12:00:00Z');
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCFullYear() > 2014) throw Error('Historical test fixture range exhausted.');
    date = day.toISOString().slice(0, 10);
  });
  afterAll(async () => { await db?.close(); });
  it('persiste a referência no banco de teste e aceita ajuste para a mesma vigência', async () => {
    const rule = { from: '2099-01-01', minutes: 450 };
    await repo.saveRule({ ...rule, minutes: 360 });
    await repo.saveRule(rule);
    await db.close();
    expect((await repo.rules()).filter(value => value.from === rule.from)).toEqual([rule]);
  });
  it('verifica conexão e privilégios reais', async () => { expect(await repo.health()).toMatchObject({ connected: true, ready: true }); });
  it('persiste entrada e retorna estado após reconexão', async () => {
    s = await repo.mutate({ type: 'start', at: at('09:00') });
    await db.close(); expect(await repo.current()).toEqual(s);
  });
  it('serializa mutações concorrentes e rejeita versão antiga', async () => {
    const attempts = await Promise.allSettled([repo.mutate({ type: 'pause', id: s.id, version: s.version, at: at('12:00'), reason: '' }), repo.mutate({ type: 'pause', id: s.id, version: s.version, at: at('12:00'), reason: '' })]);
    expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(x => x.status === 'rejected')).toHaveLength(1);
    s = (await repo.current())!; expect(s.breaks).toHaveLength(1); expect(s.breaks[0].reason).toBe('Pausa');
  });
  it('retorna, encerra e grava auditoria atomicamente', async () => {
    s = await repo.mutate({ type: 'resume', id: s.id, version: s.version, at: at('13:00') });
    s = await repo.mutate({ type: 'finish', id: s.id, version: s.version, at: at('18:00') });
    expect(await repo.current()).toBeNull();
    const audit = await repo.audit(s.id); expect(audit).toHaveLength(4);
    expect(audit.find(a => a.action === 'finish')?.before?.endedAt).toBeNull();
  });
  it('faz rollback se correção conflita e mantém motivo/antes/depois', async () => {
    const value = { startedAt: s.startedAt, endedAt: s.endedAt, breaks: s.breaks, notes: 'Corrigido' };
    s = await repo.mutate({ type: 'edit', id: s.id, version: s.version, reason: 'Teste de correção', value });
    await expect(repo.mutate({ type: 'edit', id: s.id, version: s.version - 1, reason: 'Obsoleta', value })).rejects.toMatchObject({ code: 'CONFLICT' });
    const audit = await repo.audit(s.id); expect(audit).toHaveLength(5);
    const edit = audit.find(a => a.action === 'edit')!; expect(edit.before?.notes).toBe(''); expect(edit.after.notes).toBe('Corrigido');
  });
  it('impede jornada duplicada e preserva consulta do período', async () => {
    await expect(repo.mutate({ type: 'start', at: at('19:00') })).rejects.toMatchObject({ code: 'OVERLAP' });
    const report = await repo.report({ from: date, to: date }); expect(report.sessions).toHaveLength(1); expect(report.audits).toHaveLength(5);
  });
  it('faz rollback de jornada quando uma inserção de pausa falha no banco', async () => {
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const later = next.toISOString().slice(0, 10);
    const time = (hour: string) => fromLocal(`${later}T${hour}:00`);
    await expect(repo.mutate({ type: 'create', reason: 'Teste de rollback por PK', value: { startedAt: time('09:00'), endedAt: time('18:00'), notes: '', breaks: [{ ...s.breaks[0], startedAt: time('12:00'), endedAt: time('13:00') }] } })).rejects.toBeDefined();
    expect(await repo.list({ from: later, to: later })).toHaveLength(0);
    expect(await repo.audit(s.id)).toHaveLength(5);
  });
  it('envia à lixeira e remove de relatórios sem perder a auditoria', async () => {
    s = await repo.mutate({ type: 'delete', id: s.id, version: s.version });
    expect(s.deletedAt).toBeTruthy();
    expect(await repo.list({ from: date, to: date })).toHaveLength(0);
    expect((await repo.report({ from: date, to: date })).audits).toHaveLength(0);
    expect((await repo.trash()).find(x => x.id === s.id)?.breaks).toEqual(s.breaks);
    expect(await repo.audit(s.id)).toHaveLength(6);
  });
  it('libera a data para novos registros e impede restauração em conflito', async () => {
    const replacement = await repo.mutate({ type: 'create', reason: 'Novo registro na data liberada', value: { startedAt: at('09:00'), endedAt: at('18:00'), notes: '', breaks: [] } });
    await expect(repo.mutate({ type: 'restore', id: s.id, version: s.version })).rejects.toMatchObject({ code: 'OVERLAP' });
    expect(await repo.audit(s.id)).toHaveLength(6);
    expect((await repo.trash()).find(x => x.id === s.id)?.deletedAt).toBeTruthy();
    await repo.mutate({ type: 'delete', id: replacement.id, version: replacement.version });
    s = await repo.mutate({ type: 'restore', id: s.id, version: s.version });
    expect(s.deletedAt).toBeNull(); expect(s.breaks).toHaveLength(1);
    expect(await repo.list({ from: date, to: date })).toEqual([s]);
    expect((await repo.audit(s.id)).map(a => a.action)).toEqual(['start','pause','resume','finish','edit','delete','restore']);
  });
  it('não permite duas jornadas abertas ao restaurar uma jornada apagada', async () => {
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const later = next.toISOString().slice(0, 10);
    let open = await repo.mutate({ type: 'start', at: fromLocal(`${later}T09:00:00`) });
    open = await repo.mutate({ type: 'delete', id: open.id, version: open.version });
    expect(await repo.current()).toBeNull();
    let other = await repo.mutate({ type: 'start', at: fromLocal(`${later}T10:00:00`) });
    await expect(repo.mutate({ type: 'restore', id: open.id, version: open.version })).rejects.toMatchObject({ code: 'OVERLAP' });
    other = await repo.mutate({ type: 'delete', id: other.id, version: other.version });
    open = await repo.mutate({ type: 'restore', id: open.id, version: open.version });
    expect(await repo.current()).toEqual(open);
    await repo.mutate({ type: 'finish', id: open.id, version: open.version, at: fromLocal(`${later}T18:00:00`) });
  });
  it('nega DDL e alteração ou exclusão de auditoria', async () => {
    const { pool } = await db.connect();
    for (const query of ['CREATE TABLE dbo.ShouldNotBeAllowed(Id int)', 'DELETE FROM journey.AuditLog WHERE 1=0', "UPDATE journey.AuditLog SET Reason=N'changed' WHERE 1=0", 'DELETE FROM journey.WorkSessions WHERE 1=0']) {
      await expect(pool.request().query(query)).rejects.toBeDefined();
    }
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.ShouldNotBeAllowed') AS ObjectId")).recordset[0].ObjectId).toBeNull();
  });
});

