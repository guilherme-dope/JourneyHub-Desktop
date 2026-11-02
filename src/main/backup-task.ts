import type { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '../domain/journey';
import type { BackupSummary } from './sqlite-backup';

export const BACKUP_MAX_BYTES = 512 * 1024 * 1024;
export const BACKUP_TIMEOUT_MS = 30_000;
export type BackupTaskResult = BackupSummary | { path: string; summary: BackupSummary };

/** The utility process can be killed without blocking the live database or UI. */
export async function runBackupTask(operation: 'inspect' | 'restore', source: string, profile?: string, timeout = BACKUP_TIMEOUT_MS): Promise<BackupTaskResult> {
  const info = await stat(source);
  if (!info.isFile() || info.size > BACKUP_MAX_BYTES) throw new DomainError('BACKUP_LIMIT', 'O backup excede o limite de 512 MiB ou não é um arquivo regular.');
  const bundled = join(__dirname, 'backup-worker.cjs');
  const entry = existsSync(bundled) ? bundled : join(process.cwd(), 'dist/main/backup-worker.cjs');
  const args = [operation, source, profile ?? ''];
  const env = { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
  const child = process.versions.electron
    ? (await import('electron')).utilityProcess.fork(entry, args, { env, stdio: 'ignore', serviceName: 'JourneyHub Backup', execArgv: ['--max-old-space-size=256'] })
    : fork(entry, args, { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'], windowsHide: true });
  return new Promise((resolve, reject) => {
    const events = child as EventEmitter;
    let settled = false, exited = false;
    let complete: (() => void) | undefined;
    const finish = (error?: Error, result?: BackupTaskResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      complete = () => { if (error) reject(error); else resolve(result!); };
      if (exited || !child.kill()) complete();
    };
    const timer = setTimeout(() => finish(new DomainError('BACKUP_LIMIT', 'A validação do backup excedeu 30 segundos. O banco ativo foi preservado.')), timeout);
    events.once('message', (value: { ok: boolean; result?: BackupTaskResult }) => {
      if (value?.ok && value.result) finish(undefined, value.result);
      else finish(new DomainError('BACKUP_INVALID', 'O arquivo não é um backup SQLite compatível e íntegro do JourneyHub. Escolha outro arquivo.'));
    });
    events.once('error', () => finish(new DomainError('BACKUP_INVALID', 'Não foi possível iniciar a validação isolada do backup.')));
    events.once('exit', () => {
      exited = true;
      if (complete) complete();
      else finish(new DomainError('BACKUP_INVALID', 'A validação do backup foi interrompida. O banco ativo foi preservado.'));
    });
  });
}
export async function inspectBackupIsolated(path: string): Promise<BackupSummary> {
  return await runBackupTask('inspect', path) as BackupSummary;
}
