import { Temporal } from '@js-temporal/polyfill';
import { TIME_ZONE } from './contracts';

export function utc(value: string): string { return Temporal.Instant.from(value).toString({ smallestUnit: 'second' }); }
export function epoch(value: string): number { return Temporal.Instant.from(value).epochMilliseconds; }
export function localDate(value: string): string { return Temporal.Instant.from(value).toZonedDateTimeISO(TIME_ZONE).toPlainDate().toString(); }
export function localInput(value: string): string { return Temporal.Instant.from(value).toZonedDateTimeISO(TIME_ZONE).toPlainDateTime().toString({ smallestUnit: 'second' }); }
export function fromLocal(value: string): string {
  return Temporal.PlainDateTime.from(value).toZonedDateTime(TIME_ZONE, { disambiguation: 'reject' }).toInstant().toString({ smallestUnit: 'second' });
}
export function weekday(date: string): number { return Temporal.PlainDate.from(date).dayOfWeek; }
export function validDate(date: string): boolean { try { return Temporal.PlainDate.from(date).toString() === date; } catch { return false; } }
export function secondsBetween(start: string, end: string): number { return (epoch(end) - epoch(start)) / 1000; }
export function clockNow(): string { return Temporal.Now.instant().toString({ smallestUnit: 'second' }); }
export function duration(seconds: number): string {
  const n = Math.floor(Math.abs(seconds));
  return `${seconds < 0 ? '−' : ''}${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export function displayTime(value: string): string { return localInput(value).replace('T', ' '); }
