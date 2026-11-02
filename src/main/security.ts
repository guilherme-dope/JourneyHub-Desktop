import { DomainError } from '../domain/journey';
import { ZodError } from 'zod';
import type { Result } from '../shared/contracts';
export function trustedSender(senderId: number, frameIsMain: boolean, frameUrl: string | undefined, expectedId: number, expectedUrl: string): boolean {
  return senderId === expectedId && frameIsMain && frameUrl === expectedUrl;
}
export function safeError(error: unknown, translate: (message: string) => string = value => value): Result<never> {
  const result = errorResult(error);
  return result.ok ? result : { ...result, message: translate(result.message) };
}
function errorResult(error: unknown): Result<never> {
  if (error instanceof DomainError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof ZodError) return { ok: false, code: 'VALIDATION', message: 'Dados inválidos. Confira os horários, motivos e campos obrigatórios.' };
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return { ok: false, code: 'FILE_EXISTS', message: 'Já existe um arquivo com esse nome. Escolha um nome novo.' };
  if (error && typeof error === 'object' && 'code' in error && ['ESOCKET', 'ELOGIN', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINSTLOOKUP'].includes(String(error.code))) return { ok: false, code: 'CONNECTION', message: 'A conexão com o SQL Server falhou. Verifique o servidor e clique em Atualizar. O resultado da gravação não foi confirmado; consulte a jornada antes de tentar novamente.' };
  return { ok: false, code: 'INFRASTRUCTURE', message: 'Não foi possível concluir a operação. Verifique o armazenamento, as permissões ou o destino do arquivo. Nenhum sucesso foi confirmado; atualize a tela antes de tentar novamente.' };
}
