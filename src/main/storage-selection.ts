import { existsSync } from 'node:fs';
import { readFile, writeFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { DomainError } from '../domain/journey';
import { activeSqlitePath } from './sqlite-files';

const selectionSchema = z.discriminatedUnion('provider', [
  z.object({ version: z.literal(1), provider: z.literal('mssql'), envFile: z.string().refine(isAbsolute) }).strict(),
  z.object({ version: z.literal(1), provider: z.literal('sqlite') }).strict(),
]);
export type StorageSelection = z.infer<typeof selectionSchema>;

export async function selectStorage(profile: string, explicitEnv?: string): Promise<{ selection: StorageSelection; existing: boolean }> {
  const path = join(profile, 'storage-v1.json');
  if (existsSync(path)) {
    const selection = selectionSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (selection.provider === 'mssql' && !existsSync(selection.envFile)) throw new DomainError('CONFIG', 'A configuração SQL Server deste perfil não foi encontrada. Recupere o arquivo de conexão original.');
    if (explicitEnv && (selection.provider !== 'mssql' || selection.envFile !== resolve(explicitEnv))) throw new DomainError('CONFIG', 'O banco solicitado difere da seleção salva neste perfil. Utilize um perfil separado.');
    if (selection.provider === 'sqlite' && !existsSync(activeSqlitePath(profile))) throw new DomainError('CONFIG', 'O banco local deste perfil não foi encontrado. Recupere o arquivo original ou um backup antes de continuar.');
    return { selection, existing: true };
  }
  const envFile = explicitEnv ? resolve(explicitEnv) : join(profile, '.env');
  if (explicitEnv && !existsSync(envFile)) throw new DomainError('CONFIG', 'O arquivo de conexão informado não existe.');
  if (existsSync(envFile)) return { selection: { version: 1, provider: 'mssql', envFile }, existing: false };
  if (existsSync(join(profile, 'desktop-settings.json')) || existsSync(join(profile, 'journey.sqlite'))) {
    throw new DomainError('LEGACY_PROFILE', 'Este perfil contém dados anteriores. Selecione sua conexão SQL Server original antes de continuar.');
  }
  return { selection: { version: 1, provider: 'sqlite' }, existing: false };
}

export async function saveSelection(profile: string, selection: StorageSelection): Promise<void> {
  await writeFile(join(profile, 'storage-v1.json'), JSON.stringify(selectionSchema.parse(selection)), { flag: 'wx', mode: 0o600 });
}
export async function replaceSelection(profile: string, selection: StorageSelection): Promise<void> {
  const value = selectionSchema.parse(selection);
  const temporary = join(profile, `storage-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(profile, 'storage-v1.json'));
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
