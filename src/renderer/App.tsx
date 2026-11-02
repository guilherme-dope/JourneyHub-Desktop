import { ModalBoundary } from './ModalBoundary';
import { Notifications } from './Notifications';
import { expectedSeconds, nextWorkDate, referenceMinutes, type DailyRule } from '../domain/work-policy';
import { t, message, displayTime, dateLabel, numberLabel, clockLabel, usePresentation } from './i18n';
import { useTranslation } from 'react-i18next';
import { Preferences } from './Preferences';
import type { Preferences as DesktopPreferences } from '../shared/preferences';
import { operationalTimeline } from '../domain/timeline';
import { useEffect, useRef, useState } from 'react';
import type { AuditEntry, Command, Health, JourneyApi, Period, Result, WorkSession } from '../shared/contracts';
import { TIME_ZONE } from '../shared/contracts';
import { calculate, lastDays, state, validatePeriod } from '../domain/journey';
import { clockNow, duration, fromLocal, localDate, localInput } from '../shared/time';

declare global { interface Window { journey: JourneyApi } }
const statusLabel = () => ({ working: t('state.working'), paused: t('state.paused'), closed: t('state.closed') });
const actionLabel = (): Record<string, string> => ({ start: t('action.start'), create: t('action.create'), pause: t('action.pause'), resume: t('action.resume'), finish: t('action.finish'), edit: t('action.edit'), delete: t('action.delete'), restore: t('action.restore') });
class ApiError extends Error { constructor(public code: string, message: string) { super(message); } }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new ApiError(result.code, result.message); return result.value; }
function errorText(error: unknown): string { return error instanceof RangeError ? t('error.validation') : error instanceof Error ? message(error.message) : t('error.generic'); }

export function App() {
  useTranslation(); usePresentation();
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  async function showPreferences() { await run(async () => setPreferences(unwrap(await window.journey.preferences()))); }
  const [rules, setRules] = useState<DailyRule[]>([]);
  const [reminders, setReminders] = useState<DesktopPreferences | null>(null);
  const [days, setDays] = useState('7');
  const [queryMode, setQueryMode] = useState('range');
  async function showNotifications() {
    await run(async () => { setReminders(unwrap(await window.journey.preferences())); setTab('notifications'); });
  }
  function applyDays(count: number) {
    void run(async () => {
      const next = lastDays(clockNow(), count);
      await load(next); setPeriod(next);
    });
  }
  const today = localDate(clockNow());
  const [tab, setTab] = useState<'today' | 'history' | 'trash' | 'notifications'>('today');
  const [health, setHealth] = useState<Health | null>(null);
  const [current, setCurrent] = useState<WorkSession | null>(null);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [trash, setTrash] = useState<WorkSession[]>([]);
  const [period, setPeriod] = useState<Period>({ from: `${today.slice(0, 7)}-01`, to: today });
  const [loadedPeriod, setLoadedPeriod] = useState(period);
  const [now, setNow] = useState(clockNow());
  const [manual, setManual] = useState(false);
  const [at, setAt] = useState(localInput(clockNow()));
  const [pauseReason, setPauseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<WorkSession | null>(null);
  const [audits, setAudits] = useState<AuditEntry[] | null>(null);
  const [auditTitle, setAuditTitle] = useState('');
  const [auditSession, setAuditSession] = useState<WorkSession | null>(null);
  const [administrative, setAdministrative] = useState(false);
  useEffect(() => { const id = setInterval(() => setNow(clockNow()), 1000); return () => clearInterval(id); }, []);
  async function load(p: Period) {
    if (!window.journey) throw new Error(t('error.electron'));
    const h = unwrap(await window.journey.health());
    setHealth(h);
    if (!h.ready) { setCurrent(null); setSessions([]); setTrash([]); return; }
    const [c, list, deleted, policy] = await Promise.all([window.journey.current(), window.journey.list(p), window.journey.trash(), window.journey.rules()]);
    // Resolve every response before replacing the visible snapshot.
    const nextCurrent = unwrap(c), nextSessions = unwrap(list), nextTrash = unwrap(deleted);
    setRules(unwrap(policy)); setCurrent(nextCurrent); setSessions(nextSessions); setTrash(nextTrash); setLoadedPeriod(p);
  }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) setError(errorText(e));
      if (e instanceof ApiError && ['CONNECTION', 'CONFIG', 'DATABASE_NOT_READY'].includes(e.code)) setHealth({ connected: false, ready: false, message: errorText(e), checkedAt: clockNow() });
    }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => { void run(async () => {
    try { await load(period); } catch (e) { setHealth({ connected: false, ready: false, message: errorText(e), checkedAt: clockNow() }); throw e; }
  }); }, []);
  async function refresh() { await run(async () => {
    // An invalid filter does not mean the SQL connection was lost.
    validatePeriod(period);
    try { await load(period); } catch (e) { setHealth({ connected: false, ready: false, message: t('error.query'), checkedAt: clockNow() }); throw e; }
  }); }
  async function mutate(command: Command) {
    const saved = unwrap(await window.journey.mutate(command));
    setSelected(null);
    setNotice(t('notice.saved', { action: actionLabel()[command.type] }));
    try { await load(loadedPeriod); }
    catch (e) { setHealth({ connected: false, ready: false, message: t('error.savedQuery'), checkedAt: clockNow() }); throw new Error(t('error.savedRefresh')); }
    return saved;
  }
  useEffect(() => window.journey.onDesktopEvent(event => { if (event === 'settings') void showPreferences(); else void run(() => load(loadedPeriod)); }), [loadedPeriod]);
  const disabled = busy || !health?.ready;
  const currentState = current ? state(current) : null;
  const currentTotals = current ? calculate(current, now, rules) : null;
  const closed = sessions.filter(s => s.endedAt);
  const totals = closed.reduce((acc, s) => { const c = calculate(s, now, rules); return { worked: acc.worked + c.worked, extra: acc.extra + c.extra!, deficit: acc.deficit + c.deficit! }; }, { worked: 0, extra: 0, deficit: 0 });
  const actionTime = () => manual ? fromLocal(at) : clockNow();
  function execute(type: 'start' | 'pause' | 'resume' | 'finish') { void run(async () => {
    const time = actionTime();
    if (type === 'start') await mutate({ type, at: time });
    else if (current) {
      if (type === 'pause') { await mutate({ type, at: time, id: current.id, version: current.version, reason: pauseReason }); setPauseReason(''); }
      else await mutate({ type, at: time, id: current.id, version: current.version });
    }
  }); }
  function showAudit(s: WorkSession) { void run(async () => { const entries = unwrap(await window.journey.audit(s.id)); setAudits(entries); setAuditSession(s); setAdministrative(false); setAuditTitle(s.workDate); }); }
  function addPrevious() {
    const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);
    setError(''); setSelected({ id: crypto.randomUUID(), version: 0, workDate: date, startedAt: fromLocal(`${date}T09:00:00`), endedAt: fromLocal(`${date}T18:00:00`), notes: '', breaks: [] });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">J</span><div>JourneyHub<small>{t('nav.brand')}</small></div></div>
      <div className="nav-title">{t('nav.personal')}</div>
      <nav aria-label={t('nav.main')}><button className={tab === 'today' ? 'nav active' : 'nav'} onClick={() => setTab('today')}><span>◷</span> {t('nav.today')}</button><button className={tab === 'history' ? 'nav active' : 'nav'} onClick={() => setTab('history')}><span>▤</span> {t('nav.history')}</button><button className={tab === 'trash' ? 'nav active' : 'nav'} onClick={() => setTab('trash')}><span>♲</span> {t('nav.trashCount')}{numberLabel(trash.length)})</button></nav>
      <div className="sidebar-note"><span className="leaf">↗</span><strong>{t('nav.oneRecord')}</strong><p>{t('nav.description')}</p></div>
      <button className={tab === 'notifications' ? 'nav active' : 'nav'} onClick={() => void showNotifications()}><svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>{t('nav.notifications')}</button>
      <button className="nav" onClick={() => void showPreferences()}><svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.6v2.8L2.3 15l2 3.5 2.1-.7 2 .9L9 21h4l.6-2.3 2-.9 2.1.7 2-3.5-1.6-1.6v-2.8L19.7 9l-2-3.5-2.1.7-2-.9L13 3Z" /><circle cx="11" cy="12" r="3" /></svg>{t('common.settings')}</button><div className="sidebar-footer"><span className={`dot ${health?.ready ? 'online' : ''}`} />{health?.ready ? (health.provider === 'sqlite' ? t('nav.localReady') : t('nav.sqlReady')) : t('nav.pending')}<small>{t('nav.localData')}</small></div>
    </aside>
    <main>
      <header className="topbar"><span>{t('nav.heading')} <span className="slash">/</span> {tab === 'today' ? t('nav.overview') : tab === 'trash' ? t('nav.trash') : tab === 'notifications' ? t('nav.notifications') : t('nav.historyShort')}</span><span>{dateLabel(today)} <span className="avatar">{t('nav.me')}</span></span></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">{tab === 'today' ? t('page.everyMoment') : t('page.organized')}</p><h1>{tab === 'today' ? t('page.title') : tab === 'trash' ? t('page.trash') : tab === 'notifications' ? t('nav.notifications') : t('page.history')}</h1><p>{tab === 'today' ? t('page.subtitle') : tab === 'trash' ? t('page.trashSubtitle') : tab === 'notifications' ? t('notifications.subtitle') : t('page.historySubtitle')}</p></div><button className="button secondary" disabled={busy} onClick={() => void refresh()}>{t('common.refresh')}</button></div>
        {error && <div className="alert error" role="alert">{message(error)}</div>}
        {notice && <div className="alert success" role="status">{message(notice)}</div>}
        {!health?.ready && <section className="connection-panel"><div className="connection-icon">◌</div><div><h2>{health?.connected ? t('connection.pending') : t('connection.title')}</h2><p>{health?.message ? message(health.message) : t('connection.checking')}</p><p className="muted">{t('connection.available')}</p></div></section>}
        {tab === 'today' && <>
          <section className="session-panel">
            <div className="session-main"><div className="session-top"><span className="eyebrow">{t('workday.current')}</span><span className={`badge ${currentState ?? 'idle'}`}><span className="dot" />{currentState ? statusLabel()[currentState] : t('state.notStarted')}</span></div>
              <div className="clock">{currentTotals ? duration(currentTotals.worked) : '00:00:00'}</div>
              <p className="clock-caption">{current ? t('workday.elapsed', { time: displayTime(current.startedAt) }) : t('workday.ready')}</p>
              <div className="session-metrics"><div><span>{t('export.breaks')}</span><strong>{currentTotals ? duration(currentTotals.paused) : '00:00:00'}</strong></div><div><span>{t('workday.intervals')}</span><strong>{numberLabel(current?.breaks.length ?? 0)}</strong></div><div><span>{t('workday.reference')}</span><strong>{currentTotals ? duration(currentTotals.expected) : duration(expectedSeconds(rules, today))}<small>{t('workday.weekdays')}</small></strong></div></div>
            </div>
            <div className="session-controls"><h2>{t('workday.record')}</h2><p className="muted">{t('workday.oneClick')}</p><label className="checkbox"><input type="checkbox" checked={manual} onChange={e => { setManual(e.target.checked); setAt(localInput(clockNow())); }} /> {t('workday.manual')}</label>
              {manual ? <label>{t('workday.dateTime')}<input type="datetime-local" step="1" value={at} onChange={e => setAt(e.target.value)} /></label> : <div className="live-time">{clockLabel(now)}<small>{t('workday.zone')}</small></div>}
              {!current ? <button className="button primary wide" disabled={disabled} onClick={() => execute('start')}>{t('workday.start')}</button> : <>
                {currentState === 'working' && <><label>{t('workday.pauseReason')}<input maxLength={300} value={pauseReason} placeholder={t('workday.pausePlaceholder')} onChange={e => setPauseReason(e.target.value)} /></label><button className="button primary wide" disabled={disabled} onClick={() => execute('pause')}>{t('workday.pause')}</button></>}
                {currentState === 'paused' && <><p className="pause-description">{t('workday.pausedPrefix')} {current.breaks.at(-1)?.reason}</p><button className="button primary wide" disabled={disabled} onClick={() => execute('resume')}>{t('workday.resume')}</button></>}
                <button className="button secondary wide" disabled={disabled} onClick={() => execute('finish')}>{t('workday.finish')}</button>
                {currentState === 'paused' && <small className="muted">{t('workday.finishHelp')}</small>}
              </>}
            </div>
          </section>
          {current && <section className="card"><div className="section-heading"><h2>{t('workday.timeline')}</h2><button className="text-button" disabled={disabled} onClick={() => setSelected(current)}>{t('workday.correct')}</button></div><div className="timeline"><div><span className="timeline-dot" /><strong>{t('action.start')}</strong><time>{displayTime(current.startedAt)}</time></div>{current.breaks.map(b => <div key={b.id}><span className="timeline-dot pause" /><strong>{b.reason}</strong><time>{displayTime(b.startedAt)} → {b.endedAt ? displayTime(b.endedAt) : t('state.inProgress')}</time></div>)}</div></section>}
        </>}
        {tab === 'notifications' && reminders && <Notifications initial={reminders} />}
        {(tab === 'today' || tab === 'history') && <section className="history-section"><div className="section-heading"><div><h2>{tab === 'today' ? t('history.summary') : t('history.query')}</h2><p className="muted">{t('history.totalsPrefix')} {dateLabel(loadedPeriod.from)} {t('history.toWord')} {dateLabel(loadedPeriod.to)}</p></div><button className="text-button" disabled={disabled} onClick={addPrevious}>{t('history.add')}</button></div>
          <div className="history-toolbar">
            <label>{t('period.mode')}<select aria-label={t('period.mode')} value={queryMode} disabled={busy} onChange={e => setQueryMode(e.target.value)}>
              <option value="range">{t('period.range')}</option><option value="days">{t('period.custom')}</option>
            </select></label>
            {queryMode === 'days' ? <form className="quick-periods" onSubmit={e => { e.preventDefault(); applyDays(Number(days)); }}>
              <label>{t('period.presets')}<select disabled={disabled} value={['7', '14', '30', '60'].includes(days) ? days : ''} onChange={e => { if (e.target.value) setDays(e.target.value); }}>
                <option value="">{t('period.customOption')}</option>
                {[7, 14, 30, 60].map(n => <option key={n} value={n}>{t('period.last', { days: n })}</option>)}
              </select></label>
              <label>{t('period.custom')}<input type="number" min="1" step="1" required value={days} onChange={e => setDays(e.target.value)} /></label>
              <button className="button secondary" disabled={disabled}>{t('period.apply')}</button>
            </form> : <form className="filters" onSubmit={e => { e.preventDefault(); void refresh(); }}>
              <label>{t('history.from')}<input type="date" value={period.from} onChange={e => setPeriod({ ...period, from: e.target.value })} required /></label>
              <label>{t('history.to')}<input type="date" value={period.to} onChange={e => setPeriod({ ...period, to: e.target.value })} required /></label>
              <button className="button secondary" disabled={disabled}>{t('history.apply')}</button>
            </form>}
            <label className="export-select"><span className="sr-only">{t('history.export')}</span><select aria-label={t('history.export')} disabled={disabled} value="" onChange={e => {
              const mode = e.target.value;
              if (mode !== 'summary' && mode !== 'full') return;
              void run(async () => { const exported = unwrap(await window.journey.export(loadedPeriod, mode)); if (!exported.cancelled) setNotice(t('notice.exported', { name: exported.name })); });
            }}>
              <option value="" disabled>{t('history.export')}</option>
              <option value="summary">{t('export.summary')}</option><option value="full">{t('export.full')}</option>
            </select></label>
          </div>
          <div className="stats"><Stat label={t('history.workedHours')} value={duration(totals.worked)} foot={t('history.closedCount', { count: closed.length })} /><Stat label={t('history.extraHours')} value={duration(totals.extra)} foot={t('history.above')} /><Stat label={t('history.deficitHours')} value={duration(totals.deficit)} foot={t('history.shortfall')} /><Stat label={t('history.balance')} value={duration(totals.extra - totals.deficit)} foot={t('history.netBalance')} /></div>
          <div className="card table-card"><table><thead><tr><th>{t('common.date')}</th><th>{t('history.entryExit')}</th><th>{t('export.breaks')}</th><th>{t('history.worked')}</th><th>{t('common.status')}</th><th><span className="sr-only">{t('common.actions')}</span></th></tr></thead><tbody>{sessions.map(s => { const c = calculate(s, now, rules); return <tr key={s.id}><td className="strong">{dateLabel(s.workDate)}</td><td>{clockLabel(s.startedAt, false)} → {s.endedAt ? `${localDate(s.endedAt) !== s.workDate ? `${dateLabel(localDate(s.endedAt))} ` : ''}${clockLabel(s.endedAt, false)}` : '—'}</td><td>{numberLabel(s.breaks.length)}</td><td className="numeric">{duration(c.worked)}{c.partial && <small> {t('state.partial')}</small>}</td><td><span className={`badge ${state(s)}`}>{statusLabel()[state(s)]}</span></td><td className="row-actions"><button className="text-button" disabled={disabled} onClick={() => setSelected(s)}>{t('common.edit')}</button><button className="text-button" disabled={disabled} onClick={() => showAudit(s)}>{t('export.audit')}</button><button className="text-button danger" disabled={disabled} onClick={() => void run(async () => { await mutate({ type: 'delete', id: s.id, version: s.version }); })}>{t('common.delete')}</button></td></tr>; })}</tbody></table>{!sessions.length && <div className="empty"><span>▤</span><h3>{health?.ready ? t('history.empty') : t('connection.wait')}</h3><p>{health?.ready ? t('history.emptyHelp') : t('connection.empty')}</p></div>}</div>
        </section>}
        {tab === 'trash' && <section className="card table-card">
          <table><thead><tr><th>{t('trash.workDate')}</th><th>{t('trash.deletedAt')}</th><th>{t('export.breaks')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{trash.map(s => <tr key={s.id}><td className="strong">{dateLabel(s.workDate)}{!s.endedAt && <small> {t('trash.wasOpen')}</small>}</td><td>{s.deletedAt ? displayTime(s.deletedAt) : '—'}</td><td>{numberLabel(s.breaks.length)}</td><td><button className="text-button" disabled={disabled} onClick={() => void run(async () => { await mutate({ type: 'restore', id: s.id, version: s.version }); })}>{t('trash.restore')}</button><button className="text-button" disabled={disabled} onClick={() => showAudit(s)}>{t('export.audit')}</button></td></tr>)}</tbody></table>
          {!trash.length && <div className="empty"><h3>{t('trash.empty')}</h3><p>{t('trash.help')}</p></div>}
          <p className="trash-note muted">{t('trash.restoreHelp')}</p>
        </section>}
        <footer className="page-footer">{TIME_ZONE} <span>•</span> {t('footer.breaks')} <span>•</span> {t('footer.audit')}</footer>
      </div>
    </main>
    {preferences && <Preferences initial={preferences} referenceDisabled={disabled} reference={referenceMinutes(rules, nextWorkDate(now))} saveReference={async minutes => {
      unwrap(await window.journey.saveReference(minutes)); setRules(unwrap(await window.journey.rules()));
    }} local={health?.provider === 'sqlite'} backup={async () => unwrap(await window.journey.backup())} restore={async () => unwrap(await window.journey.restoreBackup())} close={() => setPreferences(null)} save={async value => { unwrap(await window.journey.savePreferences(value)); }} />}
    {selected && <Editor key={`${selected.id}-${selected.version}`} session={selected} busy={busy} onClose={() => setSelected(null)} onSave={command => run(async () => { await mutate(command); })} error={error} />}
    {audits && <ModalBoundary close={() => setAudits(null)}><section className="modal audit-modal" role="dialog" aria-modal="true" aria-label={t('export.audit')}><div className="section-heading"><h2>{administrative ? t('audit.admin') : t('audit.timeline')} · {dateLabel(auditTitle)}</h2><button className="button secondary" onClick={() => setAudits(null)}>{t('common.close')}</button></div><button className="button secondary" onClick={() => setAdministrative(!administrative)}>{administrative ? t('audit.showOperational') : t('audit.showAdmin')}</button>{!administrative && auditSession && <><p className="muted">{t('audit.currentHelp')}</p>{operationalTimeline(auditSession).map(event => <article className="audit-entry" key={event.id}><strong>{t('timeline.' + event.type, { reason: event.reason })}</strong><time>{displayTime(event.at)}</time></article>)}</>}{administrative && audits.map(a => <article className="audit-entry" key={a.id}><div><strong>{actionLabel()[a.action] ?? a.action}</strong><time>{displayTime(a.recordedAt)}</time></div><p>{a.reason}</p><small>{a.actor} {t('audit.versionPrefix')} {a.after.version}</small><details><summary>{t('audit.compare')}</summary><div className="audit-snapshots"><Snapshot title={t('common.before')} session={a.before} /><Snapshot title={t('common.after')} session={a.after} /></div></details></article>)}</section></ModalBoundary>}
  </div>;
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong><small>{foot}</small></div>; }
function Snapshot({ title, session: s }: { title: string; session: WorkSession | null }) { return <div><h4>{title}</h4>{s ? <><p>{t('audit.entryPrefix')} {displayTime(s.startedAt)}<br />{t('audit.exitPrefix')} {s.endedAt ? displayTime(s.endedAt) : t('common.open')}</p>{s.breaks.map(b => <p key={b.id}>{b.reason}: {displayTime(b.startedAt)} → {b.endedAt ? displayTime(b.endedAt) : t('common.open')}</p>)}<p>{t('audit.notesPrefix')} {s.notes || '—'}</p></> : <p>{t('audit.noPrevious')}</p>}</div>; }
function Editor({ session, busy, onClose, onSave, error }: { session: WorkSession; busy: boolean; onClose: () => void; onSave: (c: Command) => Promise<void>; error: string }) {
  useTranslation(); usePresentation();
  const creating = session.version === 0;
  const [start, setStart] = useState(localInput(session.startedAt));
  const [end, setEnd] = useState(session.endedAt ? localInput(session.endedAt) : '');
  const [breaks, setBreaks] = useState(session.breaks.map(b => ({ ...b, startedAt: localInput(b.startedAt), endedAt: b.endedAt ? localInput(b.endedAt) : '' })));
  const [notes, setNotes] = useState(session.notes);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLocalError('');
    try {
      const value = { startedAt: fromLocal(start), endedAt: end ? fromLocal(end) : null, notes, breaks: breaks.map(b => ({ ...b, startedAt: fromLocal(b.startedAt), endedAt: b.endedAt ? fromLocal(b.endedAt) : null })) };
      if (creating) { if (!value.endedAt) throw new Error(t('error.lateExit')); await onSave({ type: 'create', value: { ...value, endedAt: value.endedAt }, reason }); }
      else await onSave({ type: 'edit', id: session.id, version: session.version, reason: 'Correção manual pelo usuário', value });
    }
    catch (err) { setLocalError(errorText(err)); }
  }
  return <ModalBoundary close={onClose} busy={busy}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" onSubmit={e => void submit(e)}><div className="section-heading"><div><p className="eyebrow">{t('editor.trace')}</p><h2 id="edit-title">{creating ? t('editor.add') : t('editor.title')}</h2></div><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</button></div><p className="muted">{t('editor.zoneHelp')}</p>{(localError || error) && <div className="alert error" role="alert">{message(localError || error)}</div>}<fieldset disabled={busy}><div className="editor-grid"><label>{t('action.start')}<input autoFocus type="datetime-local" step="1" required value={start} onChange={e => setStart(e.target.value)} /></label><label>{creating ? t('common.exit') : t('editor.exitHelp')}<input required={creating} type="datetime-local" step="1" value={end} onChange={e => setEnd(e.target.value)} /></label></div><div className="section-heading"><h3>{t('editor.breaks')}</h3><button type="button" className="text-button" onClick={() => setBreaks([...breaks, { id: crypto.randomUUID(), startedAt: '', endedAt: '', reason: '' }])}>{t('editor.addBreak')}</button></div>{breaks.map((b, index) => <div className="break-editor" key={b.id}><label>{t('common.reason')}<input maxLength={300} value={b.reason} onChange={e => setBreaks(breaks.map((item, i) => i === index ? { ...item, reason: e.target.value } : item))} /></label><label>{t('common.start')}<input type="datetime-local" step="1" required value={b.startedAt} onChange={e => setBreaks(breaks.map((item, i) => i === index ? { ...item, startedAt: e.target.value } : item))} /></label><label>{t('action.resume')}<input type="datetime-local" step="1" value={b.endedAt} onChange={e => setBreaks(breaks.map((item, i) => i === index ? { ...item, endedAt: e.target.value } : item))} /></label><button type="button" className="text-button danger" onClick={() => setBreaks(breaks.filter((_, i) => i !== index))}>{t('editor.remove')}</button></div>)}<label>{t('common.notes')}<textarea rows={2} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>{creating && <label>{t('editor.createReason')}<textarea rows={2} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>}<div className="modal-actions"><span className="muted">{creating ? t('editor.newAudit') : t('editor.version', { version: numberLabel(session.version) })}</span><button className="button primary" disabled={creating && !reason.trim()}>{creating ? t('editor.save') : t('editor.saveCorrection')}</button></div></fieldset></form></ModalBoundary>;
}
