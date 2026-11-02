import { expect, it } from 'vitest';
import { operationalTimeline } from '../src/domain/timeline';
import { fixture } from './fixtures';

it('apresenta o nome corrigido sem criar eventos de edição ou mudar os dados', () => {
  const original = fixture(); original.breaks[0].reason = "kent's";
  const current = structuredClone(original); current.breaks[0].reason = 'jantar';
  const events = operationalTimeline(current);
  expect(events).toHaveLength(4);
  expect(events.map(e => e.type)).toEqual(['start', 'pause', 'resume', 'finish']);
  expect(events[1].reason).toBe('jantar');
  expect(original.breaks[0].reason).toBe("kent's");
  expect(events[1].at).toBe(original.breaks[0].startedAt);
});
it('não inventa retorno ou encerramento de uma jornada pausada', () => {
  const current = fixture({ endedAt: null }); current.breaks[0].endedAt = null;
  expect(operationalTimeline(current)).toHaveLength(2);
});
