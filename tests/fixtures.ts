import type { WorkSession } from '../src/shared/contracts';
import { fromLocal } from '../src/shared/time';
export const id = '11111111-1111-4111-8111-111111111111';
export const pauseId = '22222222-2222-4222-8222-222222222222';
export const now = '2026-10-26T12:00:00Z';
export const at = (time: string, date = '2026-10-20') => fromLocal(`${date}T${time}:00`);
export function fixture(overrides: Partial<WorkSession> = {}): WorkSession { return { id, workDate: '2026-10-20', startedAt: at('09:00'), endedAt: at('18:00'), breaks: [{ id: pauseId, startedAt: at('12:00'), endedAt: at('13:00'), reason: 'Almoço' }], notes: '', version: 1, ...overrides }; }
