import { existsSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/journey';

const pointerSchema = z.object({ version: z.literal(1), file: z.string().regex(/^restored-[0-9a-f-]{36}\.sqlite$/) }).strict();
export function activeSqlitePath(profile: string): string {
  const pointer = join(profile, 'sqlite-active-v1.json');
  const file = existsSync(pointer) ? pointerSchema.parse(JSON.parse(readFileSync(pointer, 'utf8'))).file : 'journey.sqlite';
  return join(profile, file);
}

/** Atomic pointer replacement keeps both database generations available after a crash. */
export function activateSqlite(profile: string, file: string): void {
  const pointer = pointerSchema.parse({ version: 1, file });
  if (!existsSync(join(profile, file))) throw new DomainError('CONFIG', 'O banco restaurado não foi encontrado.');
  const temporary = join(profile, `sqlite-active-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(pointer), { flag: 'wx', mode: 0o600 });
  const descriptor = openSync(temporary, 'r+');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, join(profile, 'sqlite-active-v1.json'));
}
