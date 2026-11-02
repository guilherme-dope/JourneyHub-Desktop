import { prepareSqlTest, sqlTestEnv, packagedExecutable, preparePortugueseProfile } from './test-environment.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
// Real Electron + real isolated SQL database. No mock database or IPC implementation.
const sqlite = process.argv.includes('--sqlite');
if (!sqlite) prepareSqlTest();
await mkdir('outputs/qa', { recursive: true });
const launchEnv = { ...process.env, JOURNEY_PROFILE: resolve(sqlite ? `outputs/qa/sqlite-${Date.now()}` : 'outputs/qa/e2e-profile') };
delete launchEnv.JOURNEY_ENV_FILE;
if (!sqlite) launchEnv.JOURNEY_ENV_FILE = sqlTestEnv;
delete launchEnv.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
await preparePortugueseProfile(launchEnv.JOURNEY_PROFILE);
const app = await electron.launch({ ...(packaged ? { executablePath: packagedExecutable, args: [] } : { args: ['.'] }), env: launchEnv });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await expect(page.locator('.sidebar-footer')).toContainText(sqlite ? 'Armazenamento local pronto' : 'SQL Server conectado');
  if (!sqlite) {
    expect(await page.evaluate(() => window.journey.backup())).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(await page.evaluate(() => window.journey.restoreBackup())).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Configurações' });
    await expect(settings.getByRole('button', { name: 'Criar backup', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: 'Fechar', exact: true }).click();
  }
  expect(await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process, methods: Object.keys(window.journey).sort() }))).toEqual({ node: 'undefined', process: 'undefined', methods: ['audit', 'backup', 'current', 'export', 'health', 'list', 'mutate', 'onDesktopEvent', 'onPresentationChange', 'openExistingSql', 'preferences', 'presentation', 'restoreBackup', 'rules', 'savePreferences', 'savePresentation', 'saveReference', 'saveReminders', 'trash', 'useLocalStorage'] });
  const preferencesButton = page.getByRole('button', { name: 'Configurações', exact: true });
  await preferencesButton.focus();
  await preferencesButton.click();
  const modal = page.getByRole('dialog', { name: 'Configurações' });
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press('Tab');
    expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(preferencesButton).toBeFocused();
  await page.getByRole('button', { name: 'Notificações', exact: true }).click();
  await page.getByLabel('Início — Segunda-feira', { exact: true }).fill('08:35');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('status')).toContainText('Lembretes salvos');
  await page.getByRole('button', { name: 'Minha jornada' }).click();
  await page.getByLabel('Consultar por', { exact: true }).selectOption('days');
  await expect(page.getByLabel('De', { exact: true })).toHaveCount(0);
  await page.getByLabel('Períodos rápidos').selectOption('14');
  await expect(page.getByLabel('Últimos dias', { exact: true })).toHaveValue('14');
  await page.getByRole('button', { name: 'Aplicar dias' }).click();
  await page.getByLabel('Consultar por', { exact: true }).selectOption('range');
  await expect.poll(async () => (Date.parse(await page.getByLabel('Até', { exact: true }).inputValue()) - Date.parse(await page.getByLabel('De', { exact: true }).inputValue())) / 86400000).toBe(13);
  await page.getByLabel('Consultar por', { exact: true }).selectOption('days');
  await page.getByLabel('Últimos dias', { exact: true }).fill('13');
  await page.getByRole('button', { name: 'Aplicar dias' }).click();
  await page.getByLabel('Consultar por', { exact: true }).selectOption('range');
  await expect(page.getByLabel('Últimos dias', { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const from = await page.getByLabel('De', { exact: true }).inputValue();
    const to = await page.getByLabel('Até', { exact: true }).inputValue();
    return (Date.parse(to) - Date.parse(from)) / 86400000;
  }).toBe(12);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Horas e minutos (h:mm)').fill('7:30');
  await page.getByRole('button', { name: 'Aplicar referência' }).click();
  await expect(page.getByRole('status')).toContainText('Referência salva');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const options = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  expect(options.contextIsolation).toBe(true); expect(options.sandbox).toBe(true); expect(options.nodeIntegration).toBe(false);
  const response = await page.evaluate(async () => window.journey.list({ from: '2010-01-01', to: '2014-12-31' }));
  expect(response.ok).toBe(true);
  const used = new Set(response.value.map(s => s.workDate));
  const deletedRecords = await page.evaluate(() => window.journey.trash());
  expect(deletedRecords.ok).toBe(true);
  const lastDay = [...response.value, ...deletedRecords.value].map(s => s.workDate).sort().at(-1);
  const date = new Date(`${lastDay && lastDay >= '2010-01-04' ? lastDay : '2010-01-04'}T12:00:00Z`);
  if (lastDay) date.setUTCDate(date.getUTCDate() + 1);
  while (used.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);
  await page.getByLabel('Informar outro horário').check();
  await page.getByLabel('Data e hora', { exact: true }).fill(`${day}T09:00`);
  await page.getByRole('button', { name: 'Iniciar jornada', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('Entrada: registro salvo');
  await page.getByLabel('Data e hora', { exact: true }).fill(`${day}T12:00`);
  await page.getByLabel('Descrição da pausa (opcional)', { exact: true }).fill('Almoço');
  await page.getByRole('button', { name: 'Iniciar pausa' }).click();
  await expect(page.getByRole('status')).toContainText('Pausa: registro salvo');
  await page.getByLabel('Data e hora', { exact: true }).fill(`${day}T13:00`);
  await page.getByRole('button', { name: 'Registrar retorno' }).click();
  await expect(page.getByRole('status')).toContainText('Retorno: registro salvo');
  await page.getByLabel('Data e hora', { exact: true }).fill(`${day}T18:00`);
  await page.getByRole('button', { name: 'Encerrar jornada' }).click();
  await expect(page.getByRole('status')).toContainText('Encerramento: registro salvo');
  await page.getByRole('button', { name: 'Histórico e relatórios' }).click();
  await page.getByLabel('De', { exact: true }).fill(day);
  await page.getByLabel('Até', { exact: true }).fill(day);
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  const row = page.locator('tbody tr').first();
  await expect(row).toContainText('08:00:00');
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Corrigir jornada' });
  await edit.getByLabel('Saída (vazio mantém aberta)').fill(`${day}T19:00`);
  await expect(edit.getByText('Por que você está alterando este registro?')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(edit).not.toBeVisible(); await expect(row).toContainText('09:00:00');
  // Invalid filters must retain both the verified connection and the last valid report.
  for (const invalid of [{ from: '2020-01-01', to: '2025-12-31' }, { from: '2026-10-26', to: '2026-10-01' }]) {
    await page.getByLabel('De', { exact: true }).fill(invalid.from);
    await page.getByLabel('Até', { exact: true }).fill(invalid.to);
    await page.getByRole('button', { name: 'Aplicar período' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.sidebar-footer')).toContainText(sqlite ? 'Armazenamento local pronto' : 'SQL Server conectado');
    await expect(page.getByRole('button', { name: 'Aplicar período' })).toBeEnabled();
    await expect(row).toContainText('09:00:00');
  }
  await page.getByLabel('De', { exact: true }).fill(day);
  await page.getByLabel('Até', { exact: true }).fill(day);
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await row.getByRole('button', { name: 'Editar', exact: true }).focus();
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const editorModal = page.getByRole('dialog');
  await page.keyboard.press('Shift+Tab');
  expect(await editorModal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Editar', exact: true })).toBeFocused();
  await row.getByRole('button', { name: 'Auditoria', exact: true }).focus();
  await row.getByRole('button', { name: 'Auditoria', exact: true }).click();
  const auditModal = page.getByRole('dialog');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await auditModal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await expect(page.getByRole('dialog', { name: 'Auditoria' })).toContainText('Linha do tempo da jornada');
  await page.getByRole('button', { name: 'Ver histórico administrativo' }).click();
  await expect(page.getByRole('dialog', { name: 'Auditoria' })).toContainText('Correção manual pelo usuário');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const target = resolve(`outputs/qa/export-${Date.now()}.xlsx`);
  // Replace only the native file picker; production export handler and writer run normally.
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
  await page.getByLabel('↓ Exportar Excel', { exact: true }).selectOption('full');
  await expect(page.getByRole('status')).toContainText('Planilha exportada:');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(target);
  expect(wb.getWorksheet('Jornadas').getCell('G5').value.getUTCHours()).toBe(9);
  expect(wb.getWorksheet('Pausas').rowCount).toBe(5);
  expect(wb.getWorksheet('Auditoria').rowCount).toBe(9);
  // Exercise both cancellation paths and the actual main-process double confirmation.
  async function setChoices(choices) {
    await app.evaluate(({ dialog }, responses) => {
      globalThis.deletePrompts = [];
      dialog.showMessageBox = async (_window, options) => { globalThis.deletePrompts.push(options.message); return { response: responses.shift() ?? 0, checkboxChecked: false }; };
    }, choices);
  }
  for (const choices of [[0], [1, 0]]) {
    await setChoices([...choices]);
    await row.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.deletePrompts.length)).toBe(choices.length);
    await expect(row.getByRole('button', { name: 'Excluir', exact: true })).toBeEnabled();
    await expect(row).toContainText('09:00:00');
    expect((await page.evaluate(p => window.journey.list(p), { from: day, to: day })).value).toHaveLength(1);
  }
  await setChoices([1, 1]);
  await row.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Exclusão: registro salvo');
  expect(await app.evaluate(() => globalThis.deletePrompts.length)).toBe(2);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.stat').first()).toContainText('00:00:00');
  await page.getByRole('button', { name: /Lixeira \(/ }).click();
  const trashRow = page.locator('tbody tr').filter({ hasText: day.split('-').reverse().join('/') });
  await expect(trashRow).toBeVisible();
  await page.screenshot({ path: resolve('outputs/qa/trash.png'), fullPage: true });
  await trashRow.getByRole('button', { name: 'Restaurar jornada' }).click();
  await expect(page.getByRole('status')).toContainText('Restauração: registro salvo');
  await expect(trashRow).toHaveCount(0);
  await page.getByRole('button', { name: 'Histórico e relatórios' }).click();
  await expect(row).toContainText('09:00:00');
  await page.screenshot({ path: resolve('outputs/qa/history.png'), fullPage: true });
  await page.getByRole('button', { name: 'Minha jornada' }).click();
  await page.screenshot({ path: resolve('outputs/qa/dashboard.png'), fullPage: true });
  // A retroactive complete session can be inserted before existing later sessions.
  await page.getByRole('button', { name: 'Adicionar jornada anterior' }).click();
  const add = page.getByRole('dialog', { name: 'Adicionar jornada anterior' });
  const older = new Date('2008-01-07T12:00:00Z');
  const olderRecords = await page.evaluate(() => window.journey.list({ from: '2008-01-01', to: '2009-12-31' }));
  expect(olderRecords.ok).toBe(true);
  const olderUsed = new Set(olderRecords.value.map(s => s.workDate));
  while (olderUsed.has(older.toISOString().slice(0, 10))) older.setUTCDate(older.getUTCDate() + 1);
  const olderDay = older.toISOString().slice(0, 10);
  await add.getByLabel('Entrada', { exact: true }).fill(`${olderDay}T09:00`);
  await add.getByLabel('Saída', { exact: true }).fill(`${olderDay}T17:00`);
  await add.getByLabel('Motivo do registro posterior').fill('Dia esquecido — teste de cadastro retroativo');
  await add.getByRole('button', { name: 'Salvar jornada' }).click();
  await expect(add).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('Jornada anterior: registro salvo');
  await page.setViewportSize({ width: 960, height: 720 });
  await page.screenshot({ path: resolve('outputs/qa/compact.png'), fullPage: true });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ packaged, electron: 'passed', provider: sqlite ? 'sqlite' : 'mssql', isolation: 'passed', workflow: 'passed', invalidFilterRecovery: 'passed', retroactive: 'passed', audit: 'passed', doubleConfirmation: 'passed', trashAndRestore: 'passed', export: target }, null, 2));
} finally { await app.close(); }
