import type { WorkSession } from '../shared/contracts';

export interface TimelineEvent { id: string; type: 'start' | 'pause' | 'resume' | 'finish'; at: string; reason?: string }
/** Operational data stays independent of the display language. */
export function operationalTimeline(session: WorkSession): TimelineEvent[] {
  const events: TimelineEvent[] = [{ id: 'start', type: 'start', at: session.startedAt }];
  for (const pause of session.breaks) {
    events.push({ id: `${pause.id}:start`, type: 'pause', reason: pause.reason, at: pause.startedAt });
    if (pause.endedAt) events.push({ id: `${pause.id}:end`, type: 'resume', reason: pause.reason, at: pause.endedAt });
  }
  if (session.endedAt) events.push({ id: 'end', type: 'finish', at: session.endedAt });
  return events;
}
