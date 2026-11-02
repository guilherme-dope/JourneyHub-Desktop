import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { presentationSchema, type Presentation } from '../shared/presentation';

/** Separate from the strict legacy desktop-settings format, for reversible upgrades. */
export class PresentationStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private path: string, public value: Presentation) {}
  async load(): Promise<void> {
    try { this.value = presentationSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid presentation settings. Preserve the file before recovery.'); }
  }
  async save(raw: unknown): Promise<Presentation> {
    const value = presentationSchema.parse(raw);
    const work = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.path);
        this.value = value;
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    });
    this.queue = work.catch(() => {});
    await work;
    return value;
  }
}
