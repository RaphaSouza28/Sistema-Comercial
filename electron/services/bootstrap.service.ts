import { ALL_PERMISSIONS, PERMISSIONS, ROLE_KEYS, SYSTEM_ROLES } from '@shared/permissions'
import type { Db, DbClient } from '../database/connection'
import { backfillCustomerSearch } from './customer.service'
import {
  createRole,
  deletePermissionsNotIn,
  findRoleByKey,
  replaceRolePermissions,
  upsertPermission
} from '../repositories/role.repository'

/**
 * Sincroniza o catálogo de permissões e garante os perfis do sistema.
 * Executado a cada inicialização. Perfis existentes mantêm as permissões
 * configuradas pelo administrador; o perfil Administrador sempre recebe todas.
 */
export async function ensureSystemRoles(db: DbClient): Promise<void> {
  for (const key of ALL_PERMISSIONS) {
    await upsertPermission(db, key, PERMISSIONS[key].module, PERMISSIONS[key].description)
  }
  await deletePermissionsNotIn(db, ALL_PERMISSIONS)

  for (const def of SYSTEM_ROLES) {
    let role = await findRoleByKey(db, def.key)
    if (!role) {
      role = await createRole(db, { key: def.key, name: def.name, description: def.description, isSystem: true })
      await replaceRolePermissions(db, role.id, def.defaults)
    } else if (def.key === ROLE_KEYS.ADMIN) {
      await replaceRolePermissions(db, role.id, ALL_PERMISSIONS)
    }
  }
}

export function bootstrapDatabase(db: Db): Promise<void> {
  return db.$transaction(async (tx) => {
    await ensureSystemRoles(tx)
    await backfillCustomerSearch(tx)
  })
}
