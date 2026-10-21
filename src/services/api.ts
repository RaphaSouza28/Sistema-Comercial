import type { ApiErrorPayload, ApiResult } from '@shared/api'

/** Erro vindo do processo principal, com mensagem pronta para o usuário e erros por campo. */
export class ApiError extends Error {
  readonly code: ApiErrorPayload['code']
  readonly fields: Record<string, string>

  constructor(payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code
    this.fields = payload.fields ?? {}
  }
}

/** Desembrulha um ApiResult: devolve os dados ou lança ApiError. */
export async function call<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>
  try {
    result = await promise
  } catch {
    throw new ApiError({ code: 'INTERNAL', message: 'Falha de comunicação com o sistema. Reinicie o aplicativo.' })
  }
  if (!result.ok) {
    if (result.error.code === 'UNAUTHENTICATED') window.dispatchEvent(new CustomEvent('sc:unauthenticated'))
    throw new ApiError(result.error)
  }
  return result.data
}

export const api = window.api

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {}
}
