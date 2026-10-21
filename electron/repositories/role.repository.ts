import type { DbClient } from '../database/connection'

export function listRoles(db: DbClient) {
  return db.role.findMany({
    include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } },
    orderBy: { id: 'asc' }
  })
}

export function findRoleById(db: DbClient, id: number) {
  return db.role.findUnique({
    where: { id },
    include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } }
  })
}

export function findRoleByKey(db: DbClient, key: string) {
  return db.role.findUnique({ where: { key } })
}

export function listPermissions(db: DbClient) {
  return db.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] })
}

export function upsertPermission(db: DbClient, key: string, module: string, description: string) {
  return db.permission.upsert({
    where: { key },
    create: { key, module, description },
    update: { module, description }
  })
}

export function deletePermissionsNotIn(db: DbClient, keys: string[]) {
  return db.permission.deleteMany({ where: { key: { notIn: keys } } })
}

export function createRole(db: DbClient, data: { key: string; name: string; description: string; isSystem: boolean }) {
  return db.role.create({ data })
}

export async function replaceRolePermissions(db: DbClient, roleId: number, keys: string[]): Promise<void> {
  await db.rolePermission.deleteMany({ where: { roleId } })
  if (keys.length > 0) {
    await db.rolePermission.createMany({ data: keys.map((permissionKey) => ({ roleId, permissionKey })) })
  }
}
