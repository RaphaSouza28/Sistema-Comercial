import { afterEach, describe, expect, it } from 'vitest'
import { createServices } from '../../electron/services'
import { AuthService, LOCK_MINUTES, MAX_FAILED_ATTEMPTS } from '../../electron/services/auth.service'
import { createTestDatabase, validSetup, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

describe('assistente de primeiro acesso', () => {
  it('indica configuração pendente e cria empresa + administrador', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    expect(await s.setup.status()).toEqual({ needsSetup: true })

    const user = await s.setup.complete(validSetup())
    expect(user.username).toBe('admin') // normalizado para minúsculas
    expect(user.role.key).toBe('ADMIN')
    expect(user.permissions).toContain('users.manage')
    expect(await s.setup.status()).toEqual({ needsSetup: false })

    const stored = await t.db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(stored.passwordHash).not.toContain('senhaForte1')
    const company = await t.db.company.findFirstOrThrow()
    expect(company.document).toBe('11222333000181')
    expect(await t.db.auditLog.count({ where: { action: 'setup.completed' } })).toBe(1)
  })

  it('não permite executar o assistente duas vezes', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    await s.setup.complete(validSetup())
    await expect(s.setup.complete(validSetup())).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await t.db.user.count()).toBe(1)
  })

  it('valida dados do assistente (senha fraca, confirmação e CNPJ)', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    const weak = validSetup()
    weak.admin.password = weak.admin.passwordConfirm = 'abc'
    await expect(s.setup.complete(weak)).rejects.toThrow()
    const mismatch = validSetup()
    mismatch.admin.passwordConfirm = 'outraSenha1'
    await expect(s.setup.complete(mismatch)).rejects.toThrow()
    const badDoc = validSetup()
    badDoc.company.document = '11.222.333/0001-00'
    await expect(s.setup.complete(badDoc)).rejects.toThrow()
    expect(await t.db.user.count()).toBe(0)
    expect(await t.db.company.count()).toBe(0)
  })
})

describe('login', () => {
  it('autentica com usuário sem diferenciar maiúsculas e registra auditoria', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    await s.setup.complete(validSetup())
    const user = await s.auth.login({ username: '  ADMIN ', password: 'senhaForte1' })
    expect(user.name).toBe('Administrador')
    expect(await t.db.auditLog.count({ where: { action: 'auth.login' } })).toBe(1)
    const stored = await t.db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(stored.lastLoginAt).not.toBeNull()
  })

  it('recusa senha incorreta e usuário inexistente com a mesma mensagem', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    await s.setup.complete(validSetup())
    const wrong = await s.auth.login({ username: 'admin', password: 'errada123' }).catch((e) => e)
    const unknown = await s.auth.login({ username: 'fulano', password: 'errada123' }).catch((e) => e)
    expect(wrong.code).toBe('UNAUTHENTICATED')
    expect(unknown.code).toBe('UNAUTHENTICATED')
    expect(wrong.message).toBe(unknown.message)
  })

  it(`bloqueia após ${MAX_FAILED_ATTEMPTS} tentativas e libera após ${LOCK_MINUTES} minutos`, async () => {
    t = await createTestDatabase()
    await createServices(t.db).setup.complete(validSetup())
    let now = new Date('2026-10-20T10:00:00')
    const auth = new AuthService(t.db, () => now)

    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      await expect(auth.login({ username: 'admin', password: 'errada123' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    }
    await expect(auth.login({ username: 'admin', password: 'errada123' })).rejects.toMatchObject({ code: 'LOCKED' })
    // Mesmo com a senha correta, permanece bloqueado durante o período.
    await expect(auth.login({ username: 'admin', password: 'senhaForte1' })).rejects.toMatchObject({ code: 'LOCKED' })

    now = new Date(now.getTime() + (LOCK_MINUTES * 60 + 1) * 1000)
    const user = await auth.login({ username: 'admin', password: 'senhaForte1' })
    expect(user.username).toBe('admin')
    const stored = await t.db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(stored.failedLoginAttempts).toBe(0)
    expect(stored.lockedUntil).toBeNull()
  })

  it('impede login de usuário desativado e invalida a sessão existente', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    const admin = await s.setup.complete(validSetup())
    const adminActor = (await s.auth.loadActor(admin.id)).actor
    const roles = await s.users.listRoles(adminActor)
    const op = await s.users.create(adminActor, {
      name: 'Operador',
      username: 'caixa1',
      roleId: roles.find((r) => r.key === 'OPERATOR')!.id,
      password: 'operador123',
      passwordConfirm: 'operador123'
    })
    await s.auth.login({ username: 'caixa1', password: 'operador123' })
    await s.users.update(adminActor, { id: op.id, name: op.name, roleId: op.role.id, active: false, maxDiscountBps: 0 })

    await expect(s.auth.login({ username: 'caixa1', password: 'operador123' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.auth.loadActor(op.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('altera a própria senha exigindo a senha atual', async () => {
    t = await createTestDatabase()
    const s = createServices(t.db)
    const admin = await s.setup.complete(validSetup())
    const actor = (await s.auth.loadActor(admin.id)).actor
    await expect(
      s.auth.changePassword(actor, { currentPassword: 'errada', newPassword: 'novaSenha2', newPasswordConfirm: 'novaSenha2' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await s.auth.changePassword(actor, {
      currentPassword: 'senhaForte1',
      newPassword: 'novaSenha2',
      newPasswordConfirm: 'novaSenha2'
    })
    await expect(s.auth.login({ username: 'admin', password: 'senhaForte1' })).rejects.toThrow()
    expect((await s.auth.login({ username: 'admin', password: 'novaSenha2' })).id).toBe(admin.id)
  })
})
