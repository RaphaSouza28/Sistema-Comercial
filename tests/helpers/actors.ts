import type { Db } from '../../electron/database/connection'
import { createServices } from '../../electron/services'
import type { Actor } from '../../electron/services/context'
import { setupAdmin } from './db'

/** Administrador + gerente + operador prontos para os testes. */
export async function actors(db: Db) {
  const admin = await setupAdmin(db)
  const s = createServices(db)
  const roles = await s.users.listRoles(admin)
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id
  const make = async (username: string, key: string): Promise<Actor> => {
    const u = await s.users.create(admin, { name: username, username, roleId: roleId(key), password: 'senha1234', passwordConfirm: 'senha1234' })
    return (await s.auth.loadActor(u.id)).actor
  }
  const manager = await make('gerente', 'MANAGER')
  const operator = await make('caixa', 'OPERATOR')
  const reload = async (a: Actor) => (await s.auth.loadActor(a.userId)).actor
  return { s, admin, manager, operator, roleId, reload }
}
