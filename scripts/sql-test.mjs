import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/sql.integration.test.ts'], { stdio: 'inherit', env: { ...process.env, JOURNEY_SQL_TEST: 'true' } });
child.on('exit', code => process.exit(code ?? 1));
