import { useEffect, useState } from 'react';
import { t, message, usePresentation } from './i18n';
import { TIME_ZONE } from '../shared/contracts';

export function LanguageSettings() {
  const presentation = usePresentation();
  const [value, setValue] = useState(presentation.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setValue(presentation.value); }, [presentation.value]);
  return <section className="card" aria-label={t('presentation.title')}>
    <h3>{t('presentation.title')}</h3>
    <fieldset disabled={busy}>
      <div className="editor-grid">
        <label>{t('presentation.language')}<select aria-label={t('presentation.language')} value={value.language} onChange={event => { setSaved(false); setValue({ ...value, language: event.target.value as typeof value.language }); }}>
          <option value="pt-BR">Português (Brasil)</option><option value="en-US">English (United States)</option>
        </select></label>
        <label>{t('presentation.format')}<select aria-label={t('presentation.format')} value={value.formatLocale} onChange={event => { setSaved(false); setValue({ ...value, formatLocale: event.target.value as typeof value.formatLocale }); }}>
          <option value="pt-BR">{t('presentation.regionBrazil')}</option><option value="en-US">{t('presentation.regionUS')}</option>
        </select></label>
      </div>
      <p className="muted">{t('presentation.formatHelp')}</p>
      <p><strong>{t('presentation.zone')}</strong> · {TIME_ZONE}<br /><strong>{t('presentation.policy')}</strong> · {t('presentation.policyValue')}</p>
      <p className="muted">{t('presentation.explanation')}</p>
      {error && <p role="alert" className="alert error">{message(error)}</p>}
      {saved && <p role="status">{t('presentation.saved')}</p>}
      <button type="button" className="button secondary" onClick={() => {
        setBusy(true); setError(''); setSaved(false);
        void presentation.save(value).then(() => setSaved(true)).catch(err => setError(err instanceof Error ? err.message : t('error.save'))).finally(() => setBusy(false));
      }}>{t('presentation.apply')}</button>
    </fieldset>
  </section>;
}
