import { expect, it } from 'vitest';
import { config } from 'dotenv';
import { Database } from '../src/main/database';
import { assertIsolatedSql } from '../scripts/test-safety';
import { connectExistingSql } from '../src/main/existing-sql';

it.skipIf(process.env.JOURNEY_SQL_TEST !== 'true')('verifica conexão real e prepara perfil separado sem alterar registros SQL', async () => {
  config({ path: '.env.adapter-test', override: true, quiet: true });
  const db = new Database();
  try {
    await assertIsolatedSql(db);
    const { pool } = await db.connect();
    const snapshot = async () => {
      const parts = [];
      for (const table of ['WorkSessions', 'Breaks', 'AuditLog']) {
        const result = await pool.request().query(`SELECT * FROM journey.${table} ORDER BY Id FOR JSON PATH, INCLUDE_NULL_VALUES`);
        parts.push(JSON.stringify(result.recordset));
      }
      return parts;
    };
    const before = await snapshot();
    const connection = await connectExistingSql('.env.adapter-test');
    try { expect((await connection.repository.health()).ready).toBe(true); }
    finally { await connection.database.close(); }
    expect(await snapshot()).toEqual(before);
  } finally { await db.close(); }
});
