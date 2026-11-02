import type sql from 'mssql';
import { DomainError } from '../domain/journey';

export interface DatabaseSettings { driver: 'tedious' | 'msnodesqlv8'; config: sql.config }
export function readConfig(env: NodeJS.ProcessEnv = process.env): DatabaseSettings {
  const missing = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new DomainError('CONFIG', `Configure ${key} no arquivo .env local.`);
    return value;
  };
  const flag = (key: string, fallback: boolean) => {
    if (!env[key]) return fallback;
    if (env[key] !== 'true' && env[key] !== 'false') throw new DomainError('CONFIG', `${key} deve ser true ou false.`);
    return env[key] === 'true';
  };
  const auth = env.MSSQL_AUTH ?? 'sql';
  if (!['sql', 'windows'].includes(auth)) throw new DomainError('CONFIG', 'MSSQL_AUTH deve ser sql ou windows.');
  const driver = env.MSSQL_DRIVER ?? (auth === 'windows' ? 'msnodesqlv8' : 'tedious');
  if (!['tedious', 'msnodesqlv8'].includes(driver) || (auth === 'windows' && driver !== 'msnodesqlv8')) throw new DomainError('CONFIG', 'Driver incompatível com a autenticação.');
  const server = missing('MSSQL_SERVER');
  const database = missing('MSSQL_DATABASE');
  const instance = env.MSSQL_INSTANCE?.trim();
  const port = env.MSSQL_PORT ? Number(env.MSSQL_PORT) : undefined;
  if (server.includes('\\') && (instance || port !== undefined)) throw new DomainError('CONFIG', 'A instância já está no servidor. Remova MSSQL_INSTANCE e MSSQL_PORT ou informe somente o host em MSSQL_SERVER.');
  if ((instance && port) || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))) throw new DomainError('CONFIG', 'Use uma porta válida OU uma instância, nunca ambas.');
  const encrypt = flag('MSSQL_ENCRYPT', true);
  const trustServerCertificate = flag('MSSQL_TRUST_SERVER_CERTIFICATE', false);
  const user = auth === 'sql' ? missing('MSSQL_USER') : undefined;
  const password = auth === 'sql' ? env.MSSQL_PASSWORD : undefined;
  if (auth === 'sql' && !password) throw new DomainError('CONFIG', 'Configure MSSQL_PASSWORD no arquivo .env local.');
  const config: sql.config = {
    server, database, user, password, port,
    connectionTimeout: 5000, requestTimeout: 15000,
    pool: { min: 0, max: 4, idleTimeoutMillis: 30000 },
    options: { encrypt, trustServerCertificate, useUTC: true, ...(instance ? { instanceName: instance } : {}) },
  };
  if (driver === 'msnodesqlv8') {
    // ODBC braced values escape semicolons and closing braces, including passwords.
    const quote = (value: string) => `{${value.replace(/}/g, '}}')}}`;
    const address = port ? `${server},${port}` : instance ? `${server}\\${instance}` : server;
    Object.assign(config, { connectionString: `Driver=${quote(env.MSSQL_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server')};Server=${quote(address)};Database=${quote(database)};Encrypt=${encrypt ? 'Yes' : 'No'};TrustServerCertificate=${trustServerCertificate ? 'Yes' : 'No'};${auth === 'windows' ? 'Trusted_Connection=Yes;' : `UID=${quote(user!)};PWD=${quote(password!)};`}` });
  }
  return { driver: driver as DatabaseSettings['driver'], config };
}
