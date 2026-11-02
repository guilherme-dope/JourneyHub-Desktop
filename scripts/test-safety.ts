import { Database } from '../src/main/database';
import { readConfig } from '../src/main/config';

export async function assertIsolatedSql(db: Database): Promise<void> {
  const settings = readConfig();
  if (settings.config.database !== 'JourneyHub_adapter_test' || settings.config.user !== 'journeyhub_adapter_test') {
    throw new Error('Tests require the explicitly provisioned persistence database and dedicated login.');
  }
  const { pool } = await db.connect();
  const result = await pool.request().query("SELECT DB_NAME() AS Name, HAS_DBACCESS(N'JourneyHub') AS ProductionAccess, IS_SRVROLEMEMBER('sysadmin') AS Admin;");
  const row = result.recordset[0];
  if (row.Name !== 'JourneyHub_adapter_test' || row.ProductionAccess === 1 || row.Admin !== 0) {
    throw new Error('Unsafe SQL test connection. No mutations permitted.');
  }
}

