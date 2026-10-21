import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../electron/utils/password'

describe('hash de senhas', () => {
  it('gera hash scrypt com sal aleatório e valida a senha correta', async () => {
    const a = await hashPassword('minhaSenha1')
    const b = await hashPassword('minhaSenha1')
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/)
    expect(a).not.toContain('minhaSenha1')
    expect(a).not.toBe(b)
    expect(await verifyPassword('minhaSenha1', a)).toBe(true)
    expect(await verifyPassword('minhaSenha2', a)).toBe(false)
  })

  it('rejeita hashes malformados sem lançar erro', async () => {
    expect(await verifyPassword('x', 'texto-puro')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$99$8$1$aaa$bbb')).toBe(false)
  })
})
