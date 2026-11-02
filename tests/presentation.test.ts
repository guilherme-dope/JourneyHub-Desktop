import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pt from '../src/locales/pt-BR.json';
import en from '../src/locales/en-US.json';
import { detectPresentation, presentationSchema } from '../src/shared/presentation';
import { createTranslations, translateMessage, formatDate, formatInstant } from '../src/shared/i18n';
import { PresentationStore } from '../src/main/presentation-store';
import { calculate } from '../src/domain/journey';
import { buildWorkbook } from '../src/main/export';
import { fixture, now } from './fixtures';

it('detecta idioma suportado e utiliza inglês quando nenhum é suportado', () => {
  expect(detectPresentation(['pt-PT']).language).toBe('pt-BR');
  expect(detectPresentation(['en-GB']).language).toBe('en-US');
  expect(detectPresentation(['fr-FR']).language).toBe('en-US');
  expect(detectPresentation([]).language).toBe('en-US');
  const fallback = createTranslations('pt-BR'); fallback.removeResourceBundle('pt-BR', 'translation');
  expect(fallback.t('common.settings')).toBe('Settings');
});
it('mantém catálogos com as mesmas chaves e parâmetros', () => {
  expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(pt) as (keyof typeof pt)[]) {
    expect([...pt[key].matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort(), key).toEqual([...en[key].matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort());
    expect(en[key].trim().length, key).toBeGreaterThan(0);
  }
});
it('troca mensagens sem traduzir os parâmetros de texto do usuário', () => {
  const english = createTranslations('en-US');
  expect(translateMessage('Selecione um período de até cinco anos.', english)).toBe('Select a period of up to five years.');
  expect(english.t('timeline.pause', { reason: 'Configurações' })).toBe('Break: Configurações');
  expect(translateMessage('Planilha exportada: Configurações.xlsx', english)).toBe('Workbook exported: Configurações.xlsx');
  expect(translateMessage('Configure MSSQL_SERVER no arquivo .env local.', english)).toBe('Configure MSSQL_SERVER in the local .env file.');
});
it('persiste idioma e formato sem modificar preferências antigas e recusa campos de regras', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'journey-presentation-'));
  try {
    const original = '{"preferences":{"reminders":true},"day":"2026-10-27","next":null}';
    await writeFile(join(folder, 'desktop-settings.json'), original);
    const path = join(folder, 'presentation-v1.json');
    const store = new PresentationStore(path, detectPresentation(['pt-BR']));
    await store.load();
    await store.save({ version: 1, language: 'en-US', formatLocale: 'pt-BR' });
    const reopened = new PresentationStore(path, detectPresentation(['fr-FR'])); await reopened.load();
    expect(reopened.value).toEqual({ version: 1, language: 'en-US', formatLocale: 'pt-BR' });
    expect(await readFile(join(folder, 'desktop-settings.json'), 'utf8')).toBe(original);
    expect(() => presentationSchema.parse({ ...reopened.value, timeZone: 'Europe/Paris' })).toThrow();
  } finally { await rm(folder, { recursive: true, force: true }); }
});
it('formata datas e instantes sem deslocar o dia nem alterar cálculos', () => {
  const session = fixture(); const before = structuredClone(session);
  const totals = calculate(session, now);
  expect(formatDate('2026-10-26', 'en-US')).toBe('10/26/2026');
  expect(formatDate('2026-10-26', 'pt-BR')).toBe('26/10/2026');
  expect(formatInstant('2026-10-26T12:00:00Z', 'en-US', 'America/Sao_Paulo')).toContain('09:00:00');
  expect(calculate(session, now)).toEqual(totals); expect(session).toEqual(before);
});
it('exporta cabeçalhos em inglês e formato brasileiro preservando valores e texto literal', async () => {
  const session = fixture({ notes: '=Configurações' }); session.breaks[0].reason = 'Entrada';
  const original = structuredClone(session);
  const workbook = await buildWorkbook({ sessions: [session], audits: [] }, { from: session.workDate, to: session.workDate }, now, { version: 1, language: 'en-US', formatLocale: 'pt-BR' });
  const sheet = workbook.getWorksheet('Workdays')!;
  expect(sheet.getCell('L5').value).toBe('=Configurações');
  expect(sheet.getCell('A5').numFmt).toBe('dd/mm/yyyy');
  expect(sheet.getCell('G5').value).toBe(8 / 24);
  expect(workbook.getWorksheet('Breaks')!.getCell('E5').value).toBe('Entrada');
  expect(session).toEqual(original);
});
