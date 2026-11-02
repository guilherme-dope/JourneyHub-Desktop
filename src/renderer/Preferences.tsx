import { ModalBoundary } from './ModalBoundary';
import { minutesSchema } from '../domain/work-policy';
import { t, message, usePresentation } from './i18n';
import { useTranslation } from 'react-i18next';
import { LanguageSettings } from './LanguageSettings';
import { useEffect, useState } from 'react';
import { type Preferences as Values } from '../shared/preferences';
import type { BackupResult } from '../shared/contracts';
function formatTarget(minutes: number) { return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0'); }

export function Preferences({ initial, reference, saveReference, referenceDisabled, save, close, local, backup, restore }: { initial: Values; reference: number; saveReference: (minutes: number) => Promise<void>; referenceDisabled: boolean; save: (value: Values) => Promise<void>; close: () => void; local: boolean; backup: () => Promise<BackupResult>; restore: () => Promise<BackupResult> }) {
  useTranslation(); usePresentation();
  const [value, setValue] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(() => formatTarget(reference));
  useEffect(() => setTarget(formatTarget(reference)), [reference, local]);
  async function applyTarget() {
    setError(''); setNotice('');
    if (!/^\d{1,2}:[0-5]\d$/.test(target)) { setError(t('reference.invalid')); return; }
    const [hours, minutes] = target.split(':').map(Number);
    const total = hours * 60 + minutes;
    if (!minutesSchema.safeParse(total).success) { setError(t('reference.invalid')); return; }
    setBusy(true);
    try { await saveReference(total); setNotice(t('reference.saved')); }
    catch (err) { setError(err instanceof Error ? err.message : t('error.save')); }
    finally { setBusy(false); }
  }
  async function manageBackup(restoring: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await (restoring ? restore() : backup());
      if (!result.cancelled) setNotice(restoring ? t('backup.restored', { path: result.recoveryPath }) : t('backup.created', { name: result.name }));
    } catch (err) { setError(err instanceof Error ? err.message : t('error.generic')); }
    finally { setBusy(false); }
  }
  return <ModalBoundary close={close} busy={busy}><form className="modal" role="dialog" aria-modal="true" aria-label={t('common.settings')} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await save(value); close(); } catch (err) { setError(err instanceof Error ? err.message : t('error.save')); } finally { setBusy(false); }
  }}><div className="section-heading"><h2>{t('common.settings')}</h2><button type="button" className="button secondary" disabled={busy} onClick={close}>{t('common.close')}</button></div>
    {error && <p role="alert" className="alert error">{message(error)}</p>}
    {notice && <p role="status" className="alert success" style={{ overflowWrap: 'anywhere' }}>{message(notice)}</p>}
    <fieldset disabled={busy}>
      <LanguageSettings />
      <section className="card"><h3>{t('data.title')}</h3><p>{t('data.help')}</p></section>
      <section className="card">
        <h3>{t('workday.reference')}</h3><p>{t('reference.help')}</p>
        <div className="filters"><label>{t('reference.hours')}<input value={target} placeholder="7:30" onChange={e => setTarget(e.target.value)} /></label>
        <button type="button" className="button secondary" disabled={referenceDisabled} onClick={() => void applyTarget()}>{t('reference.apply')}</button></div>
      </section>
      <section className="card" aria-label={t('sql.title')}>
        <h3>{t('sql.title')}</h3><p>{t(local ? 'sql.activeLocal' : 'sql.activeMssql')}</p><p>{t('sql.help')}</p>
        <p className="muted">{t('sql.fileHelp')}</p><p>{t('sql.singleUser')}</p>
        <button type="button" className="button secondary" onClick={() => {
          setBusy(true); setError(''); setNotice('');
          void window.journey.openExistingSql().then(result => {
            if (!result.ok) throw new Error(result.message);
            if (!result.value.cancelled) setNotice(t('sql.opened'));
          }).catch(err => setError(err instanceof Error ? err.message : t('error.generic'))).finally(() => setBusy(false));
        }}>{t('sql.open')}</button>
        {!local && <button type="button" className="button secondary" onClick={() => {
          setBusy(true); setError(''); setNotice('');
          void window.journey.useLocalStorage().then(result => {
            if (!result.ok) throw new Error(result.message);
            if (!result.value.cancelled) setNotice(t('sql.localActive'));
          }).catch(err => setError(err instanceof Error ? err.message : t('error.generic'))).finally(() => setBusy(false));
        }}>{t('sql.useLocal')}</button>}
      </section>
      {local && <section className="card" aria-label={t('backup.title')}>
        <h3>{t('backup.title')}</h3>
        <p>{t('backup.help')}</p>
        <p className="muted">{t('backup.restoreHelp')}</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={() => void manageBackup(false)}>{t('backup.create')}</button>
          <button type="button" className="button secondary" onClick={() => void manageBackup(true)}>{t('backup.restore')}</button>
        </div>
      </section>}
      <label className="checkbox"><input type="checkbox" checked={value.startWithWindows} onChange={e => setValue({ ...value, startWithWindows: e.target.checked })} />{t('settings.startup')}</label>
      <p className="muted">{t('settings.trayHelp')}</p>
      <div className="modal-actions"><button className="button primary">{t('common.saveSettings')}</button></div>
    </fieldset>
  </form></ModalBoundary>;
}
