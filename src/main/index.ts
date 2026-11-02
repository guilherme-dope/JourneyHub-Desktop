import { Desktop } from './desktop';

import { preferencesSchema } from '../shared/preferences';
import { PreferenceStore } from './preferences';

import { mkdirSync, appendFileSync, existsSync } from 'node:fs';

import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';

import { join, basename, resolve } from 'node:path';

import { pathToFileURL } from 'node:url';

import { config as dotenv } from 'dotenv';

import { Database } from './database';

import { JourneyRepository } from './repository';

import { buildWorkbook, saveNewWorkbook } from './export';

import { commandSchema, exportSchema, idSchema, periodSchema } from '../shared/contracts';

import { clockNow } from '../shared/time';

import { safeError, trustedSender } from './security';

import { minutesSchema, nextWorkDate } from '../domain/work-policy';
import { DomainError } from '../domain/journey';
import { SqliteJourneyRepository } from './sqlite-repository';
import { selectStorage, saveSelection, replaceSelection } from './storage-selection';
import type { JourneyPersistence } from './persistence';
import { activeSqlitePath } from './sqlite-files';
import { prepareRestore } from './sqlite-backup';
import { unlink } from 'node:fs/promises';
import { windowsStartupOptions } from './windows-startup';
import { connectExistingSql } from './existing-sql';
import { PresentationStore } from './presentation-store';
import { detectPresentation } from '../shared/presentation';
import { createTranslations, translateMessage } from '../shared/i18n';

const translations = createTranslations('en-US');
const t = (key: string, values?: Record<string, unknown>) => translations.t(key, values);

let db: { close(): Promise<void> };

let desktop: Desktop;
let quitting = false;

const standardProfile = app.getPath('userData');
const profileArgument = process.argv.find(arg => arg.startsWith('--journey-profile='))?.slice('--journey-profile='.length);
const requestedProfile = profileArgument || process.env.JOURNEY_PROFILE;
if (requestedProfile) { const path = resolve(requestedProfile); mkdirSync(path, { recursive: true }); app.setPath('userData', path); }
else if (!app.isPackaged) { app.setPath('userData', join(app.getPath('userData'), 'development')); }

let window: BrowserWindow | null = null;


if (!app.requestSingleInstanceLock()) app.quit();

else {

  app.on('second-instance', () => { desktop?.show(); });

  app.whenReady().then(async () => {
    app.setAppUserModelId('local.journeyhub.desktop');

    const profile = app.getPath('userData');
    mkdirSync(profile, { recursive: true });
    const legacy = existsSync(join(profile, 'storage-v1.json')) || existsSync(join(profile, 'desktop-settings.json')) || existsSync(join(profile, '.env'));
    const defaults = legacy ? { version: 1 as const, language: 'pt-BR' as const, formatLocale: 'pt-BR' as const } : detectPresentation(app.getPreferredSystemLanguages());
    const presentationPath = join(profile, 'presentation-v1.json');
    const presentation = new PresentationStore(presentationPath, defaults);
    await presentation.load();
    if (!existsSync(presentationPath)) await presentation.save(presentation.value);
    await translations.changeLanguage(presentation.value.language);
    let selected;
    try { selected = await selectStorage(profile, process.env.JOURNEY_ENV_FILE); }
    catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'LEGACY_PROFILE') throw error;
      const result = await dialog.showOpenDialog({ title: t('settings.recoverSql'), properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0]) { app.quit(); return; }
      selected = await selectStorage(profile, result.filePaths[0]);
    }
    let repo: JourneyPersistence;
    if (selected.selection.provider === 'mssql') {
      const settings = dotenv({ path: selected.selection.envFile, quiet: true }).parsed;
      if (!settings) throw new DomainError('CONFIG', t('error.sqlRead'));
      const sql = new Database(settings);
      db = sql;
      repo = new JourneyRepository(sql);
    } else {
      const sqlite = new SqliteJourneyRepository(activeSqlitePath(profile));
      db = sqlite;
      repo = sqlite;
    }
    if (!selected.existing) await saveSelection(profile, selected.selection);

    const store = new PreferenceStore(join(app.getPath('userData'), 'desktop-settings.json'));

    await store.load();

    const pagePath = join(__dirname, '../renderer/index.html');

    const pageUrl = pathToFileURL(pagePath).href;

    session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));

    session.defaultSession.setPermissionCheckHandler(() => false);

    window = new BrowserWindow({ show: !process.argv.includes('--background'), width: 1280, height: 880, minWidth: 960, minHeight: 680, title: 'JourneyHub', icon: join(__dirname, '../assets/icon.png'), backgroundColor: '#f4f5f1', autoHideMenuBar: true,

      webPreferences: { preload: join(__dirname, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    window.webContents.on('will-navigate', event => event.preventDefault());

    window.webContents.on('will-attach-webview', event => event.preventDefault());

    let operationQueue: Promise<void> = Promise.resolve();
    function serialize<T>(operation: () => Promise<T>): Promise<T> {
      const work = operationQueue.then(operation);
      operationQueue = work.then(() => {}, () => {});
      return work;
    }
    async function activate(next: JourneyPersistence, connection: { close(): Promise<void> }, selection: Parameters<typeof replaceSelection>[1]) {
      try { await replaceSelection(profile, selection); }
      catch (error) { await connection.close(); throw error; }
      const previous = db;
      repo = next; db = connection;
      delete process.env.JOURNEY_ENV_FILE;
      try { await previous.close(); } catch { desktop.log('previous-storage-close-failed'); }
      window!.webContents.send('desktop:refresh');
    }

    const handle = (channel: string, action: (payload: unknown) => Promise<unknown>) => ipcMain.handle(channel, async (event, payload) => {

      try {

        if (!window || !trustedSender(event.sender.id, event.senderFrame === window.webContents.mainFrame, event.senderFrame?.url, window.webContents.id, pageUrl)) throw new DomainError('FORBIDDEN', t('error.forbidden'));

        return { ok: true, value: await serialize(() => action(payload)) };

      } catch (error) { return safeError(error, value => translateMessage(value, translations)); }

    });

    handle('reference:get', async () => repo.rules());
    handle('reference:save', async payload => {
      const minutes = minutesSchema.parse(payload);
      if (!(await repo.health()).ready) throw new DomainError('DATABASE_NOT_READY', t('error.query'));
      await repo.saveRule({ from: nextWorkDate(clockNow()), minutes });
    });
    handle('desktop:get', async () => store.value.preferences);

    handle('desktop:reminders', async payload => desktop.configure({
      ...store.value.preferences, ...preferencesSchema.pick({ reminders: true, week: true }).strict().parse(payload)
    }));
    handle('desktop:save', async payload => desktop.configure(payload));
    handle('storage:open-existing-sql', async () => {
      const chosen = await dialog.showOpenDialog(window!, { title: t('sql.choose'), properties: ['openFile'] });
      if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true };
      const confirmation = await dialog.showMessageBox(window!, { type: 'question', title: t('sql.title'), message: t('sql.confirm'), detail: t('sql.help'), buttons: [t('common.cancel'), t('desktop.open')], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response !== 1) return { cancelled: true };
      const connection = await connectExistingSql(chosen.filePaths[0]);
      await activate(connection.repository, connection.database, { version: 1, provider: 'mssql', envFile: resolve(chosen.filePaths[0]) });
      return { cancelled: false };
    });
    handle('storage:use-local', async () => {
      const confirmation = await dialog.showMessageBox(window!, { type: 'question', title: t('sql.localTitle'), message: t('sql.localConfirm'), buttons: [t('common.cancel'), t('sql.useLocal')], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response !== 1) return { cancelled: true };
      const local = new SqliteJourneyRepository(activeSqlitePath(profile));
      await activate(local, local, { version: 1, provider: 'sqlite' });
      return { cancelled: false };
    });
    handle('presentation:get', async () => presentation.value);
    handle('presentation:save', async payload => {
      const value = await presentation.save(payload);
      await translations.changeLanguage(value.language);
      desktop.updateLanguage();
      window!.webContents.send('presentation:changed', value);
      return value;
    });

    handle('storage:backup', async () => {
      if (!(repo instanceof SqliteJourneyRepository)) throw new DomainError('UNSUPPORTED', t('error.localOnly'));
      const result = await dialog.showSaveDialog(window!, {
        title: t('backup.saveTitle'), defaultPath: `JourneyHub_backup_${Date.now()}.sqlite`,
        filters: [{ name: t('backup.fileType'), extensions: ['sqlite'] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      const destination = result.filePath.toLowerCase().endsWith('.sqlite') ? result.filePath : `${result.filePath}.sqlite`;
      await repo.createBackup(destination);
      return { cancelled: false, name: basename(destination) };
    });

    handle('storage:restore', async () => {
      if (!(repo instanceof SqliteJourneyRepository)) throw new DomainError('UNSUPPORTED', t('error.localOnly'));
      const chosen = await dialog.showOpenDialog(window!, { title: t('backup.openTitle'), properties: ['openFile'], filters: [{ name: t('backup.fileType'), extensions: ['sqlite'] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true };
      const candidate = await prepareRestore(chosen.filePaths[0], profile);
      try {
        const confirmation = await dialog.showMessageBox(window!, {
          type: 'warning', title: t('backup.confirmTitle'), message: t('backup.confirm'),
          detail: t('backup.summary', { ...candidate.summary }),
          buttons: [t('common.cancel'), t('backup.restore')], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (confirmation.response !== 1) return { cancelled: true };
        const recoveryPath = await repo.restoreBackup(candidate.path, profile);
        window!.webContents.send('desktop:refresh');
        return { cancelled: false, recoveryPath };
      } finally {
        if (activeSqlitePath(profile) !== candidate.path) await unlink(candidate.path).catch(() => {});
      }
    });

    handle('journey:health', async () => { const value = await repo.health(); return { ...value, message: translateMessage(value.message, translations) }; });

    handle('journey:list', async payload => repo.list(periodSchema.parse(payload)));

    handle('journey:current', async () => repo.current());

    handle('journey:trash', async () => repo.trash());

    handle('journey:mutate', async payload => {

      const command = commandSchema.parse(payload);

      if (command.type === 'delete') {

        const first = await dialog.showMessageBox(window!, { type: 'warning', title: t('delete.title'), message: t('delete.question'), detail: t('delete.detail'), buttons: [t('common.cancel'), t('delete.next')], defaultId: 0, cancelId: 0, noLink: true });

        if (first.response !== 1) throw new DomainError('CANCELLED', t('error.cancelled'));

        const second = await dialog.showMessageBox(window!, { type: 'warning', title: t('delete.confirmTitle'), message: t('delete.confirm'), detail: t('delete.finalHelp'), buttons: [t('common.cancel'), t('delete.title')], defaultId: 0, cancelId: 0, noLink: true });

        if (second.response !== 1) throw new DomainError('CANCELLED', t('error.cancelled'));

      }

      return repo.mutate(command);

    });

    handle('journey:audit', async payload => repo.audit(idSchema.parse(payload).id));

    handle('journey:export', async payload => {

      const { mode, ...period } = exportSchema.parse(payload);

      const report = mode === 'full' ? await repo.report(period) : { sessions: await repo.list(period), audits: [] };

      const result = await dialog.showSaveDialog(window!, { title: t('export.title'), defaultPath: `${t('export.filePrefix')}_${period.from}_${period.to}_${Date.now()}.xlsx`, filters: [{ name: t('export.fileType'), extensions: ['xlsx'] }] });

      if (result.canceled || !result.filePath) return { cancelled: true };

      const path = result.filePath.toLowerCase().endsWith('.xlsx') ? result.filePath : `${result.filePath}.xlsx`;

      await saveNewWorkbook(await buildWorkbook(report, period, clockNow(), presentation.value, await repo.rules(), mode), path);

      return { cancelled: false, name: basename(path) };

    });

    desktop = new Desktop(store, { health: () => serialize(() => repo.health()), current: () => serialize(() => repo.current()), list: period => serialize(() => repo.list(period)), mutate: command => serialize(() => repo.mutate(command)) }, window, windowsStartupOptions(profile, standardProfile, process.execPath), t);

    await window.loadFile(pagePath);

    window.on('closed', () => { window = null; });

  }).catch(error => {
    if (quitting) return;
    try {
      const folder = join(app.getPath('userData'), 'logs'); mkdirSync(folder, { recursive: true });
      const frames = error instanceof Error ? error.stack?.split('\n').filter(line => line.trim().startsWith('at ')).join('\n') : '';
      appendFileSync(join(folder, 'startup.log'), `${new Date().toISOString()} startup-failed\n${frames ?? ''}\n`);
    } catch { /* Startup diagnostics never prevent a controlled exit. */ }
    dialog.showErrorBox('JourneyHub', error instanceof DomainError ? translateMessage(error.message, translations) : t('error.startup')); app.quit();
  });

  app.on('window-all-closed', () => {});

  app.on('before-quit', () => { quitting = true; void db?.close(); });

}
