import type Sql from 'mssql';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readConfig } from './config';

export interface Connection { sql: typeof Sql; pool: Sql.ConnectionPool }
export class Database {
  private pending?: Promise<Connection>;
  constructor(private env: NodeJS.ProcessEnv = process.env) {}
  async connect(): Promise<Connection> {
    if (!this.pending) this.pending = this.open().catch(error => { this.pending = undefined; throw error; });
    return this.pending;
  }
  private async open(): Promise<Connection> {
    const settings = readConfig(this.env);
    const require = createRequire(join(__dirname, 'driver-loader.cjs'));
    const sql = require(settings.driver === 'msnodesqlv8' ? 'mssql/msnodesqlv8' : 'mssql') as typeof Sql;
    const pool = new sql.ConnectionPool(settings.config);
    pool.on('error', () => { /* Requests surface sanitized errors; never log credentials. */ });
    try { await pool.connect(); return { sql, pool }; }
    catch (error) { await pool.close().catch(() => {}); throw error; }
  }
  async close(): Promise<void> {
    const pending = this.pending; this.pending = undefined;
    if (pending) await (await pending.catch(() => null))?.pool.close();
  }
}
