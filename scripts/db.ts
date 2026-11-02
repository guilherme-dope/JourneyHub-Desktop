import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { Database } from '../src/main/database';
import { JourneyRepository } from '../src/main/repository';
const db = new Database();
async function main() {
  if (process.argv[2] === 'migrate') {
    // Must be run explicitly with a deployment identity, never by the renderer.
    const { pool } = await db.connect();
    for (const file of (await readdir('sql')).filter(f => /^\d+.*\.sql$/.test(f)).sort()) await pool.request().batch(await readFile(`sql/${file}`, 'utf8'));
    console.log('Migrações aplicadas. Configure o login de execução na função journey_app.');
  } else console.log(JSON.stringify(await new JourneyRepository(db).health(), null, 2));
}
main().catch(e => { console.error('Verificação falhou:', e.code ?? 'DATABASE', 'Confira servidor, autenticação, permissões e driver no .env.'); process.exitCode = 1; }).finally(() => db.close());
