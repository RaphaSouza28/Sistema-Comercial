import { afterEach, describe, expect, it } from 'vitest'
import { createServices } from '../../electron/services'
import type { Actor } from '../../electron/services/context'
import { createTestDatabase, setupAdmin, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

async function scenario() {
  t = await createTestDatabase()
  const admin = await setupAdmin(t.db)
  const s = createServices(t.db)
  const roles = await s.users.listRoles(admin)
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id
  const make = async (username: string, key: string): Promise<Actor> => {
    const u = await s.users.create(admin, {
      name: username,
      username,
      roleId: roleId(key),
      password: 'senha1234',
      passwordConfirm: 'senha1234'
    })
    return (await s.auth.loadActor(u.id)).actor
  }
  return { s, admin, roleId, operator: await make('caixa', 'OPERATOR'), manager: await make('gerente', 'MANAGER') }
}

describe('permissões verificadas nos serviços', () => {
  it('operador não acessa dashboard, usuários nem configurações da empresa', async () => {
    const { s, operator } = await scenario()
    await expect(s.dashboard.summary(operator)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.users.list(operator)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.company.update(operator, { legalName: 'Hack' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(operator.permissions.has('products.cost')).toBe(false)
    expect(operator.permissions.has('pdv.sell')).toBe(true)
  })

  it('chamadas sem sessão são recusadas', async () => {
    const { s } = await scenario()
    await expect(s.dashboard.summary(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(s.company.get(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('gerente acessa dashboard mas não gerencia usuários', async () => {
    const { s, manager } = await scenario()
    await expect(s.dashboard.summary(manager)).resolves.toBeDefined()
    await expect(s.users.list(manager)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('permissões do gerente são configuráveis e valem imediatamente', async () => {
    const { s, admin, manager, roleId } = await scenario()
    const role = await s.users.updateRolePermissions(admin, { roleId: roleId('MANAGER'), permissions: ['pdv.sell'] })
    expect(role.permissions).toEqual(['pdv.sell'])
    const reloaded = (await s.auth.loadActor(manager.userId)).actor
    await expect(s.dashboard.summary(reloaded)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await t.db.auditLog.count({ where: { action: 'role.update_permissions' } })).toBe(1)
  })

  it('perfil Administrador não pode ter permissões reduzidas', async () => {
    const { s, admin, roleId } = await scenario()
    await expect(
      s.users.updateRolePermissions(admin, { roleId: roleId('ADMIN'), permissions: [] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejeita permissões inexistentes', async () => {
    const { s, admin, roleId } = await scenario()
    await expect(
      s.users.updateRolePermissions(admin, { roleId: roleId('OPERATOR'), permissions: ['tudo.liberado'] })
    ).rejects.toThrow()
  })
})

describe('gestão de usuários', () => {
  it('impede nome de usuário duplicado', async () => {
    const { s, admin, roleId } = await scenario()
    await expect(
      s.users.create(admin, { name: 'Outro', username: 'CAIXA', roleId: roleId('OPERATOR'), password: 'senha1234', passwordConfirm: 'senha1234' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('administrador não pode desativar a si mesmo', async () => {
    const { s, admin, roleId } = await scenario()
    await expect(
      s.users.update(admin, { id: admin.userId, name: 'Administrador', roleId: roleId('ADMIN'), active: false, maxDiscountBps: 0 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('mantém ao menos um administrador ativo', async () => {
    const { s, admin, manager, roleId } = await scenario()
    // Gerente recebe permissão de gerenciar usuários e tenta rebaixar o único administrador.
    await s.users.updateRolePermissions(admin, { roleId: roleId('MANAGER'), permissions: ['users.manage'] })
    const managerActor = (await s.auth.loadActor(manager.userId)).actor
    const demote = { id: admin.userId, name: 'Administrador', roleId: roleId('MANAGER'), active: true, maxDiscountBps: 0 }
    await expect(s.users.update(managerActor, demote)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.users.update(managerActor, { ...demote, roleId: roleId('ADMIN'), active: false })).rejects.toMatchObject({
      code: 'CONFLICT'
    })

    // Com um segundo administrador, o rebaixamento passa a ser permitido.
    await s.users.create(admin, {
      name: 'Admin 2',
      username: 'admin2',
      roleId: roleId('ADMIN'),
      password: 'senha1234',
      passwordConfirm: 'senha1234'
    })
    const updated = await s.users.update(managerActor, demote)
    expect(updated.role.key).toBe('MANAGER')
    expect(await t.db.user.count({ where: { active: true, role: { key: 'ADMIN' } } })).toBe(1)
  })

  it('redefinição de senha obriga troca no próximo acesso e desbloqueia o usuário', async () => {
    const { s, admin, operator } = await scenario()
    await t.db.user.update({ where: { id: operator.userId }, data: { lockedUntil: new Date(Date.now() + 3600_000) } })
    await s.users.resetPassword(admin, { id: operator.userId, password: 'nova12345', passwordConfirm: 'nova12345' })
    const session = await s.auth.login({ username: 'caixa', password: 'nova12345' })
    expect(session.mustChangePassword).toBe(true)
  })
})

describe('serviços diversos', () => {
  it('administrador atualiza dados da empresa com auditoria', async () => {
    const { s, admin } = await scenario()
    const updated = await s.company.update(admin, { legalName: 'Nova Razão', city: 'Curitiba', state: 'pr' })
    expect(updated.legalName).toBe('Nova Razão')
    expect(updated.state).toBe('PR')
    expect(await t.db.auditLog.count({ where: { action: 'company.update' } })).toBe(1)
  })
})
