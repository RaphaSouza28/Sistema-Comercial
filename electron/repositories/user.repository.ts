import type { DbClient } from '../database/connection'

const withRole = {
  role: { include: { permissions: { select: { permissionKey: true } } } }
} as const

export function findUserById(db: DbClient, id: number) {
  return db.user.findUnique({ where: { id }, include: withRole })
}

export function findUserByUsername(db: DbClient, username: string) {
  return db.user.findUnique({ where: { username }, include: withRole })
}

export type UserWithRole = NonNullable<Awaited<ReturnType<typeof findUserById>>>

export function listUsers(db: DbClient) {
  return db.user.findMany({ include: { role: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
}

export function countUsers(db: DbClient): Promise<number> {
  return db.user.count()
}

export function countActiveUsersWithRole(db: DbClient, roleKey: string): Promise<number> {
  return db.user.count({ where: { active: true, role: { key: roleKey } } })
}

export function createUser(
  db: DbClient,
  data: {
    name: string
    username: string
    passwordHash: string
    roleId: number
    maxDiscountBps: number
    mustChangePassword: boolean
  }
) {
  return db.user.create({ data, include: { role: true } })
}

export function updateUser(
  db: DbClient,
  id: number,
  data: Partial<{
    name: string
    roleId: number
    active: boolean
    maxDiscountBps: number
    passwordHash: string
    mustChangePassword: boolean
    failedLoginAttempts: number
    lockedUntil: Date | null
    lastLoginAt: Date
  }>
) {
  return db.user.update({ where: { id }, data, include: { role: true } })
}
