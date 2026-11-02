import type { DailyRule } from '../domain/work-policy';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import type Sql from 'mssql';
import { Database, type Connection } from './database';
import { DomainError, transition, validatePeriod } from '../domain/journey';
import { clockNow } from '../shared/time';
import type { AuditEntry, Command, Health, Period, Report, WorkSession } from '../shared/contracts';
import type { JourneyPersistence } from './persistence';

const iso = (value: Date) => value.toISOString().replace('.000Z', 'Z');
type Row = Record<string, any>;
function mapSessions(rows: Row[], breaks: Row[]): WorkSession[] {
  return rows.map(r => ({ id: r.Id.toLowerCase(), workDate: r.WorkDate.toISOString().slice(0, 10), startedAt: iso(r.StartedAt), endedAt: r.EndedAt ? iso(r.EndedAt) : null, notes: r.Notes, version: r.Version, deletedAt: r.DeletedAt ? iso(r.DeletedAt) : null,
    breaks: breaks.filter(b => b.SessionId.toLowerCase() === r.Id.toLowerCase()).map(b => ({ id: b.Id.toLowerCase(), startedAt: iso(b.StartedAt), endedAt: b.EndedAt ? iso(b.EndedAt) : null, reason: b.Reason })) }));
}
function mapAudits(rows: Row[]): AuditEntry[] { return rows.map(r => ({ id: r.Id, sessionId: r.SessionId, action: r.Action, reason: r.Reason, actor: r.Actor, recordedAt: iso(r.RecordedAt), before: r.BeforeJson ? JSON.parse(r.BeforeJson) : null, after: JSON.parse(r.AfterJson) })); }

export class JourneyRepository implements JourneyPersistence {
  constructor(private db: Database, private actor = `${process.env.USERDOMAIN ?? 'local'}\\${userInfo().username}`) {}
  async health(): Promise<Health> {
    const { pool } = await this.db.connect();
    const server = await pool.request().query(`SELECT 1 AS Connected, IS_SRVROLEMEMBER('sysadmin') AS IsAdmin, IS_MEMBER('db_owner') AS IsOwner, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL') AS HasControl; SELECT OBJECT_ID(N'journey.SchemaVersions') AS SchemaId;`);
    const sets = server.recordsets as Sql.IRecordSet<Row>[];
    const row = sets[0][0];
    if (!sets[1][0].SchemaId) return { connected: true, ready: false, message: 'Conectado. O banco precisa da migração inicial.', checkedAt: clockNow() };
    const versions = await pool.request().query('SELECT MAX(Version) AS Version FROM journey.SchemaVersions');
    const ready = versions.recordset[0].Version === 2 && !row.IsAdmin && !row.IsOwner && !row.HasControl;
    return { connected: true, ready, message: versions.recordset[0].Version !== 2 ? 'Versão do banco incompatível. Execute a migração.' : !ready ? 'Use um login restrito à função journey_app; a conta atual é administrativa.' : 'SQL Server conectado e pronto.', checkedAt: clockNow() };
  }
  private async transaction<T>(mode: 'Shared' | 'Exclusive', work: (c: Connection, tx: Sql.Transaction) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    const tx = new c.sql.Transaction(c.pool);
    let rolledBack = false;
    tx.on('rollback', () => { rolledBack = true; });
    await tx.begin(c.sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new c.sql.Request(tx).input('mode', c.sql.NVarChar(32), mode).query(`DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'JourneyHub.Write', @LockMode=@mode, @LockOwner='Transaction', @LockTimeout=10000; IF @result < 0 THROW 51000, 'Could not acquire journey lock', 1;`);
      const result = await work(c, tx);
      await tx.commit(); return result;
    } catch (error) { if (!rolledBack) await tx.rollback().catch(() => {}); throw error; }
  }
  async rules(): Promise<DailyRule[]> {
    const { pool } = await this.db.connect();
    const result = await pool.request().query("IF OBJECT_ID(N'journey.DailyReference', N'U') IS NOT NULL SELECT CONVERT(char(10), EffectiveDate, 23) AS [from], Minutes AS minutes FROM journey.DailyReference ORDER BY EffectiveDate DESC");
    return result.recordset ?? [];
  }
  async saveRule(rule: DailyRule) {
    await this.transaction('Exclusive', async ({ sql }, tx) => {
      const request = new sql.Request(tx);
      const table = await request.query("SELECT OBJECT_ID(N'journey.DailyReference', N'U') AS id");
      if (!table.recordset[0].id) throw new DomainError('VALIDATION', 'Peça ao administrador para aplicar a migração de referência diária neste banco.');
      await request.input('day', sql.Date, rule.from).input('minutes', sql.Int, rule.minutes).query(`
        UPDATE journey.DailyReference SET Minutes=@minutes WHERE EffectiveDate=@day;
        IF @@ROWCOUNT=0 INSERT INTO journey.DailyReference(EffectiveDate, Minutes) VALUES (@day, @minutes);`);
    });
  }
  async list(period: Period): Promise<WorkSession[]> { return (await this.report(period, false)).sessions; }
  async report(period: Period, audits = true): Promise<Report> {
    validatePeriod(period);
    return this.transaction('Shared', async ({ sql }, tx) => {
      const request = new sql.Request(tx).input('from', sql.Date, period.from).input('to', sql.Date, period.to);
      const result = await request.query(`SELECT * FROM journey.WorkSessions WHERE DeletedAt IS NULL AND WorkDate BETWEEN @from AND @to ORDER BY StartedAt DESC;
        SELECT b.* FROM journey.Breaks b JOIN journey.WorkSessions s ON s.Id=b.SessionId WHERE s.DeletedAt IS NULL AND s.WorkDate BETWEEN @from AND @to ORDER BY b.Position;
        ${audits ? "SELECT a.* FROM journey.AuditLog a JOIN journey.WorkSessions s ON s.Id=a.SessionId WHERE s.DeletedAt IS NULL AND s.WorkDate BETWEEN @from AND @to ORDER BY a.RecordedAt, TRY_CONVERT(int,JSON_VALUE(a.AfterJson,'$.version')), a.Id;" : ''}`);
      const sets = result.recordsets as Sql.IRecordSet<Row>[];
      return { sessions: mapSessions(sets[0], sets[1]), audits: audits ? mapAudits(sets[2]) : [] };
    });
  }
  async current(): Promise<WorkSession | null> {
    return this.transaction('Shared', async ({ sql }, tx) => {
      const result = await new sql.Request(tx).query(`SELECT * FROM journey.WorkSessions WHERE EndedAt IS NULL AND DeletedAt IS NULL; SELECT b.* FROM journey.Breaks b JOIN journey.WorkSessions s ON s.Id=b.SessionId WHERE s.EndedAt IS NULL AND s.DeletedAt IS NULL ORDER BY b.Position;`);
      const sets = result.recordsets as Sql.IRecordSet<Row>[];
      return mapSessions(sets[0], sets[1])[0] ?? null;
    });
  }
  async audit(id: string): Promise<AuditEntry[]> {
    const { sql, pool } = await this.db.connect();
    return mapAudits((await pool.request().input('id', sql.UniqueIdentifier, id).query("SELECT * FROM journey.AuditLog WHERE SessionId=@id ORDER BY RecordedAt, TRY_CONVERT(int,JSON_VALUE(AfterJson,'$.version')), Id")).recordset);
  }
  async trash(): Promise<WorkSession[]> {
    return this.transaction('Shared', async ({ sql }, tx) => {
      const result = await new sql.Request(tx).query(`SELECT * FROM journey.WorkSessions WHERE DeletedAt IS NOT NULL ORDER BY DeletedAt DESC, Id; SELECT b.* FROM journey.Breaks b JOIN journey.WorkSessions s ON s.Id=b.SessionId WHERE s.DeletedAt IS NOT NULL ORDER BY b.Position;`);
      const sets = result.recordsets as Sql.IRecordSet<Row>[];
      return mapSessions(sets[0], sets[1]);
    });
  }
  async mutate(command: Command): Promise<WorkSession> {
    if (!(await this.health()).ready) throw new DomainError('DATABASE_NOT_READY', 'O banco não está pronto para gravação. Verifique a conexão e o usuário de execução.');
    return this.transaction('Exclusive', async ({ sql }, tx) => {
      let before: WorkSession | null = null;
      if (command.type !== 'start' && command.type !== 'create') {
        const existing = await new sql.Request(tx).input('id', sql.UniqueIdentifier, command.id).query(`SELECT * FROM journey.WorkSessions WITH (UPDLOCK) WHERE Id=@id; SELECT * FROM journey.Breaks WHERE SessionId=@id ORDER BY Position;`);
        const sets = existing.recordsets as Sql.IRecordSet<Row>[];
        before = mapSessions(sets[0], sets[1])[0] ?? null;
      }
      const after = transition(before, command, clockNow(), randomUUID);
      const overlap = !after.deletedAt ? await new sql.Request(tx).input('id', sql.UniqueIdentifier, after.id).input('date', sql.Date, after.workDate)
        .input('start', sql.DateTime2(0), new Date(after.startedAt)).input('end', sql.DateTime2(0), after.endedAt ? new Date(after.endedAt) : null)
        .query(`SELECT TOP (1) Id FROM journey.WorkSessions WHERE DeletedAt IS NULL AND Id<>@id AND (WorkDate=@date OR ((@end IS NULL OR StartedAt<@end) AND (EndedAt IS NULL OR EndedAt>@start)));`) : { recordset: [] };
      if (overlap.recordset.length) throw new DomainError('OVERLAP', 'Já existe uma jornada nessa data ou nesse intervalo. Edite a existente; encerre a jornada aberta antes de iniciar outra.');
      const request = new sql.Request(tx).input('id', sql.UniqueIdentifier, after.id).input('date', sql.Date, after.workDate)
        .input('start', sql.DateTime2(0), new Date(after.startedAt)).input('end', sql.DateTime2(0), after.endedAt ? new Date(after.endedAt) : null)
        .input('notes', sql.NVarChar(2000), after.notes).input('version', sql.Int, after.version);
      request.input('deleted', sql.DateTime2(0), after.deletedAt ? new Date(after.deletedAt) : null);
      if (before) await request.query('UPDATE journey.WorkSessions SET WorkDate=@date, StartedAt=@start, EndedAt=@end, Notes=@notes, Version=@version, DeletedAt=@deleted WHERE Id=@id; DELETE FROM journey.Breaks WHERE SessionId=@id;');
      else await request.query('INSERT journey.WorkSessions(Id,WorkDate,StartedAt,EndedAt,Notes,Version) VALUES (@id,@date,@start,@end,@notes,@version);');
      for (const [i, b] of after.breaks.entries()) {
        await new sql.Request(tx).input('id', sql.UniqueIdentifier, b.id).input('session', sql.UniqueIdentifier, after.id).input('position', sql.Int, i)
          .input('start', sql.DateTime2(0), new Date(b.startedAt)).input('end', sql.DateTime2(0), b.endedAt ? new Date(b.endedAt) : null)
          .input('reason', sql.NVarChar(300), b.reason).query('INSERT journey.Breaks(Id,SessionId,Position,StartedAt,EndedAt,Reason) VALUES (@id,@session,@position,@start,@end,@reason);');
      }
      const reason = command.type === 'edit' || command.type === 'create' || command.type === 'pause' ? command.reason : ({ start: 'Entrada manual', resume: 'Retorno manual', finish: 'Encerramento manual', delete: 'Enviada à lixeira após dupla confirmação', restore: 'Restaurada da lixeira' } as const)[command.type];
      await new sql.Request(tx).input('id', sql.UniqueIdentifier, randomUUID()).input('session', sql.UniqueIdentifier, after.id)
        .input('action', sql.NVarChar(20), command.type).input('reason', sql.NVarChar(500), reason).input('actor', sql.NVarChar(256), this.actor)
        .input('before', sql.NVarChar(sql.MAX), before ? JSON.stringify(before) : null).input('after', sql.NVarChar(sql.MAX), JSON.stringify(after))
        .query('INSERT journey.AuditLog(Id,SessionId,Action,Reason,Actor,BeforeJson,AfterJson) VALUES (@id,@session,@action,@reason,@actor,@before,@after);');
      return after;
    });
  }
}
