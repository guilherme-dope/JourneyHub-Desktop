import { commandSchema, type Command, type Period, type WorkSession } from '../shared/contracts';
import { epoch, localDate, secondsBetween, utc, validDate } from '../shared/time';
import { expectedSeconds, type DailyRule } from './work-policy';
import { Temporal } from '@js-temporal/polyfill';

export class DomainError extends Error { constructor(public code: string, message: string) { super(message); } }
function requireRule(condition: unknown, message: string): asserts condition { if (!condition) throw new DomainError('VALIDATION', message); }
export function state(s: WorkSession): 'working' | 'paused' | 'closed' { return s.endedAt ? 'closed' : s.breaks.some(b => !b.endedAt) ? 'paused' : 'working'; }
export function validatePeriod(p: Period): void {
  requireRule(validDate(p.from) && validDate(p.to) && p.from <= p.to, 'Selecione um período válido, com início anterior ao fim.');
  requireRule(Temporal.PlainDate.compare(p.to, Temporal.PlainDate.from(p.from).add({ years: 5 })) <= 0, 'Selecione um período de até cinco anos.');
}
export function validateSession(s: WorkSession, now: string): void {
  const times = [s.startedAt, ...(s.endedAt ? [s.endedAt] : []), ...s.breaks.flatMap(b => b.endedAt ? [b.startedAt, b.endedAt] : [b.startedAt])];
  requireRule(times.every(t => epoch(t) <= epoch(now) && epoch(t) % 1000 === 0), 'Horários devem estar no passado ou presente, com precisão de segundos.');
  requireRule(Number(localDate(s.startedAt).slice(0, 4)) >= 2000, 'Use uma data a partir do ano 2000.');
  requireRule(s.workDate === localDate(s.startedAt), 'Data da jornada incompatível com a entrada.');
  requireRule(!s.endedAt || epoch(s.endedAt) > epoch(s.startedAt), 'A saída deve ser posterior à entrada.');
  requireRule(new Set(s.breaks.map(b => b.id)).size === s.breaks.length, 'Pausas têm identificadores duplicados.');
  let previous = epoch(s.startedAt);
  s.breaks.forEach((b, index) => {
    requireRule(b.reason.trim().length > 0, 'Informe o motivo da pausa.');
    requireRule(epoch(b.startedAt) >= previous, 'Pausas devem estar em ordem, sem sobreposição e após a entrada.');
    requireRule(!s.endedAt || (b.endedAt && epoch(b.endedAt) <= epoch(s.endedAt)), 'Feche todas as pausas antes da saída.');
    if (b.endedAt) {
      requireRule(epoch(b.endedAt) > epoch(b.startedAt), 'O retorno deve ser posterior ao início da pausa.');
      previous = epoch(b.endedAt);
    } else {
      requireRule(index === s.breaks.length - 1 && !s.endedAt, 'Somente a última pausa de uma jornada aberta pode ficar sem retorno.');
      previous = Infinity;
    }
  });
}
export function transition(before: WorkSession | null, raw: Command, now: string, newId: () => string): WorkSession {
  const command = commandSchema.parse(raw);
  let s: WorkSession;
  if (command.type === 'create') {
    requireRule(!before, 'A jornada já existe.');
    s = { ...command.value, id: newId(), deletedAt: null, workDate: localDate(command.value.startedAt), version: 1 };
    s.startedAt = utc(s.startedAt); s.endedAt = utc(s.endedAt!);
    s.breaks = s.breaks.map(b => ({ ...b, startedAt: utc(b.startedAt), endedAt: b.endedAt ? utc(b.endedAt) : null }));
  } else if (command.type === 'start') {
    requireRule(!before, 'A jornada já existe.');
    s = { id: newId(), deletedAt: null, startedAt: utc(command.at), endedAt: null, workDate: localDate(command.at), breaks: [], notes: '', version: 1 };
  } else {
    requireRule(before && before.id === command.id, 'Jornada não encontrada.');
    if (before.version !== command.version) throw new DomainError('CONFLICT', 'Esta jornada mudou. Atualize a tela antes de salvar novamente.');
    s = structuredClone(before);
    s.version++;
    if (command.type === 'delete') {
      requireRule(!s.deletedAt, 'Esta jornada já está na lixeira.');
      s.deletedAt = utc(now);
    } else if (command.type === 'restore') {
      requireRule(s.deletedAt, 'Esta jornada não está na lixeira.');
      s.deletedAt = null;
    } else if (s.deletedAt) {
      throw new DomainError('DELETED', 'Esta jornada está na lixeira. Restaure-a antes de alterar.');
    } else if (command.type === 'edit') {
      s = { ...s, ...command.value, workDate: localDate(command.value.startedAt) };
      s.startedAt = utc(s.startedAt); s.endedAt = s.endedAt ? utc(s.endedAt) : null;
      s.breaks = s.breaks.map(b => ({ ...b, startedAt: utc(b.startedAt), endedAt: b.endedAt ? utc(b.endedAt) : null }));
    } else {
      requireRule(state(s) !== 'closed', 'Esta jornada já foi encerrada. Use a edição para corrigir horários.');
      const at = utc(command.at);
      if (command.type === 'pause') {
        requireRule(state(s) === 'working', 'Já existe uma pausa aberta. Registre o retorno primeiro.');
        s.breaks.push({ id: newId(), startedAt: at, endedAt: null, reason: command.reason });
      } else if (command.type === 'resume') {
        requireRule(state(s) === 'paused', 'Não existe pausa aberta.');
        s.breaks[s.breaks.length - 1].endedAt = at;
      } else {
        if (state(s) === 'paused') s.breaks[s.breaks.length - 1].endedAt = at;
        s.endedAt = at;
      }
    }
  }
  validateSession(s, now);
  return s;
}
export function calculate(s: WorkSession, asOf: string, rules: DailyRule[] = []) {
  // A computer clock moving backwards must not display negative partial totals.
  const last = s.breaks.at(-1);
  const observedEnd = last?.endedAt ?? last?.startedAt ?? s.startedAt;
  const end = s.endedAt ?? (epoch(asOf) < epoch(observedEnd) ? observedEnd : asOf);
  const gross = secondsBetween(s.startedAt, end);
  const paused = s.breaks.reduce((sum, b) => sum + secondsBetween(b.startedAt, b.endedAt ?? end), 0);
  const worked = gross - paused;
  const expected = expectedSeconds(rules, s.workDate);
  const extra = s.endedAt ? Math.max(0, worked - expected) : null;
  const deficit = s.endedAt ? Math.max(0, expected - worked) : null;
  return { gross, paused, worked, expected, extra, deficit, balance: extra === null || deficit === null ? null : extra - deficit, partial: !s.endedAt };
}

export function lastDays(now: string, days: number) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 1830) throw new RangeError();
  const end = Temporal.PlainDate.from(localDate(now));
  const period = { from: end.subtract({ days: days - 1 }).toString(), to: end.toString() };
  validatePeriod(period);
  return period;
}
