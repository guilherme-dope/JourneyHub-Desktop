import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { calculate, state, transition, validatePeriod, validateSession } from '../src/domain/journey';
import { commandSchema } from '../src/shared/contracts';
import { duration, fromLocal, localDate, localInput } from '../src/shared/time';
import { at, fixture, id, now } from './fixtures';

describe('cálculos derivados da planilha', () => {
  it('confere 9–18 com uma hora de intervalo', () => { expect(calculate(fixture(), now)).toMatchObject({ gross: 32400, paused: 3600, worked: 28800, extra: 0, deficit: 0 }); });
  it('preserva minutos de extras em múltiplas pausas', () => {
    const s = fixture({ endedAt: at('19:00') });
    s.breaks.push({ id: randomUUID(), startedAt: at('15:00'), endedAt: at('15:30'), reason: 'Consulta' });
    expect(calculate(s, now)).toMatchObject({ worked: 30600, extra: 1800, deficit: 0 });
  });
  it('reproduz a linha 2026!394: 6h30 líquido e 1h30 de déficit', () => {
    const s = fixture({ workDate: '2026-10-09', startedAt: at('13:00', '2026-10-09'), endedAt: at('21:00', '2026-10-09'), breaks: [{ id: randomUUID(), startedAt: at('17:00', '2026-10-09'), endedAt: at('18:30', '2026-10-09'), reason: 'Intervalo' }] });
    expect(calculate(s, now)).toMatchObject({ worked: 23400, extra: 0, deficit: 5400, balance: -5400 });
  });
  it('conta todo o trabalho de sábado como extra, sem pausa artificial', () => {
    const s = fixture({ workDate: '2026-10-24', startedAt: at('18:00', '2026-10-24'), endedAt: at('20:00', '2026-10-24'), breaks: [] });
    expect(calculate(s, now)).toMatchObject({ worked: 7200, expected: 0, extra: 7200, deficit: 0 });
  });
  it('calcula jornada que cruza meia-noite usando datas completas', () => {
    const s = fixture({ startedAt: at('22:00'), endedAt: at('06:00', '2026-10-21'), breaks: [{ id: randomUUID(), startedAt: at('01:00', '2026-10-21'), endedAt: at('01:30', '2026-10-21'), reason: 'Descanso' }] });
    validateSession(s, now); expect(calculate(s, now)).toMatchObject({ worked: 27000, deficit: 1800 });
  });
  it('não aplica módulo 24 nem perde frações', () => { expect(duration(45.5 * 3600)).toBe('45:30:00'); expect(duration(-5400)).toBe('−01:30:00'); });
  it('distingue parcial de zero e congela líquido durante pausa', () => {
    const s = fixture({ endedAt: null }); s.breaks[0].endedAt = null;
    const c = calculate(s, at('17:00'));
    expect(c).toMatchObject({ worked: 10800, paused: 18000, partial: true, extra: null, deficit: null });
  });
  it('não mostra parcial negativo quando relógio retrocede', () => { expect(calculate(fixture({ endedAt: null, breaks: [] }), at('08:00')).worked).toBe(0); });
});
describe('transições e integridade', () => {
  it('rejeita frações antes da normalização, inclusive menores que um milissegundo', () => {
    for (const fraction of ['123', '000001', '000000001']) {
      const fractional = at('09:00').replace('Z', `.${fraction}Z`);
      expect(() => transition(null, { type: 'start', at: fractional }, now, randomUUID)).toThrow();
      const original = fixture();
      expect(() => transition(original, { type: 'edit', id, version: 1, reason: 'Precisão', value: { startedAt: fractional, endedAt: original.endedAt, notes: '', breaks: original.breaks } }, now, randomUUID)).toThrow();
    }
    expect(() => transition(null, { type: 'start', at: at('09:00').replace('Z', '.000Z') }, now, randomUUID)).not.toThrow();
  });
  it('exclui e restaura sem perder horários ou pausas', () => {
    const original = fixture();
    const deleted = transition(original, { type: 'delete', id, version: 1 }, now, randomUUID);
    expect(deleted.deletedAt).toBe(now); expect(deleted.version).toBe(2);
    expect(original.deletedAt).toBeUndefined(); expect(deleted.breaks).toEqual(original.breaks);
    const restored = transition(deleted, { type: 'restore', id, version: 2 }, now, randomUUID);
    expect(restored.deletedAt).toBeNull(); expect(restored.endedAt).toBe(original.endedAt); expect(restored.breaks).toEqual(original.breaks);
  });
  it('impede exclusão duplicada, edição na lixeira e restauração de registro ativo', () => {
    const s = fixture(); const deleted = transition(s, { type: 'delete', id, version: 1 }, now, randomUUID);
    expect(() => transition(deleted, { type: 'delete', id, version: 2 }, now, randomUUID)).toThrow('já está');
    expect(() => transition(deleted, { type: 'edit', id, version: 2, reason: 'Teste', value: { startedAt: s.startedAt, endedAt: s.endedAt, notes: '', breaks: s.breaks } }, now, randomUUID)).toThrow('Restaure');
    expect(() => transition(s, { type: 'restore', id, version: 1 }, now, randomUUID)).toThrow('não está');
    expect(() => transition(deleted, { type: 'restore', id, version: 1 }, now, randomUUID)).toThrow('mudou');
  });
  it('preserva o estado de uma jornada pausada ao excluir e restaurar', () => {
    const original = fixture({ endedAt: null }); original.breaks[0].endedAt = null;
    const deleted = transition(original, { type: 'delete', id, version: 1 }, now, randomUUID);
    const restored = transition(deleted, { type: 'restore', id, version: 2 }, now, randomUUID);
    expect(state(restored)).toBe('paused'); expect(restored.breaks).toEqual(original.breaks);
  });
  it('cadastra jornada anterior completa sem intervalo aberto intermediário', () => {
    const { startedAt, endedAt, breaks, notes } = fixture();
    const created = transition(null, { type: 'create', value: { startedAt, endedAt: endedAt!, breaks, notes }, reason: 'Registro esquecido' }, now, randomUUID);
    expect(created.version).toBe(1); expect(state(created)).toBe('closed'); expect(created.workDate).toBe('2026-10-20');
  });
  it('executa entrada, várias pausas, retornos e fechamento', () => {
    let s = transition(null, { type: 'start', at: at('09:00') }, now, () => id);
    for (const [start, end] of [['10:00', '10:30'], ['12:00', '13:00'], ['15:00', '15:15']]) {
      s = transition(s, { type: 'pause', id, version: s.version, at: at(start), reason: 'Intervalo' }, now, randomUUID);
      expect(state(s)).toBe('paused');
      s = transition(s, { type: 'resume', id, version: s.version, at: at(end) }, now, randomUUID);
      expect(state(s)).toBe('working');
    }
    s = transition(s, { type: 'finish', id, version: s.version, at: at('18:00') }, now, randomUUID);
    expect(state(s)).toBe('closed'); expect(s.breaks).toHaveLength(3); expect(s.version).toBe(8);
  });
  it('fecha explicitamente a pausa aberta ao encerrar', () => {
    const s = fixture({ endedAt: null }); s.breaks[0].endedAt = null;
    const after = transition(s, { type: 'finish', id, version: 1, at: at('13:00') }, now, randomUUID);
    expect(after.endedAt).toBe(at('13:00')); expect(after.breaks[0].endedAt).toBe(after.endedAt);
  });
  it('não altera o objeto anterior ao editar', () => {
    const s = fixture(); const after = transition(s, { type: 'edit', id, version: 1, reason: 'Corrigi saída', value: { ...(({ startedAt, endedAt, breaks, notes }) => ({ startedAt, endedAt, breaks, notes }))(s), endedAt: at('19:00') } }, now, randomUUID);
    expect(s.endedAt).toBe(at('18:00')); expect(after.version).toBe(2);
  });
  it('rejeita conflito de versão', () => { expect(() => transition(fixture(), { type: 'finish', id, version: 2, at: at('19:00') }, now, randomUUID)).toThrow('mudou'); });
  it('rejeita transições após fechamento', () => { expect(() => transition(fixture(), { type: 'pause', id, version: 1, at: at('19:00'), reason: 'Pausa' }, now, randomUUID)).toThrow('encerrada'); });
  it('rejeita segunda pausa aberta e retorno sem pausa', () => {
    const s = fixture({ endedAt: null }); s.breaks[0].endedAt = null;
    expect(() => transition(s, { type: 'pause', id, version: 1, at: at('14:00'), reason: 'Pausa' }, now, randomUUID)).toThrow('aberta');
    expect(() => transition(fixture({ endedAt: null, breaks: [] }), { type: 'resume', id, version: 1, at: at('14:00') }, now, randomUUID)).toThrow('Não existe');
  });
  it.each(['08:00', '12:00'])('rejeita retorno fora de ordem ou de duração zero: %s', end => {
    const s = fixture(); s.breaks[0].endedAt = at(end); expect(() => validateSession(s, now)).toThrow('posterior');
  });
  it('rejeita sobreposição de pausas e IDs repetidos', () => {
    const s = fixture(); s.breaks.push({ id: randomUUID(), startedAt: at('12:30'), endedAt: at('14:00'), reason: 'Consulta' });
    expect(() => validateSession(s, now)).toThrow('sobreposição');
    s.breaks[1].id = s.breaks[0].id; expect(() => validateSession(s, now)).toThrow('duplicados');
  });
  it('rejeita futuro, ordem inválida, pausa após saída e frações de segundo', () => {
    expect(() => validateSession(fixture({ endedAt: '2099-10-20T21:00:00Z' }), now)).toThrow('passado');
    expect(() => validateSession(fixture({ endedAt: at('08:00') }), now)).toThrow('posterior');
    expect(() => validateSession(fixture({ endedAt: at('12:30') }), now)).toThrow('pausas');
    expect(() => validateSession(fixture({ startedAt: at('09:00').replace('00Z', '00.123Z') }), now)).toThrow('segundos');
  });
  it('aceita muitas pausas sem limite artificial de quantidade', () => {
    const s = fixture({ breaks: Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), startedAt: new Date(Date.parse(at('10:00')) + i * 60000).toISOString(), endedAt: new Date(Date.parse(at('10:00')) + i * 60000 + 30000).toISOString(), reason: 'Pausa' })) });
    validateSession(s, now); expect(calculate(s, now).paused).toBe(3000);
  });
  it('não aceita campos extras nem motivos vazios no IPC', () => {
    expect(commandSchema.safeParse({ type: 'start', at: at('09:00'), sql: 'DROP TABLE anything' }).success).toBe(false);
    expect(commandSchema.safeParse({ type: 'pause', id, version: 1, at: at('12:00'), reason: ' ' }).success).toBe(true);
  });
});
describe('calendário e fuso', () => {
  it('limita o período a cinco anos completos, incluindo meses e dias', () => {
    expect(() => validatePeriod({ from: '2020-01-01', to: '2025-12-31' })).toThrow('cinco anos');
    expect(() => validatePeriod({ from: '2020-03-01', to: '2025-03-02' })).toThrow('cinco anos');
    expect(() => validatePeriod({ from: '2020-03-01', to: '2025-03-01' })).not.toThrow();
    expect(() => validatePeriod({ from: '2020-02-29', to: '2025-02-28' })).not.toThrow();
  });
  it('usa São Paulo independentemente do fuso do computador', () => { expect(localInput('2026-10-21T02:30:00Z')).toBe('2026-10-20T23:30:00'); expect(localDate('2026-10-21T02:30:00Z')).toBe('2026-10-20'); });
  it('rejeita horário inexistente no início histórico do horário de verão', () => { expect(() => fromLocal('2018-11-04T00:30:00')).toThrow(); });
  it('valida intervalo e datas reais, incluindo bissexto', () => {
    expect(() => validatePeriod({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    expect(() => validatePeriod({ from: '2026-03-01', to: '2026-02-01' })).toThrow();
    expect(() => validatePeriod({ from: '2024-02-29', to: '2024-02-29' })).not.toThrow();
  });
});
