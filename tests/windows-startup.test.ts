import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { windowsStartupOptions } from '../src/main/windows-startup';

it('mantém o nome estável para o perfil normal e separa perfis de teste', () => {
  const standard = resolve('normal-profile');
  const normal = windowsStartupOptions(standard, standard, 'JourneyHub.exe');
  const custom = windowsStartupOptions(resolve('profile with spaces'), standard, 'JourneyHub.exe');
  expect(normal.name).toBe('local.journeyhub.desktop');
  expect(custom.name).not.toBe(normal.name);
  expect(custom.args).toEqual(['--background', `--journey-profile=${resolve('profile with spaces')}`]);
  expect(windowsStartupOptions(resolve('profile with spaces'), standard, 'new-version.exe').name).toBe(custom.name);
});
