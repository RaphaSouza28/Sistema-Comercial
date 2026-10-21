import type { PermissionDto, RoleDto, UserDto } from '@shared/api'
import { ROLE_KEYS, isPermission } from '@shared/permissions'
import {
  roleUpdatePermissionsSchema,
  userCreateSchema,
  userResetPasswordSchema,
  userUpdateSchema
} from '@shared/schemas'
import type { Db } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import {
  findRoleById,
  listPermissions,
  listRoles,
  replaceRolePermissions
} from '../repositories/role.repository'
import {
  countActiveUsersWithRole,
  createUser,
  findUserById,
  findUserByUsername,
  listUsers,
  updateUser
} from '../repositories/user.repository'
import { conflict, forbidden, notFound, validationError } from '../utils/errors'
import { hashPassword } from '../utils/password'
import { requirePermission, type Actor } from './context'

type UserRow = Awaited<ReturnType<typeof listUsers>>[number]
type RoleRow = Awaited<ReturnType<typeof listRoles>>[number]

function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    active: u.active,
    maxDiscountBps: u.maxDiscountBps,
    mustChangePassword: u.mustChangePassword,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    role: { id: u.role.id, key: u.role.key, name: u.role.name }
  }
}

function toRoleDto(r: RoleRow): RoleDto {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    editable: r.key !== ROLE_KEYS.ADMIN,
    permissions: r.permissions.map((p) => p.permissionKey).filter(isPermission),
    userCount: r._count.users
  }
}

/** Funcionários, perfis e permissões. Todas as operações exigem users.manage. */
export class UserService {
  constructor(private readonly db: Db) {}

  async list(actor: Actor | null): Promise<UserDto[]> {
    requirePermission(actor, 'users.manage')
    return (await listUsers(this.db)).map(toUserDto)
  }

  async create(actorInput: Actor | null, input: unknown): Promise<UserDto> {
    const actor = requirePermission(actorInput, 'users.manage')
    const data = userCreateSchema.parse(input)
    const role = await findRoleById(this.db, data.roleId)
    if (!role) throw validationError('Perfil inválido.', { roleId: 'Perfil inválido' })
    if (await findUserByUsername(this.db, data.username)) {
      throw conflict('Este nome de usuário já está em uso.')
    }
    const passwordHash = await hashPassword(data.password)
    const user = await this.db.$transaction(async (tx) => {
      const created = await createUser(tx, {
        name: data.name,
        username: data.username,
        passwordHash,
        roleId: role.id,
        maxDiscountBps: data.maxDiscountBps,
        mustChangePassword: data.mustChangePassword
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'user.create',
        entity: 'User',
        entityId: created.id,
        details: { username: created.username, role: role.key }
      })
      return created
    })
    return toUserDto(user)
  }

  async update(actorInput: Actor | null, input: unknown): Promise<UserDto> {
    const actor = requirePermission(actorInput, 'users.manage')
    const data = userUpdateSchema.parse(input)
    const target = await findUserById(this.db, data.id)
    if (!target) throw notFound('Usuário não encontrado.')
    const role = await findRoleById(this.db, data.roleId)
    if (!role) throw validationError('Perfil inválido.', { roleId: 'Perfil inválido' })

    if (target.id === actor.userId && (!data.active || role.id !== target.roleId)) {
      throw forbidden('Você não pode desativar nem alterar o perfil do seu próprio usuário.')
    }

    const losesAdmin = target.role.key === ROLE_KEYS.ADMIN && target.active && (!data.active || role.key !== ROLE_KEYS.ADMIN)

    const updated = await this.db.$transaction(async (tx) => {
      if (losesAdmin && (await countActiveUsersWithRole(tx, ROLE_KEYS.ADMIN)) <= 1) {
        throw conflict('É necessário manter ao menos um administrador ativo.')
      }
      const u = await updateUser(tx, target.id, {
        name: data.name,
        roleId: role.id,
        active: data.active,
        maxDiscountBps: data.maxDiscountBps
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'user.update',
        entity: 'User',
        entityId: target.id,
        details: {
          before: { name: target.name, role: target.role.key, active: target.active, maxDiscountBps: target.maxDiscountBps },
          after: { name: data.name, role: role.key, active: data.active, maxDiscountBps: data.maxDiscountBps }
        }
      })
      return u
    })
    return toUserDto(updated)
  }

  async resetPassword(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'users.manage')
    const data = userResetPasswordSchema.parse(input)
    const target = await findUserById(this.db, data.id)
    if (!target) throw notFound('Usuário não encontrado.')
    const passwordHash = await hashPassword(data.password)
    await this.db.$transaction(async (tx) => {
      await updateUser(tx, target.id, {
        passwordHash,
        mustChangePassword: target.id !== actor.userId,
        failedLoginAttempts: 0,
        lockedUntil: null
      })
      await writeAudit(tx, { userId: actor.userId, action: 'user.reset_password', entity: 'User', entityId: target.id })
    })
  }

  async listRoles(actor: Actor | null): Promise<RoleDto[]> {
    requirePermission(actor, 'users.manage')
    return (await listRoles(this.db)).map(toRoleDto)
  }

  async listPermissions(actor: Actor | null): Promise<PermissionDto[]> {
    requirePermission(actor, 'users.manage')
    return (await listPermissions(this.db))
      .filter((p) => isPermission(p.key))
      .map((p) => ({ key: p.key as PermissionDto['key'], module: p.module, description: p.description }))
  }

  async updateRolePermissions(actorInput: Actor | null, input: unknown): Promise<RoleDto> {
    const actor = requirePermission(actorInput, 'users.manage')
    const data = roleUpdatePermissionsSchema.parse(input)
    const role = await findRoleById(this.db, data.roleId)
    if (!role) throw notFound('Perfil não encontrado.')
    if (role.key === ROLE_KEYS.ADMIN) throw forbidden('O perfil Administrador sempre possui acesso completo.')
    const keys = [...new Set(data.permissions)]
    await this.db.$transaction(async (tx) => {
      await replaceRolePermissions(tx, role.id, keys)
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'role.update_permissions',
        entity: 'Role',
        entityId: role.id,
        details: { before: role.permissions.map((p) => p.permissionKey), after: keys }
      })
    })
    return toRoleDto((await findRoleById(this.db, role.id))!)
  }
}
