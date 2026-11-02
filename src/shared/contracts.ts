import type { DailyRule } from '../domain/work-policy';
import type { Preferences } from './preferences';
import type { Presentation } from './presentation';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

export const TIME_ZONE = 'America/Sao_Paulo';
export const instantSchema = z.string().datetime({ offset: true }).max(40).refine(value => {
  try { return Temporal.Instant.from(value).epochNanoseconds % 1_000_000_000n === 0n; }
  catch { return false; }
}, 'Use horários válidos com precisão de segundos.');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
export const breakSchema = z.object({ id: uuid, startedAt: instantSchema, endedAt: instantSchema.nullable(), reason: z.string().trim().max(300).default('').transform(value => value || 'Pausa') }).strict();
export const sessionInputSchema = z.object({ startedAt: instantSchema, endedAt: instantSchema.nullable(), notes: z.string().max(2000), breaks: z.array(breakSchema) }).strict();
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delete'), id: uuid, version: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('restore'), id: uuid, version: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('start'), at: instantSchema }).strict(),
  z.object({ type: z.literal('create'), value: sessionInputSchema.extend({ endedAt: instantSchema }), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal('pause'), id: uuid, version: z.number().int().positive(), at: instantSchema, reason: z.string().trim().max(300).default('').transform(value => value || 'Pausa') }).strict(),
  z.object({ type: z.literal('resume'), id: uuid, version: z.number().int().positive(), at: instantSchema }).strict(),
  z.object({ type: z.literal('finish'), id: uuid, version: z.number().int().positive(), at: instantSchema }).strict(),
  z.object({ type: z.literal('edit'), id: uuid, version: z.number().int().positive(), value: sessionInputSchema, reason: z.string().trim().min(1).max(500) }).strict(),
]);
export const periodSchema = z.object({ from: dateSchema, to: dateSchema }).strict();
export const exportSchema = periodSchema.extend({ mode: z.enum(['summary', 'full']).default('summary') }).strict();
export const idSchema = z.object({ id: uuid }).strict();
export type Break = z.infer<typeof breakSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export interface WorkSession extends SessionInput { id: string; workDate: string; version: number; deletedAt?: string | null }
export type Command = z.infer<typeof commandSchema>;
export type Period = z.infer<typeof periodSchema>;
export interface AuditEntry { id: string; sessionId: string; action: string; reason: string; actor: string; recordedAt: string; before: WorkSession | null; after: WorkSession }
export interface Report { sessions: WorkSession[]; audits: AuditEntry[] }
export interface Health { connected: boolean; ready: boolean; message: string; checkedAt: string; provider?: 'mssql' | 'sqlite' }
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
export interface BackupResult { cancelled: boolean; name?: string; recoveryPath?: string }
export interface JourneyApi {
  openExistingSql(): Promise<Result<{ cancelled: boolean }>>;
  useLocalStorage(): Promise<Result<{ cancelled: boolean }>>;
  presentation(): Promise<Result<Presentation>>;
  savePresentation(value: Presentation): Promise<Result<Presentation>>;
  onPresentationChange(callback: (value: Presentation) => void): () => void;
  backup(): Promise<Result<BackupResult>>;
  restoreBackup(): Promise<Result<BackupResult>>;
  rules(): Promise<Result<DailyRule[]>>;
  saveReference(minutes: number): Promise<Result<void>>;
  preferences(): Promise<Result<Preferences>>;
  saveReminders(value: Pick<Preferences, 'reminders' | 'week'>): Promise<Result<Preferences>>;
  savePreferences(value: Preferences): Promise<Result<Preferences>>;
  onDesktopEvent(callback: (event: 'settings' | 'refresh') => void): () => void;
  health(): Promise<Result<Health>>;
  list(period: Period): Promise<Result<WorkSession[]>>;
  current(): Promise<Result<WorkSession | null>>;
  trash(): Promise<Result<WorkSession[]>>;
  mutate(command: Command): Promise<Result<WorkSession>>;
  audit(id: string): Promise<Result<AuditEntry[]>>;
  export(period: Period, mode?: 'summary' | 'full'): Promise<Result<{ cancelled: boolean; name?: string }>>;
}
