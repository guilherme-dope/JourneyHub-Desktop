import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkbook, saveNewWorkbook } from '../src/main/export';
import { fixture, now } from './fixtures';
import type { AuditEntry } from '../src/shared/contracts';
const period = { from: '2026-10-01', to: '2026-10-26' };
describe('exportação Excel real', () => {
  it('resumo exclui textos privados e auditoria após salvar e reabrir', async () => {
    const session = fixture({ notes: 'PRIVATE_NOTE' });
    session.breaks[0].reason = 'PRIVATE_REASON';
    const audit: AuditEntry = { id: 'PRIVATE_ID', sessionId: session.id, actor: 'PRIVATE_ACTOR', action: 'edit',
      reason: 'PRIVATE_OLD', recordedAt: now, before: session, after: session };
    const wb = await buildWorkbook({ sessions: [session], audits: [audit] }, period, now, undefined, [], 'summary');
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await wb.xlsx.writeBuffer());
    expect(reopened.worksheets).toHaveLength(1);
    const serialized = JSON.stringify(reopened.model);
    for (const secret of ['PRIVATE_NOTE', 'PRIVATE_REASON', 'PRIVATE_ACTOR', 'PRIVATE_OLD', session.id]) expect(serialized).not.toContain(secret);
    expect(reopened.worksheets[0].columnCount).toBe(5);
    expect(reopened.worksheets[0].columns.some(column => column.hidden)).toBe(false);
    expect(reopened.worksheets[0].getCell('E5').value).toBe(0);
  });
  it('grava, reabre e preserva durações numéricas, fórmulas e texto literal', async () => {
    const s = fixture({ notes: '=HYPERLINK("https://example.invalid")' });
    const wb = await buildWorkbook({ sessions: [s], audits: [] }, period, now);
    const saved = await wb.xlsx.writeBuffer(); const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(saved);
    expect(reopened.worksheets.map(s => s.name)).toEqual(['Jornadas', 'Pausas', 'Auditoria']);
    // ExcelJS rehydrates duration-formatted numbers as Date objects; normalize that reader behavior.
    const serial = (v: unknown) => v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v;
    expect(serial(reopened.getWorksheet('Jornadas')!.getCell('G5').value)).toBeCloseTo(8 / 24);
    expect(reopened.getWorksheet('Jornadas')!.getCell('G5').numFmt).toBe('[h]:mm:ss');
    expect(reopened.getWorksheet('Jornadas')!.getCell('L5').value).toBe(s.notes);
    expect(reopened.getWorksheet('Jornadas')!.getCell('G6').formula).toBe('SUM(G5:G5)');
    expect(serial(reopened.getWorksheet('Jornadas')!.getCell('G6').result)).toBeCloseTo(8 / 24);
    expect(serial(reopened.getWorksheet('Pausas')!.getCell('D5').value)).toBeCloseTo(1 / 24);
  });
  it('não inclui jornadas abertas em totais definitivos', async () => {
    const wb = await buildWorkbook({ sessions: [fixture({ endedAt: null })], audits: [] }, period, now);
    const sheet = wb.getWorksheet('Jornadas')!;
    expect(sheet.getCell('G5').value).toBeNull(); expect(sheet.getCell('D5').value).toContain('parcial');
    expect(sheet.getCell('G6').result).toBe(0);
  });
  it('mantém total superior a 24h e período vazio sem fórmulas circulares', async () => {
    const wb = await buildWorkbook({ sessions: Array.from({ length: 6 }, () => fixture()), audits: [] }, period, now);
    expect((wb.getWorksheet('Jornadas')!.getCell('G11').value as ExcelJS.CellFormulaValue).result).toBe(2);
    const empty = await buildWorkbook({ sessions: [], audits: [] }, period, now);
    expect(empty.getWorksheet('Jornadas')!.getCell('G5').value).toBe(0);
  });
  it('divide auditorias grandes sem truncar pausas ilimitadas', async () => {
    const s = fixture(); s.breaks = Array.from({ length: 400 }, (_, i) => ({ ...s.breaks[0], reason: `Pausa ${i}` }));
    const a: AuditEntry = { id: 'a', sessionId: s.id, action: 'edit', reason: 'Correção', actor: 'test', recordedAt: now, before: null, after: s };
    const wb = await buildWorkbook({ sessions: [], audits: [a] }, period, now);
    const sheet = wb.getWorksheet('Auditoria')!;
    const text = Array.from({ length: sheet.rowCount - 4 }, (_, i) => sheet.getCell(`G${i + 5}`).value).join('');
    expect(text).toBe(JSON.stringify(s)); expect(sheet.rowCount).toBeGreaterThan(5);
  });
  it('não sobrescreve arquivo existente', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'journey-export-')); const path = join(folder, 'export.xlsx');
    try {
      const wb = await buildWorkbook({ sessions: [fixture()], audits: [] }, period, now);
      await saveNewWorkbook(wb, path); const original = await readFile(path);
      await expect(saveNewWorkbook(wb, path)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(path)).toEqual(original);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('preserva emojis quando uma auditoria atravessa o limite da célula', async () => {
    const s = fixture();
    s.breaks = Array.from({ length: 150 }, () => ({ ...s.breaks[0], reason: '😀'.repeat(100) }));
    // Place a UTF-16 surrogate pair exactly across the former 30000-unit split.
    for (let padding = 0; padding <= 300; padding++) {
      s.breaks[0].reason = 'a'.repeat(padding);
      if (JSON.stringify(s).charCodeAt(29999) === 0xd83d) break;
    }
    expect(JSON.stringify(s).charCodeAt(29999)).toBe(0xd83d);
    const a: AuditEntry = { id: 'emoji', sessionId: s.id, action: 'edit', reason: 'Conferência', actor: 'test', recordedAt: now, before: s, after: s };
    const wb = await buildWorkbook({ sessions: [], audits: [a] }, period, now);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await wb.xlsx.writeBuffer());
    const sheet = reopened.getWorksheet('Auditoria')!;
    for (const column of ['F', 'G']) {
      const text = Array.from({ length: sheet.rowCount - 4 }, (_, i) => sheet.getCell(`${column}${i + 5}`).value).join('');
      expect(JSON.stringify(JSON.parse(text)) === JSON.stringify(s), 'Auditoria deve preservar todos os caracteres após leitura do XLSX').toBe(true);
    }
  });
});
