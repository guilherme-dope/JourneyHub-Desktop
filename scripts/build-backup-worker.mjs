import { build } from 'esbuild';
await build({ entryPoints: ['src/main/backup-worker.ts'], outfile: 'dist/main/backup-worker.cjs', bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
