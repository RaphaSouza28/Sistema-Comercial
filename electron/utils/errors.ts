import { ZodError } from 'zod'
import type { ApiErrorPayload } from '@shared/api'

/** Erro de negócio com mensagem segura para exibir ao usuário. */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorPayload['code'],
    message: string,
    public readonly fields?: Record<string, string>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const validationError = (message: string, fields?: Record<string, string>) =>
  new AppError('VALIDATION', message, fields)
export const unauthenticated = (message = 'Sessão expirada. Entre novamente.') =>
  new AppError('UNAUTHENTICATED', message)
export const forbidden = (message = 'Você não tem permissão para esta operação.') => new AppError('FORBIDDEN', message)
export const notFound = (message = 'Registro não encontrado.') => new AppError('NOT_FOUND', message)
export const conflict = (message: string) => new AppError('CONFLICT', message)

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  return fields
}

/** Converte qualquer erro em payload seguro para o renderer. Erros inesperados não vazam detalhes. */
export function toErrorPayload(error: unknown): { payload: ApiErrorPayload; unexpected: boolean } {
  if (error instanceof AppError) {
    return { payload: { code: error.code, message: error.message, fields: error.fields }, unexpected: false }
  }
  if (error instanceof ZodError) {
    return {
      payload: { code: 'VALIDATION', message: 'Verifique os campos destacados.', fields: zodFieldErrors(error) },
      unexpected: false
    }
  }
  // Restrições do banco que escaparam das validações dos serviços (ex.: dois cadastros simultâneos).
  const prismaCode = (error as { code?: unknown } | null)?.code
  if (prismaCode === 'P2002') {
    return { payload: { code: 'CONFLICT', message: 'Já existe um registro com estes dados.' }, unexpected: false }
  }
  if (prismaCode === 'P2003') {
    return {
      payload: { code: 'CONFLICT', message: 'A operação não é permitida porque há registros vinculados.' },
      unexpected: false
    }
  }
  if (prismaCode === 'P2025') {
    return { payload: { code: 'NOT_FOUND', message: 'Registro não encontrado.' }, unexpected: false }
  }
  return {
    payload: { code: 'INTERNAL', message: 'Ocorreu um erro inesperado. A operação não foi concluída.' },
    unexpected: true
  }
}
