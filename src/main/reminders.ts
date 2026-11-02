import { Temporal } from '@js-temporal/polyfill';
import { TIME_ZONE } from '../shared/contracts';
import { PreferenceStore } from './preferences';
interface Records { health(): Promise<{ ready: boolean }>; current(): Promise<unknown>; list(p: { from: string; to: string }): Promise<unknown[]>; mutate(c: { type: 'start'; at: string }): Promise<unknown> }
export class ReminderService {
  private busy = false;
  constructor(private store: PreferenceStore, private records: Records, private prompt: () => Promise<'start' | 'snooze' | 'ignore'>, private changed: () => void, private log: (event: string) => void, private clock = () => Temporal.Now.instant()) {}
  async tick(now = this.clock().toString({ smallestUnit: 'second' })) {
    if (this.busy) return;
    this.busy = true;
    let confirmed = false;
    try {
      const saved = this.store.value, p = saved.preferences;
      if (!p.reminders) return;
      const local = Temporal.Instant.from(now).toZonedDateTimeISO(TIME_ZONE), day = local.toPlainDate().toString();
      const scheduled = p.week[local.dayOfWeek - 1];
      const epoch = Temporal.Instant.from(now).epochMilliseconds;
      if (saved.next !== null && epoch < saved.next) return;
      const snoozedToday = saved.next !== null && Temporal.Instant.fromEpochMilliseconds(saved.next).toZonedDateTimeISO(TIME_ZONE).toPlainDate().toString() === day;
      if (!snoozedToday && (!scheduled || local.toPlainTime().toString().slice(0, 5) < scheduled)) return;
      if (saved.day === day && saved.next === null) return;
      if (!(await this.records.health()).ready) return;
      if (await this.records.current() || (await this.records.list({ from: day, to: day })).length) {
        await this.store.reminder(day, null); return;
      }
      // Persist delivery before showing: restart cannot duplicate the same reminder.
      // Settings may have changed while the database checks were pending.
      if (!this.store.value.preferences.reminders || this.store.value.preferences.week[local.dayOfWeek - 1] !== scheduled) return;
      await this.store.reminder(day, null);
      if (!this.store.value.preferences.reminders || this.store.value.preferences.week[local.dayOfWeek - 1] !== scheduled) return;
      const choice = await this.prompt();
      if (choice === 'ignore') {
        const ignoredDay = this.clock().toZonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
        if (ignoredDay !== day) await this.store.reminder(ignoredDay, null);
      }
      if (choice === 'snooze') {
        const next = this.clock().add({ minutes: 10 });
        await this.store.reminder(day, next.epochMilliseconds);
      }
      if (choice === 'start') {
        confirmed = true;
        // Recheck after user deliberation. The repository also enforces uniqueness.
        if (!(await this.records.health()).ready) throw new Error('Unavailable');
        const at = this.clock().toString({ smallestUnit: 'second' });
        const date = Temporal.Instant.from(at).toZonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
        if (!await this.records.current() && !(await this.records.list({ from: date, to: date })).length) {
          await this.records.mutate({ type: 'start', at }); this.changed();
        }
      }
    } catch { this.log(confirmed ? 'reminder-start-failed' : 'reminder-failed'); }
    finally { this.busy = false; }
  }
}
