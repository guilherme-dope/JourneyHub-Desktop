import { expect, it } from 'vitest';
import { calculate, lastDays } from '../src/domain/journey';
import { expectedSeconds, minutesSchema, nextWorkDate } from '../src/domain/work-policy';
import { buildWorkbook } from '../src/main/export';
import { fixture, now } from './fixtures';

it('conta dias inclusivos no calendário de trabalho, inclusive antes da meia-noite local', () => {
  const time = '2026-11-01T02:59:59Z';
  expect(lastDays(time, 13)).toEqual({ from: '2026-10-19', to: '2026-10-31' });
  expect(nextWorkDate(time)).toBe('2026-11-01');
  expect(lastDays('2026-11-01T03:00:00Z', 1)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  for (const n of [NaN, 0, -1, 1.5, 1830]) expect(() => lastDays(time, n)).toThrow();
});

it('limita a duração e aplica a regra vigente somente aos dias úteis', () => {
  for (const n of [0, 1.5, 1441]) expect(minutesSchema.safeParse(n).success).toBe(false);
  const rules = [{ from: '2026-11-02', minutes: 450 }];
  expect(expectedSeconds(rules, '2026-10-30')).toBe(28800);
  expect(expectedSeconds(rules, '2026-11-02')).toBe(27000);
  expect(expectedSeconds(rules, '2026-11-07')).toBe(0);
});

it('exporta a mesma referência e o mesmo saldo exibidos para a jornada', async () => {
  const s = fixture();
  const rules = [{ from: s.workDate, minutes: 450 }];
  const totals = calculate(s, now, rules);
  expect(totals.worked).toBe(28800); expect(totals.extra).toBe(1800);
  const book = await buildWorkbook({ sessions: [s], audits: [] }, { from: s.workDate, to: s.workDate }, now, undefined, rules);
  expect(book.worksheets[0].getCell('H5').value).toBe(450 / 1440);
  expect(book.worksheets[0].getCell('I5').value).toBe(1800 / 86400);
});
