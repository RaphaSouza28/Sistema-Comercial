import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { setSetting } from '../../electron/repositories/setting.repository'
import { StockService } from '../../electron/services/stock.service'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

const rid = () => randomUUID()

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const caneta = await a.s.products.create(a.admin, { name: 'Caneta', barcode: '789001', costCents: 1000, salePriceCents: 2000, initialStockMilli: 10000, minStockMilli: 3000 })
  const queijo = await a.s.products.create(a.admin, { name: 'Queijo', unit: 'KG', costCents: 3000, salePriceCents: 5000 })
  const tenis = await a.s.products.create(a.admin, {
    name: 'Tênis',
    costCents: 10000,
    salePriceCents: 20000,
    hasVariants: true,
    variantOptions: [{ name: 'Tamanho', values: ['40', '41'] }],
    variants: [
      { attributes: { Tamanho: '40' }, barcode: '789040', initialStockMilli: 2000, minStockMilli: 1000 },
      { attributes: { Tamanho: '41' }, barcode: '789041' }
    ]
  })
  const sup = await a.s.suppliers.create(a.admin, { name: 'Distribuidora' })
  const stockOf = async (id: number) => (await t.db.product.findUniqueOrThrow({ where: { id } })).stockMilli
  return { ...a, caneta, queijo, tenis, sup, stockOf }
}

describe('entradas de mercadoria', () => {
  it('registra várias linhas com fornecedor, documento e usuário; repetir o envio não duplica', async () => {
    const { s, admin, caneta, queijo, sup, stockOf } = await scenario()
    const input = {
      requestId: rid(),
      supplierId: sup.id,
      documentNumber: 'NF 1234',
      items: [
        { productId: caneta.id, quantityMilli: 5000 },
        { productId: queijo.id, quantityMilli: 2500 }
      ]
    }
    expect(await s.stock.entry(admin, input)).toEqual({ movements: 2, warnings: [] })
    expect(await stockOf(caneta.id)).toBe(15000)
    expect(await stockOf(queijo.id)).toBe(2500)
    const m = await t.db.stockMovement.findFirstOrThrow({ where: { productId: caneta.id, type: 'ENTRY' } })
    expect(m).toMatchObject({ quantityMilli: 5000, balanceAfterMilli: 15000, supplierId: sup.id, documentNumber: 'NF 1234', userId: admin.userId, referenceType: 'ENTRY' })

    // duplo clique / reenvio: mesma requisição não altera o estoque
    const again = await s.stock.entry(admin, input)
    expect(again.movements).toBe(0)
    expect(await stockOf(caneta.id)).toBe(15000)
  })

  it('atualiza custo pelo custo médio ponderado ou último custo, com histórico', async () => {
    const { s, admin, caneta } = await scenario()
    // 10 un a R$ 10,00 + 10 un a R$ 20,00 → média R$ 15,00
    await s.stock.entry(admin, { requestId: rid(), costUpdate: 'average', items: [{ productId: caneta.id, quantityMilli: 10000, unitCostCents: 2000 }] })
    expect((await t.db.product.findUniqueOrThrow({ where: { id: caneta.id } })).costCents).toBe(1500)
    await s.stock.entry(admin, { requestId: rid(), costUpdate: 'last', items: [{ productId: caneta.id, quantityMilli: 1000, unitCostCents: 1800 }] })
    expect((await t.db.product.findUniqueOrThrow({ where: { id: caneta.id } })).costCents).toBe(1800)
    const hist = await s.products.priceHistory(admin, { id: caneta.id })
    expect(hist.slice(0, 2).map((h) => h.reason)).toEqual(['Entrada de mercadoria (último custo)', 'Entrada de mercadoria (custo médio)'])
    // preço de venda não muda sozinho
    expect((await t.db.product.findUniqueOrThrow({ where: { id: caneta.id } })).salePriceCents).toBe(2000)
  })

  it('avisa quando o custo de um produto com preço automático muda (sem alterar o preço)', async () => {
    const { s, admin } = await scenario()
    const auto = await s.products.create(admin, { name: 'Automático', costCents: 700, targetMarginBps: 3000, pricingMode: 'AUTOMATIC' })
    const r = await s.stock.entry(admin, { requestId: rid(), costUpdate: 'last', items: [{ productId: auto.id, quantityMilli: 1000, unitCostCents: 1400 }] })
    expect(r.warnings[0]).toContain('revise o preço')
    expect((await t.db.product.findUniqueOrThrow({ where: { id: auto.id } })).salePriceCents).toBe(1000)
  })

  it('gerente sem permissão de custo registra entrada apenas com quantidades', async () => {
    const { s, manager, caneta } = await scenario()
    await expect(
      s.stock.entry(manager, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000, unitCostCents: 900 }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.stock.entry(manager, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }] })).resolves.toMatchObject({ movements: 1 })
  })

  it('exige variação em produtos com variações e mantém o total do produto', async () => {
    const { s, admin, tenis, stockOf } = await scenario()
    await expect(s.stock.entry(admin, { requestId: rid(), items: [{ productId: tenis.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    const v41 = tenis.variants[1].id
    await s.stock.entry(admin, { requestId: rid(), items: [{ productId: tenis.id, variantId: v41, quantityMilli: 4000 }] })
    expect((await t.db.productVariant.findUniqueOrThrow({ where: { id: v41 } })).stockMilli).toBe(4000)
    expect(await stockOf(tenis.id)).toBe(6000)
  })

  it('respeita unidades não fracionáveis', async () => {
    const { s, admin, caneta, queijo } = await scenario()
    await expect(s.stock.entry(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1500 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.stock.entry(admin, { requestId: rid(), items: [{ productId: queijo.id, quantityMilli: 1250 }] })).resolves.toMatchObject({ movements: 1 })
  })
})

describe('saídas e ajustes', () => {
  it('impede estoque negativo não autorizado e desfaz a operação inteira', async () => {
    const { s, admin, caneta, queijo, stockOf } = await scenario()
    await s.stock.entry(admin, { requestId: rid(), items: [{ productId: queijo.id, quantityMilli: 1000 }] })
    // segunda linha falta estoque → nada é baixado
    await expect(
      s.stock.exit(admin, {
        requestId: rid(),
        reason: 'LOSS',
        items: [
          { productId: queijo.id, quantityMilli: 500 },
          { productId: caneta.id, quantityMilli: 11000 }
        ]
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Estoque insuficiente de "Caneta"') })
    expect(await stockOf(queijo.id)).toBe(1000)
    expect(await stockOf(caneta.id)).toBe(10000)
    expect(await t.db.stockMovement.count({ where: { type: 'EXIT' } })).toBe(0)

    const r = await s.stock.exit(admin, { requestId: rid(), reason: 'DAMAGE', notes: 'Caiu no chão', items: [{ productId: caneta.id, quantityMilli: 2000 }] })
    expect(r.movements).toBe(1)
    const m = await t.db.stockMovement.findFirstOrThrow({ where: { type: 'EXIT' } })
    expect(m).toMatchObject({ quantityMilli: -2000, balanceAfterMilli: 8000, reason: 'Avaria — Caiu no chão' })
  })

  it('permite negativo quando o produto ou a configuração geral autorizam', async () => {
    const { s, admin, caneta, queijo, stockOf } = await scenario()
    const neg = await s.products.create(admin, { name: 'Sob encomenda', allowNegativeStock: true })
    await s.stock.exit(admin, { requestId: rid(), reason: 'INTERNAL_USE', items: [{ productId: neg.id, quantityMilli: 2000 }] })
    expect(await stockOf(neg.id)).toBe(-2000)
    await expect(s.stock.exit(admin, { requestId: rid(), reason: 'LOSS', items: [{ productId: queijo.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'CONFLICT' })
    await setSetting(t.db, 'stock.allowNegative', true)
    await s.stock.exit(admin, { requestId: rid(), reason: 'LOSS', items: [{ productId: queijo.id, quantityMilli: 1000 }] })
    expect(await stockOf(queijo.id)).toBe(-1000)
    expect(await stockOf(caneta.id)).toBe(10000)
  })

  it('motivo "Outro" exige descrição', async () => {
    const { s, admin, caneta } = await scenario()
    await expect(s.stock.exit(admin, { requestId: rid(), reason: 'OTHER', items: [{ productId: caneta.id, quantityMilli: 1000 }] })).rejects.toThrow()
  })

  it('ajuste define o saldo informado e registra a diferença', async () => {
    const { s, admin, caneta, tenis, stockOf } = await scenario()
    await s.stock.adjust(admin, { requestId: rid(), productId: caneta.id, newQuantityMilli: 7000, reason: 'Conferência do balcão' })
    const m = await t.db.stockMovement.findFirstOrThrow({ where: { type: 'ADJUSTMENT' } })
    expect(m).toMatchObject({ quantityMilli: -3000, balanceAfterMilli: 7000, reason: 'Conferência do balcão' })
    await expect(s.stock.adjust(admin, { requestId: rid(), productId: caneta.id, newQuantityMilli: 7000, reason: 'Igual' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await s.stock.adjust(admin, { requestId: rid(), productId: tenis.id, variantId: tenis.variants[0].id, newQuantityMilli: 5000, reason: 'Recontagem' })
    expect(await stockOf(tenis.id)).toBe(5000)
  })

  it('operador consulta o estoque mas não movimenta', async () => {
    const { s, operator, caneta } = await scenario()
    await expect(s.stock.overview(operator, {})).resolves.toBeDefined()
    await expect(s.stock.entry(operator, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.stock.adjust(operator, { requestId: rid(), productId: caneta.id, newQuantityMilli: 1000, reason: 'xxx' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('consultas', () => {
  it('posições por produto/variação, status, valor em estoque e filtros', async () => {
    const { s, admin, manager } = await scenario()
    const all = await s.stock.overview(admin, {})
    expect(all.items.map((i) => `${i.name}${i.variantName ? ' ' + i.variantName : ''}`)).toEqual(['Caneta', 'Queijo', 'Tênis 40', 'Tênis 41'])
    const caneta = all.items.find((i) => i.name === 'Caneta')!
    expect(caneta).toMatchObject({ stockMilli: 10000, status: 'ok', unitCostCents: 1000, stockValueCents: 10000 })
    expect(all.items.find((i) => i.variantName === '40')?.status).toBe('ok') // 2 un, mínimo 1
    expect(all.items.find((i) => i.variantName === '41')?.status).toBe('out')

    expect((await s.stock.overview(admin, { status: 'low' })).items.map((i) => i.variantName ?? i.name)).toEqual(['Queijo', '41'])
    expect((await s.stock.overview(admin, { status: 'out' })).total).toBe(2)

    const summary = await s.stock.summary(admin)
    expect(summary).toMatchObject({ positions: 4, stockValueCents: 10000 + 2 * 10000, lowCount: 0, outCount: 2, negativeCount: 0 })
    expect((await s.stock.summary(manager)).stockValueCents).toBeNull()

    // Caneta: mínimo 3 un → ao chegar a 3, fica "baixo"
    const canetaId = all.items.find((i) => i.name === 'Caneta')!.productId
    await s.stock.adjust(admin, { requestId: randomUUID(), productId: canetaId, newQuantityMilli: 3000, reason: 'Conferência' })
    expect((await s.stock.overview(admin, { search: 'caneta' })).items[0].status).toBe('low')
    expect((await s.stock.summary(admin)).lowCount).toBe(1)
    expect((await s.stock.overview(manager, {})).items[0].unitCostCents).toBeNull()
  })

  it('produtos sem movimentação no período', async () => {
    const { s, admin, caneta } = await scenario()
    const future = new StockService(t.db, () => new Date(Date.now() + 120 * 86400000))
    expect((await future.overview(admin, { status: 'stale', staleDays: 90 })).total).toBe(4)
    await s.stock.entry(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }] })
    expect((await s.stock.overview(admin, { status: 'stale', staleDays: 90 })).items.map((i) => i.variantName ?? i.name)).toEqual(['Queijo', '41'])
  })

  it('busca por código de barras de variação e por nome', async () => {
    const { s, operator } = await scenario()
    const r = await s.stock.search(operator, { query: '789041' })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: 'Tênis', variantName: '41', unitCostCents: null })
    expect((await s.stock.search(operator, { query: 'tenis' })).map((i) => i.variantName)).toEqual(['40', '41'])
  })

  it('histórico de movimentações com filtros e exportação', async () => {
    const { s, admin, caneta, sup } = await scenario()
    await s.stock.entry(admin, { requestId: rid(), supplierId: sup.id, documentNumber: 'NF-77', items: [{ productId: caneta.id, quantityMilli: 1000 }] })
    await s.stock.exit(admin, { requestId: rid(), reason: 'LOSS', items: [{ productId: caneta.id, quantityMilli: 1000 }] })
    const all = await s.stock.movements(admin, { productId: caneta.id })
    expect(all.items.map((m) => m.type)).toEqual(['EXIT', 'ENTRY', 'INITIAL'])
    expect(all.items[1]).toMatchObject({ supplierName: 'Distribuidora', documentNumber: 'NF-77', userName: 'Administrador' })
    expect((await s.stock.movements(admin, { type: 'ENTRY' })).total).toBe(1)
    expect((await s.stock.movements(admin, { search: 'nf-77' })).total).toBe(1)
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect((await s.stock.movements(admin, { from: '2000-01-01', to: '2000-12-31' })).total).toBe(0)
    expect((await s.stock.movements(admin, { from: today })).total).toBeGreaterThan(0)
    const csv = await s.stock.exportMovementsCsv(admin, { productId: caneta.id })
    expect(csv.count).toBe(3)
    expect(csv.csv).toContain('Perda')
  })
})

describe('inventário', () => {
  it('conta em etapas e aplica a diferença contra o estoque do momento da aplicação', async () => {
    const { s, admin, caneta, tenis, stockOf } = await scenario()
    const inv = await s.inventories.create(admin, { name: 'Inventário de outubro' })
    expect(inv.items).toHaveLength(4)
    await expect(s.inventories.create(admin, { name: 'Outro' })).rejects.toMatchObject({ code: 'CONFLICT' })

    const itemCaneta = inv.items.find((i) => i.productId === caneta.id)!
    const item40 = inv.items.find((i) => i.variantName === '40')!
    await s.inventories.saveCounts(admin, { inventoryId: inv.id, counts: [{ itemId: itemCaneta.id, countedMilli: 8000 }] })
    // venda/saída acontece durante a contagem
    await s.stock.exit(admin, { requestId: rid(), reason: 'LOSS', items: [{ productId: caneta.id, quantityMilli: 1000 }] })
    const partial = await s.inventories.saveCounts(admin, { inventoryId: inv.id, counts: [{ itemId: item40.id, countedMilli: 2000 }] })
    expect(partial.countedCount).toBe(2)
    expect(partial.items.find((i) => i.id === itemCaneta.id)).toMatchObject({ expectedMilli: 10000, currentMilli: 9000, differenceMilli: -1000 })

    const applied = await s.inventories.apply(admin, { inventoryId: inv.id })
    expect(applied.status).toBe('APPLIED')
    expect(await stockOf(caneta.id)).toBe(8000)
    expect(await stockOf(tenis.id)).toBe(2000) // 40 contado igual; 41 não contado
    const invMovements = await t.db.stockMovement.findMany({ where: { type: 'INVENTORY' } })
    expect(invMovements).toHaveLength(1)
    expect(invMovements[0]).toMatchObject({ quantityMilli: -1000, referenceId: String(inv.id) })
    await expect(s.inventories.apply(admin, { inventoryId: inv.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.inventories.create(admin, { name: 'Novo' })).resolves.toMatchObject({ status: 'OPEN' })
  })

  it('por categoria, cancelamento e validação de quantidade', async () => {
    const { s, admin, caneta } = await scenario()
    const cat = await s.categories.create(admin, { name: 'Papelaria' })
    await expect(s.inventories.create(admin, { name: 'Vazio', categoryId: cat.id })).rejects.toMatchObject({ code: 'VALIDATION' })
    const inv = await s.inventories.create(admin, { name: 'Geral' })
    const item = inv.items.find((i) => i.productId === caneta.id)!
    await expect(s.inventories.saveCounts(admin, { inventoryId: inv.id, counts: [{ itemId: item.id, countedMilli: 1500 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.inventories.apply(admin, { inventoryId: inv.id })).rejects.toMatchObject({ code: 'VALIDATION' })
    await s.inventories.cancel(admin, { inventoryId: inv.id })
    expect((await s.inventories.list(admin))[0].status).toBe('CANCELLED')
  })
})
