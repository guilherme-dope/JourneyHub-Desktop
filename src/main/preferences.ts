import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultPreferences, preferencesSchema, type Preferences } from '../shared/preferences';
const schema = z.object({ preferences: preferencesSchema, day: z.string(), next: z.number().finite().nullable() }).strict();
export type DesktopState = z.infer<typeof schema>;
export class PreferenceStore {
  value: DesktopState = { preferences: structuredClone(defaultPreferences), day: '', next: null };
  private queue: Promise<void> = Promise.resolve();
  constructor(private path: string) {}
  async load() {
    try { this.value = schema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Configurações locais inválidas. Preserve o arquivo e consulte o suporte.'); }
  }
  private async update(change: (current: DesktopState) => DesktopState) {
    const work = this.queue.then(async () => {
      const parsed = schema.parse(change(this.value));
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(parsed)); await file.sync(); } finally { await file.close(); }
      await rename(temp, this.path); this.value = parsed;
    });
    this.queue = work.catch(() => {}); return work;
  }
  async configure(preferences: Preferences) {
    const parsed = preferencesSchema.parse(preferences);
    await this.update(current => ({ ...current, preferences: parsed }));
  }
  async reminder(day: string, next: number | null) {
    await this.update(current => ({ ...current, day, next }));
  }
}
