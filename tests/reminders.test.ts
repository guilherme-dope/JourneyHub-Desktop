import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferenceStore } from '../src/main/preferences';
import { ReminderService } from '../src/main/reminders';
import { Temporal } from '@js-temporal/polyfill';
const due = '2026-10-27T11:00:00Z';
const clock = () => Temporal.Instant.from(due);
async function scenario(work: (store: PreferenceStore, path: string) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'journey-reminder-'));
  try { const path = join(folder, 'settings.json'); const store = new PreferenceStore(path); await store.load(); await store.configure({ ...store.value.preferences, reminders: true }); await work(store, path); }
  finally { await rm(folder, { recursive: true, force: true }); }
}
const records = () => ({ health: vi.fn(async () => ({ ready: true })), current: vi.fn(async (): Promise<unknown> => null), list: vi.fn(async (): Promise<unknown[]> => []), mutate: vi.fn(async () => ({})) });
it('deduplica após reinício e nunca inicia sem confirmação', async () => scenario(async (store, path) => {
  const db = records(), prompt = vi.fn(async () => 'ignore' as const);
  await new ReminderService(store, db, prompt, () => {}, () => {}, clock).tick(due);
  const reopened = new PreferenceStore(path); await reopened.load();
  await new ReminderService(reopened, db, prompt, () => {}, () => {}, clock).tick(due);
  expect(prompt).toHaveBeenCalledTimes(1); expect(db.mutate).not.toHaveBeenCalled();
}));
it('adia dez minutos e respeita horário e dia desabilitado', async () => scenario(async store => {
  const prompt = vi.fn(async () => 'snooze' as const);
  const service = new ReminderService(store, records(), prompt, () => {}, () => {}, () => Temporal.Instant.from(due));
  await service.tick('2026-10-27T10:59:00Z'); expect(prompt).not.toHaveBeenCalled();
  await service.tick(due); await service.tick('2026-10-27T11:09:59Z'); expect(prompt).toHaveBeenCalledTimes(1);
  await service.tick('2026-10-27T11:10:00Z'); expect(prompt).toHaveBeenCalledTimes(2);
  await service.tick('2026-10-31T11:00:00Z'); expect(prompt).toHaveBeenCalledTimes(2);
}));
it('suprime alerta para jornada aberta ou já registrada e recusa falha SQL', async () => scenario(async store => {
  for (const mode of ['open', 'closed', 'offline']) {
    await store.reminder('', null);
    const db = records(), prompt = vi.fn(async () => 'start' as const);
    if (mode === 'open') db.current.mockResolvedValue({});
    if (mode === 'closed') db.list.mockResolvedValue([{}]);
    if (mode === 'offline') db.health.mockRejectedValue(new Error('offline'));
    await new ReminderService(store, db, prompt, () => {}, () => {}, clock).tick(due);
    expect(prompt).not.toHaveBeenCalled(); expect(db.mutate).not.toHaveBeenCalled();
  }
}));
it('inicia somente por confirmação e reconsulta antes de gravar', async () => scenario(async store => {
  const db = records(), changed = vi.fn();
  await new ReminderService(store, db, async () => 'start', changed, () => {}, clock).tick(due);
  expect(db.mutate).toHaveBeenCalledTimes(1); expect(db.current).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledTimes(1);
}));
it('não duplica cliques ou verificações concorrentes', async () => scenario(async store => {
  const db = records(), prompt = vi.fn(async () => 'ignore' as const);
  const service = new ReminderService(store, db, prompt, () => {}, () => {}, clock);
  await Promise.all([service.tick(due), service.tick(due)]); expect(prompt).toHaveBeenCalledTimes(1);
}));
it('conta o adiamento a partir do clique, mesmo após quinze minutos no aviso', async () => scenario(async store => {
  let now = Temporal.Instant.from(due);
  const prompt = vi.fn(async () => { now = now.add({ minutes: 15 }); return 'snooze' as const; });
  const service = new ReminderService(store, records(), prompt, () => {}, () => {}, () => now);
  await service.tick();
  expect(store.value.next).toBe(Temporal.Instant.from(due).add({ minutes: 25 }).epochMilliseconds);
  await service.tick('2026-10-27T11:24:59Z');
  expect(prompt).toHaveBeenCalledTimes(1);
  now = Temporal.Instant.from('2026-10-27T11:25:00Z');
  await service.tick();
  expect(prompt).toHaveBeenCalledTimes(2);
}));
it('mantém o adiamento ao atravessar a meia-noite e reiniciar', async () => scenario(async (store, path) => {
  let now = Temporal.Instant.from('2026-10-31T02:58:00Z');
  const prompt = vi.fn(async () => 'snooze' as const);
  await new ReminderService(store, records(), prompt, () => {}, () => {}, () => now).tick();
  const reopened = new PreferenceStore(path); await reopened.load();
  const later = vi.fn(async () => 'ignore' as const);
  const service = new ReminderService(reopened, records(), later, () => {}, () => {}, () => now);
  await service.tick('2026-10-31T02:59:00Z'); expect(later).not.toHaveBeenCalled();
  now = Temporal.Instant.from('2026-10-31T03:08:00Z');
  await service.tick(); expect(later).toHaveBeenCalledTimes(1);
  await service.tick(); expect(later).toHaveBeenCalledTimes(1);
}));
it('reconsulta configurações alteradas durante a verificação do banco', async () => scenario(async store => {
  const db = records(), prompt = vi.fn(async () => 'ignore' as const);
  db.health.mockImplementation(async () => { await store.configure({ ...store.value.preferences, reminders: false }); return { ready: true }; });
  await new ReminderService(store, db, prompt, () => {}, () => {}, clock).tick(due);
  expect(prompt).not.toHaveBeenCalled(); expect(store.value.preferences.reminders).toBe(false);
}));
it('não cria jornada se outra já iniciou enquanto o aviso estava aberto', async () => scenario(async store => {
  const db = records(); db.current.mockResolvedValueOnce(null).mockResolvedValueOnce({});
  await new ReminderService(store, db, async () => 'start', () => {}, () => {}, clock).tick(due);
  expect(db.mutate).not.toHaveBeenCalled();
}));
it('ignora o dia do clique quando o aviso atravessa a meia-noite', async () => scenario(async store => {
  let now = Temporal.Instant.from('2026-10-27T02:59:00Z');
  const prompt = vi.fn(async () => { now = Temporal.Instant.from('2026-10-27T03:01:00Z'); return 'ignore' as const; });
  const service = new ReminderService(store, records(), prompt, () => {}, () => {}, () => now);
  await service.tick();
  await service.tick(due);
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(store.value.day).toBe('2026-10-27');
}));
