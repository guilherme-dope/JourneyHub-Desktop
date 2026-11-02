// Build-first desktop workflow keeps a strict local CSP in development too.
import './build.mjs';
import { spawn } from 'node:child_process';
import electron from 'electron';
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: launchEnv });
child.on('exit', code => process.exit(code ?? 1));
