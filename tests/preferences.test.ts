import { expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreferenceStore } from '../src/main/preferences';

it('preserva preferências e deduplicação em ambas as ordens concorrentes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'journey-preferences-'));
  try {
    const path = join(folder, 'settings.json');
    const store = new PreferenceStore(path);
    await Promise.all([store.configure({ ...store.value.preferences, reminders: true }), store.reminder('2026-10-27', 1000)]);
    expect(store.value.preferences.reminders).toBe(true);
    expect(store.value).toMatchObject({ day: '2026-10-27', next: 1000 });
    await Promise.all([store.reminder('2026-10-28', null), store.configure({ ...store.value.preferences, reminders: false })]);
    expect(store.value.preferences.reminders).toBe(false);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ day: '2026-10-28', next: null, preferences: { reminders: false } });
    const reopened = new PreferenceStore(path); await reopened.load();
    expect(reopened.value).toEqual(store.value);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
it('mantém estado confirmado e permite nova tentativa após falha de gravação', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'journey-preferences-fail-'));
  try {
    const path = join(folder, 'settings.json');
    await mkdir(path);
    const store = new PreferenceStore(path);
    const original = structuredClone(store.value);
    await expect(store.configure({ ...original.preferences, reminders: true })).rejects.toBeDefined();
    expect(store.value).toEqual(original);
    await rm(path, { recursive: true });
    await store.configure({ ...original.preferences, reminders: true });
    expect(store.value.preferences.reminders).toBe(true);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
