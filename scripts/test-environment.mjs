import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';

export const sqlTestEnv = resolve('.env.adapter-test');
export const packagedExecutable = resolve('release', JSON.parse(readFileSync('package.json', 'utf8')).version, 'win-unpacked/JourneyHub.exe');
export function prepareSqlTest() {
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/check-test-env.ts'], { stdio: 'inherit', windowsHide: true });
  config({ path: sqlTestEnv, override: true, quiet: true });
}
export async function preparePortugueseProfile(profile) {
  await mkdir(profile, { recursive: true });
  try { await writeFile(resolve(profile, 'presentation-v1.json'), JSON.stringify({ version: 1, language: 'pt-BR', formatLocale: 'pt-BR' }), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
