import type { DailyRule } from '../domain/work-policy';
import type { AuditEntry, Command, Health, Period, Report, WorkSession } from '../shared/contracts';

/** Provider-independent operations. Implementations commit state and audit atomically. */
export interface JourneyPersistence {
  rules(): Promise<DailyRule[]>;
  saveRule(rule: DailyRule): Promise<void>;
  health(): Promise<Health>;
  current(): Promise<WorkSession | null>;
  list(period: Period): Promise<WorkSession[]>;
  report(period: Period, audits?: boolean): Promise<Report>;
  trash(): Promise<WorkSession[]>;
  audit(id: string): Promise<AuditEntry[]>;
  mutate(command: Command): Promise<WorkSession>;
}
