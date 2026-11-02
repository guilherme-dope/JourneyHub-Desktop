import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectStorage, saveSelection } from '../src/main/storage-selection';

let profile: string;
beforeEach(async () => { profile = await mkdtemp(join(tmpdir(), 'journeyhub-selection-')); });
afterEach(async () => { await rm(profile, { recursive: true, force: true }); });
it('seleciona SQLite somente em perfil novo', async () => {
  expect((await selectStorage(profile)).selection.provider).toBe('sqlite');
  await writeFile(join(profile, 'desktop-settings.json'), '{}');
  await expect(selectStorage(profile)).rejects.toMatchObject({ code: 'LEGACY_PROFILE' });
});
it('preserva SQL legado e a referência ao arquivo original', async () => {
  const envFile = join(profile, '.env'); await writeFile(envFile, 'original');
  const { selection } = await selectStorage(profile);
  expect(selection).toEqual({ version: 1, provider: 'mssql', envFile });
  await saveSelection(profile, selection);
  expect(await selectStorage(profile)).toEqual({ selection, existing: true });
  await rm(envFile);
  await expect(selectStorage(profile)).rejects.toMatchObject({ code: 'CONFIG' });
  expect(existsSync(join(profile, 'journey.sqlite'))).toBe(false);
});
it('recusa arquivo explícito inexistente e troca de provedor', async () => {
  await expect(selectStorage(profile, join(profile, 'missing.env'))).rejects.toMatchObject({ code: 'CONFIG' });
  await writeFile(join(profile, 'journey.sqlite'), 'fixture');
  await saveSelection(profile, { version: 1, provider: 'sqlite' });
  await expect(selectStorage(profile, join(profile, '.env'))).rejects.toMatchObject({ code: 'CONFIG' });
});
it('não cria banco vazio se o SQLite de um perfil existente desapareceu', async () => {
  await saveSelection(profile, { version: 1, provider: 'sqlite' });
  await expect(selectStorage(profile)).rejects.toMatchObject({ code: 'CONFIG' });
  expect(existsSync(join(profile, 'journey.sqlite'))).toBe(false);
});
it('não sobrescreve seleção desconhecida ou existente', async () => {
  await writeFile(join(profile, 'storage-v1.json'), '{"version":99}');
  await expect(selectStorage(profile)).rejects.toBeDefined();
  await expect(saveSelection(profile, { version: 1, provider: 'sqlite' })).rejects.toMatchObject({ code: 'EEXIST' });
});
