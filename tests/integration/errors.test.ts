import { afterEach, describe, expect, it } from 'vitest'
import { createServices } from '../../electron/services'
import { toErrorPayload } from '../../electron/utils/errors'
import { createTestDatabase, setupAdmin, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

describe('conversão de erros para a interface', () => {
  it('cadastros simultâneos do mesmo usuário: um conclui, o outro recebe conflito (não erro interno)', async () => {
    t = await createTestDatabase()
    const admin = await setupAdmin(t.db)
    const s = createServices(t.db)
    const roleId = (await s.users.listRoles(admin)).find((r) => r.key === 'OPERATOR')!.id
    const input = { name: 'Caixa', username: 'caixa', roleId, password: 'senha1234', passwordConfirm: 'senha1234' }
    const results = await Promise.allSettled([s.users.create(admin, input), s.users.create(admin, input)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    const { payload, unexpected } = toErrorPayload(rejected.reason)
    expect(unexpected).toBe(false)
    expect(payload.code).toBe('CONFLICT')
    expect(await t.db.user.count({ where: { username: 'caixa' } })).toBe(1)
  })

  it('erros desconhecidos não vazam detalhes internos', () => {
    const { payload, unexpected } = toErrorPayload(new Error('SQLITE_IOERR: disk I/O error em C:\dados'))
    expect(unexpected).toBe(true)
    expect(payload.code).toBe('INTERNAL')
    expect(payload.message).not.toContain('SQLITE')
  })
})
