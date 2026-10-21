import type { Permission } from '@shared/permissions'
import { forbidden, unauthenticated } from '../utils/errors'

/** Usuário autenticado que executa uma operação. Recarregado do banco a cada chamada IPC. */
export interface Actor {
  userId: number
  name: string
  roleKey: string
  permissions: ReadonlySet<Permission>
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw unauthenticated()
  return actor
}

/** Exige ao menos uma das permissões informadas. */
export function requirePermission(actor: Actor | null | undefined, ...anyOf: Permission[]): Actor {
  const a = requireActor(actor)
  if (!anyOf.some((p) => a.permissions.has(p))) throw forbidden()
  return a
}
