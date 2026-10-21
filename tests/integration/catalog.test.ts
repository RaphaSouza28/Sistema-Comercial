import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

describe('categorias', () => {
  it('cria categorias e subcategorias com dois níveis no máximo', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const vest = await s.categories.create(admin, { name: 'Vestuário', defaultMarginBps: 4000 })
    const cam = await s.categories.create(admin, { name: 'Camisetas', parentId: vest.id })
    expect(cam.parentName).toBe('Vestuário')
    await expect(s.categories.create(admin, { name: 'Gola V', parentId: cam.id })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.categories.create(admin, { name: 'vestuario' })).rejects.toMatchObject({ code: 'CONFLICT' })
    // mesmo nome em outro nível é permitido
    await expect(s.categories.create(admin, { name: 'Camisetas' })).resolves.toBeDefined()
    expect(await s.categories.list(admin)).toHaveLength(3)
  })

  it('não exclui categoria com produtos ou subcategorias', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const vest = await s.categories.create(admin, { name: 'Vestuário' })
    await s.categories.create(admin, { name: 'Camisetas', parentId: vest.id })
    await expect(s.categories.remove(admin, { id: vest.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    const vazia = await s.categories.create(admin, { name: 'Papelaria' })
    await s.products.create(admin, { name: 'Caderno', categoryId: vazia.id, salePriceCents: 1000 })
    await expect(s.categories.remove(admin, { id: vazia.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    const outra = await s.categories.create(admin, { name: 'Presentes' })
    await s.categories.remove(admin, { id: outra.id })
    expect((await s.categories.list(admin)).some((c) => c.id === outra.id)).toBe(false)
  })

  it('operador consulta, mas não cria categorias', async () => {
    t = await createTestDatabase()
    const { s, operator } = await actors(t.db)
    await expect(s.categories.list(operator)).resolves.toEqual([])
    await expect(s.categories.create(operator, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('fornecedores', () => {
  it('valida CNPJ, impede documento duplicado e busca sem acentos', async () => {
    t = await createTestDatabase()
    const { s, admin, operator } = await actors(t.db)
    await expect(s.suppliers.create(admin, { name: 'Têxtil', document: '11.222.333/0001-00' })).rejects.toThrow()
    const sup = await s.suppliers.create(admin, { name: 'Têxtil São José', document: '11.222.333/0001-81', state: 'sp' })
    expect(sup.document).toBe('11222333000181')
    expect(sup.state).toBe('SP')
    await expect(s.suppliers.create(admin, { name: 'Outro', document: '11222333000181' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await s.suppliers.list(admin, { search: 'textil sao' })).toHaveLength(1)
    await expect(s.suppliers.list(operator, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('exclusão lógica mantém o vínculo com produtos', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const sup = await s.suppliers.create(admin, { name: 'Distribuidora' })
    const p = await s.products.create(admin, { name: 'Caneta', supplierId: sup.id, salePriceCents: 300 })
    await s.suppliers.remove(admin, { id: sup.id })
    expect(await s.suppliers.list(admin, { includeInactive: true })).toHaveLength(0)
    expect((await t.db.product.findUniqueOrThrow({ where: { id: p.id } })).supplierId).toBe(sup.id)
    expect(await t.db.supplier.count()).toBe(1)
  })
})
