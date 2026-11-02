import type { DailyRule } from '../domain/work-policy';
import ExcelJS from 'exceljs';
import { open, unlink } from 'node:fs/promises';
import { calculate } from '../domain/journey';
import { displayTime, duration, localInput, secondsBetween } from '../shared/time';
import { TIME_ZONE, type Period, type Report } from '../shared/contracts';
import { createTranslations, formatDate, formatInstant } from '../shared/i18n';
import type { Presentation } from '../shared/presentation';

function excelTextParts(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 30000, text.length);
    // Never separate the UTF-16 halves of an emoji when each cell becomes UTF-8 XML.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
function auditJson(value: unknown): string {
  // JSON escapes preserve supplementary characters through ExcelJS's chunked XML reader.
  return JSON.stringify(value).replace(/[\uD800-\uDFFF]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function buildWorkbook(report: Report, period: Period, generatedAt: string, presentation: Presentation = { version: 1, language: 'pt-BR', formatLocale: 'pt-BR' }, rules: DailyRule[] = [], mode: 'summary' | 'full' = 'full'): Promise<ExcelJS.Workbook> {
  const translations = createTranslations(presentation.language);
  const t = (key: string, values?: Record<string, unknown>) => translations.t(key, values);
  const dateFormat = presentation.formatLocale === 'en-US' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
  const timeFormat = presentation.formatLocale === 'en-US' ? `${dateFormat} hh:mm:ss AM/PM` : `${dateFormat} hh:mm:ss`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JourneyHub'; wb.created = new Date(generatedAt);
  wb.calcProperties.fullCalcOnLoad = true;
  const summary = wb.addWorksheet(t('export.sessions'));
  if (mode === 'summary') {
    summary.addRow([t('export.summary')]);
    summary.addRow([t('export.period', { from: formatDate(period.from, presentation.formatLocale), to: formatDate(period.to, presentation.formatLocale), zone: TIME_ZONE })]);
    summary.addRow([t('export.totalHelp')]);
    summary.addRow([t('common.date'), t('common.status'), t('export.net'), t('export.breaks'), t('export.balance')]);
    let worked = 0, paused = 0, balance = 0;
    for (const session of [...report.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      const c = calculate(session, generatedAt, rules);
      const row = summary.addRow([new Date(session.workDate + 'T00:00:00Z'), t(session.endedAt ? 'state.closed' : 'state.openPartial'),
        session.endedAt ? c.worked / 86400 : null, session.endedAt ? c.paused / 86400 : null, session.endedAt ? c.balance! / 3600 : null]);
      row.getCell(1).numFmt = dateFormat;
      row.getCell(3).numFmt = row.getCell(4).numFmt = '[h]:mm:ss';
      row.getCell(5).numFmt = '0.00;[Red]-0.00;0.00';
      if (session.endedAt) { worked += c.worked; paused += c.paused; balance += c.balance!; }
    }
    const total = summary.addRow([t('export.total'), null, worked / 86400, paused / 86400, balance / 3600]);
    total.getCell(3).numFmt = total.getCell(4).numFmt = '[h]:mm:ss';
    total.getCell(5).numFmt = '0.00;[Red]-0.00;0.00';
    summary.columns.forEach(column => { column.width = 24; });
    summary.views = [{ state: 'frozen', ySplit: 4 }];
    summary.getRow(4).font = { bold: true };
    return wb;
  }
  const pauses = wb.addWorksheet(t('export.breaks'));
  const audit = wb.addWorksheet(t('export.audit'));
  summary.addRow([t('export.heading')]);
  summary.addRow([t('export.period', { from: formatDate(period.from, presentation.formatLocale), to: formatDate(period.to, presentation.formatLocale), zone: TIME_ZONE })]);
  summary.addRow([t('export.totalHelp')]);
  summary.addRow([t('common.date'), t('action.start'), t('common.exit'), t('common.status'), t('common.gross'), t('export.breaks'), t('export.net'), t('common.expected'), t('common.extra'), t('common.deficit'), t('export.balance'), t('common.notes'), t('export.id')]);
  pauses.addRow([t('export.pausesHeading')]);
  pauses.addRow([t('export.pauseHelp', { zone: TIME_ZONE })]);
  pauses.addRow([]);
  pauses.addRow([t('trash.workDate'), t('common.start'), t('action.resume'), t('common.duration'), t('common.reason'), t('export.sessionId'), t('export.breakId')]);
  audit.addRow([t('export.auditHeading')]);
  audit.addRow([t('export.jsonHelp')]);
  audit.addRow([]);
  audit.addRow([t('export.recorded'), t('export.action'), t('common.reason'), t('export.author'), t('export.sessionId'), t('export.before'), t('export.after'), t('export.part')]);
  const totals = { gross: 0, paused: 0, worked: 0, expected: 0, extra: 0, deficit: 0, balance: 0 };
  for (const s of [...report.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const c = calculate(s, generatedAt, rules);
    // Excel dates have no timezone; serialize the documented São Paulo wall time.
    const row = summary.addRow([new Date(`${s.workDate}T00:00:00Z`), new Date(`${localInput(s.startedAt)}Z`), s.endedAt ? new Date(`${localInput(s.endedAt)}Z`) : null, s.endedAt ? t('state.closed') : t('state.openPartial'),
      ...(['gross', 'paused', 'worked', 'expected', 'extra', 'deficit'] as const).map(key => s.endedAt ? c[key]! / 86400 : null),
      s.endedAt ? c.balance! / 3600 : null, s.notes || null, s.id]);
    row.getCell(1).numFmt = dateFormat; row.getCell(2).numFmt = timeFormat; row.getCell(3).numFmt = timeFormat;
    for (let col = 5; col <= 10; col++) row.getCell(col).numFmt = '[h]:mm:ss';
    row.getCell(11).numFmt = '0.00;[Red]-0.00;0.00';
    if (s.endedAt) for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += c[key]!;
    for (const b of s.breaks) {
      const p = pauses.addRow([new Date(`${s.workDate}T00:00:00Z`), new Date(`${localInput(b.startedAt)}Z`), b.endedAt ? new Date(`${localInput(b.endedAt)}Z`) : null, b.endedAt ? secondsBetween(b.startedAt, b.endedAt) / 86400 : null, b.reason, s.id, b.id]);
      p.getCell(1).numFmt = dateFormat; p.getCell(2).numFmt = timeFormat; p.getCell(3).numFmt = timeFormat;
      p.getCell(4).numFmt = '[h]:mm:ss';
    }
  }
  const last = summary.rowCount;
  const total = summary.addRow([t('export.total')]);
  for (const [i, key] of (['gross', 'paused', 'worked', 'expected', 'extra', 'deficit', 'balance'] as const).entries()) {
    const col = i + 5;
    const cell = total.getCell(col);
    const letter = cell.address.replace(/\d/g, '');
    cell.value = report.sessions.length ? { formula: `SUM(${letter}5:${letter}${last})`, result: totals[key] / (key === 'balance' ? 3600 : 86400) } : 0;
    cell.numFmt = key === 'balance' ? '0.00;[Red]-0.00;0.00' : '[h]:mm:ss';
  }
  if (!report.sessions.length) summary.addRow([t('export.empty')]);
  summary.addRow([t('export.generated', { time: formatInstant(generatedAt, presentation.formatLocale, TIME_ZONE), duration: duration(totals.worked) })]);
  for (const a of report.audits) {
    // Excel limits a cell to 32767 characters; split large unlimited-pause snapshots losslessly.
    const before = excelTextParts(a.before ? auditJson(a.before) : '');
    const after = excelTextParts(auditJson(a.after));
    const count = Math.max(1, before.length, after.length);
    const labels: Record<string, string> = { start: t('action.start'), create: t('action.late'), pause: t('action.pause'), resume: t('action.resume'), finish: t('action.finish'), edit: t('action.edit'), delete: t('action.delete'), restore: t('action.restore') };
    for (let i = 0; i < count; i++) audit.addRow([a.recordedAt, labels[a.action] ?? a.action, a.reason, a.actor, a.sessionId, before[i] ?? null, after[i] ?? null, `${i + 1}/${count}`]);
  }
  for (const sheet of wb.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    sheet.getRow(1).font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF183C35' } };
    sheet.getRow(1).height = 28;
    sheet.getRow(2).height = 22;
    sheet.getRow(4).height = 30;
    sheet.getRow(4).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183C35' } }; cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
    sheet.columns.forEach((col, i) => { col.width = i === 0 ? 18 : 24; });
    sheet.eachRow((row, n) => { if (n > 4) { row.height = 26; row.eachCell(cell => { cell.font = { name: 'Arial', size: 10 }; cell.alignment = { vertical: 'middle' }; }); } });
    if (sheet.rowCount >= 5) sheet.autoFilter = { from: 'A4', to: { row: sheet === summary ? Math.max(4, last) : sheet.rowCount, column: sheet.columnCount } };
  }
  summary.getColumn(12).width = 54; summary.getColumn(13).hidden = true;
  pauses.getColumn(5).width = 54; pauses.getColumn(6).hidden = true; pauses.getColumn(7).hidden = true;
  audit.getColumn(1).width = 27; audit.getColumn(3).width = 54; audit.getColumn(4).width = 28; audit.getColumn(5).width = 43;
  audit.getColumn(6).width = 72; audit.getColumn(7).width = 72;
  audit.getColumn(6).hidden = true; audit.getColumn(7).hidden = true;
  // User-entered notes/reasons can be long; wrap and size their rows instead of clipping.
  for (const [sheet, column, endRow, chars] of [[summary, 12, last, 60], [pauses, 5, pauses.rowCount, 60], [audit, 3, audit.rowCount, 60]] as const) {
    for (let n = 5; n <= endRow; n++) {
      const row = sheet.getRow(n); const cell = row.getCell(column);
      cell.alignment = { vertical: 'middle', wrapText: true };
      const lines = String(cell.value ?? '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0);
      row.height = Math.max(26, Math.min(409, lines * 14 + 10));
    }
  }
  total.font = { name: 'Arial', size: 10, bold: true };
  return wb;
}
export async function saveNewWorkbook(wb: ExcelJS.Workbook, path: string): Promise<void> {
  const data = await wb.xlsx.writeBuffer();
  const file = await open(path, 'wx');
  try { await file.writeFile(Buffer.from(data)); await file.sync(); }
  catch (error) { await file.close(); await unlink(path).catch(() => {}); throw error; }
  await file.close();
}
