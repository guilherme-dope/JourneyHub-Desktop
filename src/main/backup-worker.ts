import { inspectBackup, prepareRestoreLocally } from './sqlite-backup';

async function main() {
  const [operation, source, profile] = process.argv.slice(2);
  const parent = (process as unknown as { parentPort?: { postMessage(value: unknown): void } }).parentPort;
  const send = (value: unknown) => parent ? parent.postMessage(value) : process.send?.(value);
  try {
    const result = operation === 'restore' ? await prepareRestoreLocally(source, profile) : inspectBackup(source);
    send({ ok: true, result });
  } catch { send({ ok: false }); }
}
void main();
