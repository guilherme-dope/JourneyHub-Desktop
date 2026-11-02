import { useState } from 'react';
import { t, message } from './i18n';
import { defaultPreferences, type Preferences } from '../shared/preferences';

export function Notifications({ initial }: { initial: Preferences }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const days = [t('weekday.monday'), t('weekday.tuesday'), t('weekday.wednesday'), t('weekday.thursday'), t('weekday.friday'), t('weekday.saturday'), t('weekday.sunday')];
  return <form className="card notification-card" onChange={() => setSaved(false)} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const result = await window.journey.saveReminders({ reminders: value.reminders, week: value.week });
      if (!result.ok) throw new Error(result.message);
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? message(err.message) : t('error.save')); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy}><legend>{t('notifications.schedule')}</legend>
      <label className="checkbox"><input type="checkbox" checked={value.reminders} onChange={e => setValue({ ...value, reminders: e.target.checked })} />{t('settings.reminders')}</label>
      <p className="muted">{t('settings.reminderHelp')}</p>
      {days.map((day, i) => <div className="notification-row" key={day}><label className="checkbox"><input type="checkbox" checked={value.week[i] !== null} onChange={e => setValue({ ...value, week: value.week.map((v, n) => n === i ? e.target.checked ? defaultPreferences.week[i] ?? '08:00' : null : v) })} />{day}</label><label>{t('settings.startPrefix')} {day}<input type="time" disabled={value.week[i] === null} value={value.week[i] ?? ''} onChange={e => setValue({ ...value, week: value.week.map((v, n) => n === i ? e.target.value : v) })} required={value.week[i] !== null} /></label></div>)}
    <button className="button primary">{t('common.saveSettings')}</button>
    {saved && <p role="status">{t('notifications.saved')}</p>}
    {error && <p role="alert" className="alert error">{error}</p>}
    </fieldset>
  </form>;
}
