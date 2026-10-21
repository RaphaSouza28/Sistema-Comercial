import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { ApiResult } from '@shared/api'
import type { Actor } from '../../services/context'
import type { Services } from '../../services'
import { toErrorPayload } from '../../utils/errors'
import { logger } from '../../utils/logger'

/** Sessões autenticadas por janela (webContents.id -> id do usuário). Mantidas só em memória. */
export class SessionStore {
  private readonly sessions = new Map<number, { userId: number; lastSeen: number }>()
  /** Bloqueio por inatividade em minutos (0 = desligado); vem de Configurações → Segurança. */
  idleMinutes = 0

  constructor(private readonly now: () => number = () => Date.now()) {}
  /** Janelas que já têm o listener de limpeza (evita um listener novo a cada login). */
  private readonly tracked = new Set<number>()

  /** Usuário da janela; sessão parada além do limite é encerrada (o usuário volta ao login). */
  get(webContentsId: number): number | undefined {
    const s = this.sessions.get(webContentsId)
    if (!s) return undefined
    const t = this.now()
    if (this.idleMinutes > 0 && t - s.lastSeen > this.idleMinutes * 60_000) {
      this.sessions.delete(webContentsId)
      logger.info('Sessão encerrada por inatividade', { userId: s.userId })
      return undefined
    }
    s.lastSeen = t
    return s.userId
  }

  set(sender: WebContents, userId: number): void {
    const id = sender.id
    if (!this.tracked.has(id)) {
      this.tracked.add(id)
      sender.once('destroyed', () => {
        this.sessions.delete(id)
        this.tracked.delete(id)
      })
    }
    this.sessions.set(id, { userId, lastSeen: this.now() })
  }

  delete(webContentsId: number): void {
    this.sessions.delete(webContentsId)
  }
}

export interface HandlerContext {
  actor: Actor | null
  sender: WebContents
}

export type Handler = (input: unknown, ctx: HandlerContext) => Promise<unknown>

export interface RouterDeps {
  services: Services
  sessions: SessionStore
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

/**
 * Registra um canal IPC com:
 *  - validação do remetente (apenas a janela do aplicativo);
 *  - recarga do usuário da sessão a cada chamada (usuário desativado perde acesso na hora);
 *  - conversão de erros para um resultado serializável, sem vazar detalhes internos.
 * A validação dos argumentos (Zod) e das permissões acontece dentro dos serviços.
 */
export function createRouter({ services, sessions, isTrustedSender }: RouterDeps) {
  return function handle(channel: string, handler: Handler): void {
    ipcMain.handle(channel, async (event, input: unknown): Promise<ApiResult<unknown>> => {
      if (!isTrustedSender(event)) {
        logger.warn('Chamada IPC rejeitada: remetente não confiável', { channel, url: event.senderFrame?.url })
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Origem não autorizada.' } }
      }
      try {
        let actor: Actor | null = null
        const userId = sessions.get(event.sender.id)
        if (userId !== undefined) {
          try {
            actor = (await services.auth.loadActor(userId)).actor
          } catch {
            sessions.delete(event.sender.id)
          }
        }
        const data = await handler(input, { actor, sender: event.sender })
        return { ok: true, data: data ?? null }
      } catch (error) {
        const { payload, unexpected } = toErrorPayload(error)
        if (unexpected) logger.error(`Erro no canal ${channel}`, error)
        return { ok: false, error: payload }
      }
    })
  }
}
