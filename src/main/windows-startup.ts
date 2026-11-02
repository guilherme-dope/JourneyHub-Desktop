import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function windowsStartupOptions(profile: string, standardProfile: string, executable: string) {
  const normalized = resolve(profile).toLowerCase();
  const standard = normalized === resolve(standardProfile).toLowerCase();
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return {
    name: standard ? 'local.journeyhub.desktop' : `JourneyHub-profile-${suffix}`,
    path: executable,
    // Pass arguments as values; Electron quotes them when writing the Windows command.
    args: ['--background', `--journey-profile=${resolve(profile)}`],
  };
}
