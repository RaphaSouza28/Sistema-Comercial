import type { SessionUser } from '@shared/api'
import { ALL_PERMISSIONS, ROLE_KEYS, isPermission, type Permission } from '@shared/permissions'
import { changePasswordSchema, loginSchema } from '@shared/schemas'
import { authorizationSchema } from '@shared/salesSchemas'
import type { Db } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { findUserById, findUserByUsername, updateUser, type UserWithRole } from '../repositories/user.repository'
import { AppError, unauthenticated, validationError } from '../utils/errors'
import { getDummyHash, hashPassword, verifyPassword } from '../utils/password'
import { requireActor, type Actor } from './context'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 5

const INVALID_CREDENTIALS = 'Usuário ou senha inválidos.'

export function permissionsOf(user: UserWithRole): Permission[] {
  if (user.role.key === ROLE_KEYS.ADMIN) return [...ALL_PERMISSIONS]
  return user.role.permissions.map((p) => p.permissionKey).filter(isPermission)
}

export function toSessionUser(user: UserWithRole): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: { id: user.role.id, key: user.role.key, name: user.role.name },
    permissions: permissionsOf(user),
    maxDiscountBps: user.role.key === ROLE_KEYS.ADMIN ? 10000 : user.maxDiscountBps,
    mustChangePassword: user.mustChangePassword
  }
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  async login(input: unknown): Promise<SessionUser> {
    const { username, password } = loginSchema.parse(input)
    const user = await findUserByUsername(this.db, username)

    if (!user) {
      await verifyPassword(password, await getDummyHash()) // tempo de resposta uniforme
      await writeAudit(this.db, { action: 'auth.login_failed', details: { username, reason: 'unknown_user' } })
      throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS)
    }

    const now = this.now()
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000))
      throw new AppError(
        'LOCKED',
        `Usuário bloqueado temporariamente por excesso de tentativas. Tente novamente em ${minutes} min.`
      )
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1
      const lock = attempts >= MAX_FAILED_ATTEMPTS
      await updateUser(this.db, user.id, {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null
      })
      await writeAudit(this.db, {
        userId: user.id,
        action: lock ? 'auth.locked' : 'auth.login_failed',
        entity: 'User',
        entityId: user.id,
        details: { attempts }
      })
      if (lock) {
        throw new AppError(
          'LOCKED',
          `Usuário bloqueado por ${LOCK_MINUTES} minutos após ${MAX_FAILED_ATTEMPTS} tentativas inválidas.`
        )
      }
      throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS)
    }

    if (!user.active) {
      throw new AppError('FORBIDDEN', 'Usuário desativado. Procure o administrador do sistema.')
    }

    const updated = await this.db.$transaction(async (tx) => {
      await updateUser(tx, user.id, { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now })
      await writeAudit(tx, { userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id })
      return findUserById(tx, user.id)
    })
    return toSessionUser(updated!)
  }

  /**
   * Autorização pontual por outro usuário (supervisor) — ex.: desconto acima do limite ou
   * cancelamento. Valida credenciais com as mesmas proteções do login (bloqueio após
   * tentativas, tempo uniforme) e exige a permissão informada. Devolve o Actor do autorizador.
   */
  async verifyAuthorizer(
    input: unknown,
    permission: Permission,
    context: { action: string; requestedBy: number; minDiscountBps?: number }
  ): Promise<Actor> {
    const { username, password } = authorizationSchema.parse(input)
    const user = await findUserByUsername(this.db, username)
    const deny = async (reason: string, userId: number | null = null) => {
      await writeAudit(this.db, {
        userId: context.requestedBy,
        action: 'auth.authorization_denied',
        details: { action: context.action, authorizer: username, authorizerId: userId, reason }
      })
      return new AppError('FORBIDDEN', 'Autorização negada: usuário, senha ou permissão inválidos.')
    }
    if (!user) {
      await verifyPassword(password, await getDummyHash())
      throw await deny('unknown_user')
    }
    const now = this.now()
    if (user.lockedUntil && user.lockedUntil > now) throw new AppError('LOCKED', 'Usuário autorizador bloqueado temporariamente.')
    if (!(await verifyPassword(password, user.passwordHash))) {
      const attempts = user.failedLoginAttempts + 1
      const lock = attempts >= MAX_FAILED_ATTEMPTS
      await updateUser(this.db, user.id, {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null
      })
      throw await deny('wrong_password', user.id)
    }
    const { actor, session } = await this.loadActor(user.id).catch(async () => {
      throw await deny('inactive', user.id)
    })
    if (!actor.permissions.has(permission)) throw await deny('missing_permission', user.id)
    if (context.minDiscountBps !== undefined && session.maxDiscountBps < context.minDiscountBps) {
      throw await deny('discount_limit', user.id)
    }
    await updateUser(this.db, user.id, { failedLoginAttempts: 0, lockedUntil: null })
    await writeAudit(this.db, {
      userId: context.requestedBy,
      action: 'auth.authorization_granted',
      details: { action: context.action, authorizerId: user.id }
    })
    return actor
  }

  /** Carrega o usuário da sessão; falha se ele foi removido ou desativado. */
  async loadActor(userId: number): Promise<{ actor: Actor; session: SessionUser }> {
    const user = await findUserById(this.db, userId)
    if (!user || !user.active) throw unauthenticated()
    const session = toSessionUser(user)
    return {
      session,
      actor: { userId: user.id, name: user.name, roleKey: user.role.key, permissions: new Set(session.permissions) }
    }
  }

  async logout(actor: Actor | null): Promise<void> {
    if (actor) await writeAudit(this.db, { userId: actor.userId, action: 'auth.logout', entity: 'User', entityId: actor.userId })
  }

  async changePassword(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requireActor(actorInput)
    const data = changePasswordSchema.parse(input)
    const user = await findUserById(this.db, actor.userId)
    if (!user) throw unauthenticated()
    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      throw validationError('Senha atual incorreta.', { currentPassword: 'Senha atual incorreta' })
    }
    if (data.currentPassword === data.newPassword) {
      throw validationError('A nova senha deve ser diferente da atual.', {
        newPassword: 'A nova senha deve ser diferente da atual'
      })
    }
    const passwordHash = await hashPassword(data.newPassword)
    await this.db.$transaction(async (tx) => {
      await updateUser(tx, user.id, { passwordHash, mustChangePassword: false })
      await writeAudit(tx, { userId: user.id, action: 'auth.password_changed', entity: 'User', entityId: user.id })
    })
  }
}
