import { config } from 'dotenv';
import { Database } from '../src/main/database';
import { assertIsolatedSql } from './test-safety';

async function main() {
  config({ path: '.env.adapter-test', override: true, quiet: true });
  const db = new Database();
  try { await assertIsolatedSql(db); }
  finally { await db.close(); }
}
main().catch(() => { console.error('Unsafe or unavailable SQL test environment. Aborting before application launch.'); process.exitCode = 1; });
