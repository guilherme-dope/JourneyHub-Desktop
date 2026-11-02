import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { localDate, weekday } from '../shared/time';

export interface DailyRule { from: string; minutes: number }
export const minutesSchema = z.number().int().min(1).max(1440);
export function referenceMinutes(rules: DailyRule[], day: string) {
  return rules.find(rule => rule.from <= day)?.minutes ?? 480; // newest first
}
export function expectedSeconds(rules: DailyRule[], day: string) {
  return weekday(day) > 5 ? 0 : referenceMinutes(rules, day) * 60;
}
export function nextWorkDate(now: string) {
  return Temporal.PlainDate.from(localDate(now)).add({ days: 1 }).toString();
}
