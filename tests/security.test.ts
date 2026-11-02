import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/main/config';
import { safeError, trustedSender } from '../src/main/security';
import { DomainError } from '../src/domain/journey';
describe('fronteira de segurança', () => {
  it('aceita só a janela, frame e URL esperados', () => {
    const url = 'file:///app/index.html';
    expect(trustedSender(1, true, url, 1, url)).toBe(true);
    for (const [id, main, address] of [[2, true, url], [1, false, url], [1, true, `${url}?other`], [1, true, 'https://attacker.invalid']] as const) expect(trustedSender(id, main, address, 1, url)).toBe(false);
  });
  it('não revela mensagens técnicas ou credenciais', () => {
    const result = safeError(new Error('Password=do-not-return-this; server private; stack trace'));
    expect(JSON.stringify(result)).not.toContain('do-not-return-this');
    expect(safeError(new DomainError('CONFLICT', 'Atualize a jornada'))).toEqual({ ok: false, code: 'CONFLICT', message: 'Atualize a jornada' });
  });
});
describe('configuração SQL Server', () => {
  const base = { MSSQL_SERVER: 'localhost', MSSQL_DATABASE: 'JourneyHub_test', MSSQL_AUTH: 'sql', MSSQL_USER: 'fixture_user', MSSQL_PASSWORD: 'fixture_only' };
  it('recusa configuração incompleta', () => { expect(() => readConfig({})).toThrow('MSSQL_SERVER'); expect(() => readConfig({ ...base, MSSQL_PASSWORD: '' })).toThrow('MSSQL_PASSWORD'); });
  it('ativa criptografia e valida certificado por padrão', () => { expect(readConfig(base).config.options).toMatchObject({ encrypt: true, trustServerCertificate: false }); });
  it('recusa porta e instância simultâneas e booleanos inválidos', () => {
    expect(() => readConfig({ ...base, MSSQL_SERVER: 'localhost\\SQLEXPRESS', MSSQL_PORT: '1433' })).toThrow();
    expect(() => readConfig({ ...base, MSSQL_SERVER: 'localhost\\SQLEXPRESS', MSSQL_INSTANCE: 'SQLEXPRESS' })).toThrow();
    expect(() => readConfig({ ...base, MSSQL_PORT: '1433', MSSQL_INSTANCE: 'SQLEXPRESS' })).toThrow();
    expect(() => readConfig({ ...base, MSSQL_PORT: 'abc' })).toThrow();
    expect(() => readConfig({ ...base, MSSQL_ENCRYPT: 'yes' })).toThrow();
  });
  it('usa driver nativo para Windows e escapa parâmetros ODBC', () => {
    expect(readConfig({ ...base, MSSQL_AUTH: 'windows' }).driver).toBe('msnodesqlv8');
    const config = readConfig({ ...base, MSSQL_DRIVER: 'msnodesqlv8', MSSQL_PASSWORD: 'a};Trusted_Connection=Yes;{' }).config as unknown as { connectionString: string };
    expect(config.connectionString).toContain('PWD={a}};Trusted_Connection=Yes;{};');
  });
});
