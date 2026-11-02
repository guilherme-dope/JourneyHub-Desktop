import { app, BrowserWindow, dialog, Menu, nativeImage, powerMonitor, Tray } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PreferenceStore } from './preferences';
import { ReminderService } from './reminders';
import type { JourneyPersistence } from './persistence';
import { preferencesSchema } from '../shared/preferences';
import { DomainError } from '../domain/journey';

export class Desktop {
  private tray: Tray;
  private timer: NodeJS.Timeout;
  private quitting = false;
  private configurationQueue: Promise<void> = Promise.resolve();
  constructor(readonly store: PreferenceStore, repo: Pick<JourneyPersistence, 'health' | 'current' | 'list' | 'mutate'>, private window: BrowserWindow, private startup: { name: string; path: string; args: string[] }, private t: (key: string) => string) {
    this.tray = new Tray(nativeImage.createFromPath(join(__dirname, '../assets/icon.png')));
    this.tray.on('click', () => this.show());
    this.updateLanguage();
    window.on('close', event => { if (!this.quitting) { event.preventDefault(); window.hide(); } });
    window.on('minimize', () => window.hide());
    window.on('session-end', () => { this.quitting = true; });
    app.on('before-quit', () => { this.quitting = true; clearInterval(this.timer); this.tray.destroy(); });
    const reminder = new ReminderService(store, repo, async () => {
      const result = await dialog.showMessageBox({ title: this.t('reminder.title'), message: this.t('reminder.question'), detail: this.t('reminder.detail'), buttons: [this.t('reminder.ignore'), this.t('reminder.snooze'), this.t('reminder.start')], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 2 ? 'start' : result.response === 1 ? 'snooze' : 'ignore';
    }, () => { this.show(); window.webContents.send('desktop:refresh'); }, event => {
      this.log(event);
      if (event === 'reminder-start-failed') {
        this.show(); window.webContents.send('desktop:refresh');
        dialog.showErrorBox('JourneyHub', this.t('reminder.failed'));
      }
    });
    const tick = () => void reminder.tick();
    this.timer = setInterval(tick, 30000); this.timer.unref();
    powerMonitor.on('resume', tick);
    void reminder.tick();
  }
  updateLanguage() {
    this.tray.setToolTip(this.t('desktop.tooltip'));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: this.t('desktop.open'), click: () => this.show() },
      { label: this.t('common.settings'), click: () => { this.show(); this.window.webContents.send('desktop:settings'); } },
      { type: 'separator' }, { label: this.t('desktop.quit'), click: () => app.quit() },
    ]));
  }
  show() { if (this.window.isMinimized()) this.window.restore(); this.window.show(); this.window.focus(); }
  log(event: string) {
    try {
      const folder = join(app.getPath('userData'), 'logs'); mkdirSync(folder, { recursive: true });
      const path = join(folder, 'desktop.log');
      if (existsSync(path) && require('node:fs').statSync(path).size > 256000) renameSync(path, `${path}.previous`);
      appendFileSync(path, `${new Date().toISOString()} ${event}\n`);
    } catch { /* Diagnostics must not interrupt persistence or reveal credentials. */ }
  }
  async configure(raw: unknown) {
    const preferences = preferencesSchema.parse(raw);
    const work = this.configurationQueue.then(() => this.applyPreferences(preferences));
    this.configurationQueue = work.then(() => {}, () => {});
    return work;
  }
  private async applyPreferences(preferences: ReturnType<typeof preferencesSchema.parse>) {
    if (preferences.startWithWindows && !app.isPackaged) throw new DomainError('VALIDATION', this.t('error.install'));
    const isRegistered = () => app.getLoginItemSettings({ path: this.startup.path }).launchItems.some(item => item.name === this.startup.name && item.scope === 'user' && item.enabled);
    const before = isRegistered();
    const previousPreferences = this.store.value.preferences;
    await this.store.configure(preferences);
    try {
      if (before !== preferences.startWithWindows || preferences.startWithWindows || previousPreferences.startWithWindows) {
        app.setLoginItemSettings({ openAtLogin: preferences.startWithWindows, ...this.startup });
      }
      if (isRegistered() !== preferences.startWithWindows) throw new DomainError('STARTUP', this.t('error.windows'));
    } catch (error) {
      this.log('startup-config-failed');
      app.setLoginItemSettings({ openAtLogin: before, ...this.startup });
      await this.store.configure(previousPreferences);
      throw error;
    }
    return preferences;
  }
}
