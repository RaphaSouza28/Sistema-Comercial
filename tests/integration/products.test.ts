import { afterEach, describe, expect, it } from 'vitest'
import { ProductService } from '../../electron/services/product.service'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

const camiseta = {
  name: 'Camiseta básica',
  barcode: '7891234567895',
  costCents: 4000,
  freightCents: 500,
  packagingCents: 200,
  salePriceCents: 6714,
  minStockMilli: 3000,
  initialStockMilli: 10000
}

describe('cadastro de produtos', () => {
  it('cria produto com código automático, estoque inicial rastreável e histórico de preços', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const p = await s.products.create(admin, camiseta)
    expect(p.internalCode).toBe('000001')
    expect(p.stockMilli).toBe(10000)

    const movements = await t.db.stockMovement.findMany({ where: { productId: p.id } })
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({
      type: 'INITIAL',
      quantityMilli: 10000,
      balanceAfterMilli: 10000,
      unitCostCents: 4700,
      userId: admin.userId,
      referenceType: 'PRODUCT',
      idempotencyKey: `INITIAL:P${p.id}`
    })
    const history = await s.products.priceHistory(admin, { id: p.id })
    expect(history.map((h) => h.field).sort()).toEqual(['COST', 'SALE'])
    expect((await s.products.create(admin, { name: 'Boné', salePriceCents: 3000 })).internalCode).toBe('000002')
    expect(await t.db.auditLog.count({ where: { action: 'product.create' } })).toBe(2)
  })

  it('precificação automática: custo R$ 47,00 e margem 30% → R$ 67,14', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const p = await s.products.create(admin, {
      name: 'Camiseta',
      costCents: 4000,
      freightCents: 500,
      packagingCents: 200,
      targetMarginBps: 3000,
      pricingMode: 'AUTOMATIC'
    })
    expect(p.salePriceCents).toBe(6714)
    // alterar o custo e salvar recalcula (o usuário autorizado está salvando)
    const updated = await s.products.update(admin, { ...base(p), costCents: 5000, pricingMode: 'AUTOMATIC' })
    expect(updated.salePriceCents).toBe(8143) // 57,00 / 0,70
    await expect(
      s.products.create(admin, { name: 'Xis', costCents: 100, targetMarginBps: 9000, cardFeeBps: 1000, pricingMode: 'AUTOMATIC' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('valida promoção, atacado, unidade e subcategoria', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await expect(s.products.create(admin, { name: 'Produto', salePriceCents: 1000, promoPriceCents: 1000 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      s.products.create(admin, { name: 'Produto', salePriceCents: 1000, promoPriceCents: 800, promoStartsAt: '2026-10-20', promoEndsAt: '2026-10-10' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.products.create(admin, { name: 'Produto', salePriceCents: 1000, wholesalePriceCents: 900 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.products.create(admin, { name: 'Produto', unit: 'UN', initialStockMilli: 1500 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.products.create(admin, { name: 'Queijo', unit: 'KG', initialStockMilli: 1500 })).resolves.toMatchObject({ stockMilli: 1500 })
    const a = await s.categories.create(admin, { name: 'A' })
    const b = await s.categories.create(admin, { name: 'B' })
    const subB = await s.categories.create(admin, { name: 'Sub', parentId: b.id })
    await expect(s.products.create(admin, { name: 'Produto', categoryId: a.id, subcategoryId: subB.id })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.products.create(admin, { name: 'Produto', categoryId: subB.id })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('impede códigos repetidos entre produtos e variações', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await s.products.create(admin, {
      name: 'Tênis',
      hasVariants: true,
      variantOptions: [{ name: 'Tamanho', values: ['40', '41'] }],
      variants: [{ attributes: { Tamanho: '40' }, barcode: '111' }, { attributes: { Tamanho: '41' }, barcode: '222' }]
    })
    await expect(s.products.create(admin, { name: 'Outro', barcode: '222' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.products.create(admin, { name: 'Outro', sku: 'A', barcode: 'A' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.products.create(admin, { name: 'Outro', internalCode: '000001' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

function base(p: Awaited<ReturnType<ProductService['get']>>) {
  return {
    id: p.id,
    internalCode: p.internalCode,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    unit: p.unit,
    categoryId: p.categoryId,
    subcategoryId: p.subcategoryId,
    supplierId: p.supplierId,
    minStockMilli: p.minStockMilli,
    hasVariants: p.hasVariants,
    variantOptions: p.variantOptions,
    variants: p.variants.map((v) => ({ id: v.id, attributes: v.attributes, sku: v.sku, barcode: v.barcode, costCents: v.costCents, salePriceCents: v.salePriceCents, minStockMilli: v.minStockMilli, active: v.active }))
  }
}

describe('permissões por campo', () => {
  it('gerente sem products.cost não vê nem altera custos, mas edita o cadastro mantendo-os', async () => {
    t = await createTestDatabase()
    const { s, admin, manager } = await actors(t.db)
    const created = await s.products.create(admin, camiseta)

    const seen = await s.products.get(manager, { id: created.id })
    expect(seen.costCents).toBeNull()
    expect(seen.costVisible).toBe(false)
    const list = await s.products.list(manager, {})
    expect(list.items[0].totalCostCents).toBeNull()
    expect(list.items[0].grossMarginBps).toBeNull()

    await expect(s.products.update(manager, { ...base(seen), costCents: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await s.products.update(manager, { ...base(seen), name: 'Camiseta lisa' })
    const after = await t.db.product.findUniqueOrThrow({ where: { id: created.id } })
    expect(after).toMatchObject({ name: 'Camiseta lisa', costCents: 4000, freightCents: 500, salePriceCents: 6714 })
    await expect(s.products.create(manager, { name: 'Novo', costCents: 100 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // histórico de custos não é exibido sem a permissão
    expect((await s.products.priceHistory(manager, { id: created.id })).some((h) => h.field === 'COST')).toBe(false)
  })

  it('alterar preço exige products.price e gera histórico com o motivo', async () => {
    t = await createTestDatabase()
    const { s, admin, manager, roleId, reload } = await actors(t.db)
    const p = await s.products.create(admin, camiseta)
    await s.products.update(manager, { ...base(await s.products.get(manager, { id: p.id })), salePriceCents: 6990, priceChangeReason: 'Reajuste do fornecedor' })
    const history = await s.products.priceHistory(admin, { id: p.id })
    expect(history[0]).toMatchObject({ field: 'SALE', oldCents: 6714, newCents: 6990, reason: 'Reajuste do fornecedor', userName: 'gerente' })

    await s.users.updateRolePermissions(admin, { roleId: roleId('MANAGER'), permissions: ['products.view', 'products.manage'] })
    const limited = await reload(manager)
    const detail = await s.products.get(limited, { id: p.id })
    await expect(s.products.update(limited, { ...base(detail), salePriceCents: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.products.update(limited, { ...base(detail), promoPriceCents: 5000 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.products.update(limited, { ...base(detail), name: 'Ok sem preço' })).resolves.toMatchObject({ salePriceCents: 6990 })
  })

  it('operador consulta produtos e preços, sem custos e sem editar', async () => {
    t = await createTestDatabase()
    const { s, admin, operator } = await actors(t.db)
    const p = await s.products.create(admin, camiseta)
    const found = await s.products.lookup(operator, { code: '7891234567895' })
    expect(found?.product).toMatchObject({ id: p.id, effectivePriceCents: 6714, totalCostCents: null })
    await expect(s.products.create(operator, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.products.setActive(operator, { id: p.id, active: false })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('variações', () => {
  const tenis = {
    name: 'Tênis Corrida',
    salePriceCents: 29990,
    costCents: 15000,
    hasVariants: true,
    variantOptions: [
      { name: 'Cor', values: ['Preto', 'Branco'] },
      { name: 'Tamanho', values: ['40', '41'] }
    ],
    variants: [
      { attributes: { Cor: 'Preto', Tamanho: '40' }, sku: 'TN-P-40', initialStockMilli: 2000, minStockMilli: 1000 },
      { attributes: { Cor: 'Preto', Tamanho: '41' }, sku: 'TN-P-41', initialStockMilli: 0 },
      { attributes: { Cor: 'Branco', Tamanho: '40' }, sku: 'TN-B-40', barcode: '7890000000001', initialStockMilli: 3000, salePriceCents: 31990 }
    ]
  }

  it('cria variações com estoque próprio, preço próprio e movimentações por variação', async () => {
    t = await createTestDatabase()
    const { s, admin, operator } = await actors(t.db)
    const p = await s.products.create(admin, tenis)
    expect(p.variants.map((v) => v.name)).toEqual(['Preto / 40', 'Preto / 41', 'Branco / 40'])
    expect(p.stockMilli).toBe(5000)
    const movements = await t.db.stockMovement.findMany({ where: { productId: p.id }, orderBy: { id: 'asc' } })
    expect(movements.map((m) => m.quantityMilli)).toEqual([2000, 3000])
    expect(movements.every((m) => m.variantId !== null && m.type === 'INITIAL')).toBe(true)

    const byBarcode = await s.products.lookup(operator, { code: '7890000000001' })
    expect(byBarcode?.variant).toMatchObject({ name: 'Branco / 40', salePriceCents: 31990, costCents: null })
    expect((await s.products.list(admin, { search: 'tn-b-40' })).total).toBe(1)
    expect((await s.products.list(admin, { stock: 'low' })).total).toBe(1) // Preto/41 zerado
  })

  it('rejeita combinações repetidas ou valores fora das opções', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await expect(
      s.products.create(admin, { ...tenis, variants: [tenis.variants[0], { ...tenis.variants[0], sku: 'OUTRO' }] })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      s.products.create(admin, { ...tenis, variants: [{ attributes: { Cor: 'Azul', Tamanho: '40' } }] })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('remove variação sem estoque (liberando o código) e bloqueia remoção com estoque', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const p = await s.products.create(admin, tenis)
    const keep = base(p)
    // remover Preto/40 (com estoque) é bloqueado
    await expect(s.products.update(admin, { ...keep, variants: keep.variants.slice(1) })).rejects.toMatchObject({ code: 'VALIDATION' })
    // remover Preto/41 (sem estoque) e reutilizar o SKU em uma nova variação Branco/41
    const updated = await s.products.update(admin, {
      ...keep,
      variants: [keep.variants[0], keep.variants[2], { attributes: { Cor: 'Branco', Tamanho: '41' }, sku: 'TN-P-41', initialStockMilli: 1000 }]
    })
    expect(updated.variants.map((v) => v.name)).toEqual(['Preto / 40', 'Branco / 40', 'Branco / 41'])
    expect(updated.stockMilli).toBe(6000)
    expect(await t.db.productVariant.count({ where: { productId: p.id, deletedAt: { not: null } } })).toBe(1)
  })

  it('só ativa variações com o estoque do produto zerado', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const p = await s.products.create(admin, { name: 'Bolsa', initialStockMilli: 2000 })
    await expect(
      s.products.update(admin, { ...base(p), hasVariants: true, variantOptions: tenis.variantOptions, variants: [tenis.variants[1]] })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('busca, filtros e exclusão', () => {
  it('busca sem acentos por nome e códigos, com filtros de categoria, estoque e promoção', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const cat = await s.categories.create(admin, { name: 'Bebidas' })
    await s.products.create(admin, { name: 'Café Torrado 500g', categoryId: cat.id, salePriceCents: 2500, initialStockMilli: 1000, minStockMilli: 5000 })
    await s.products.create(admin, { name: 'Chá Mate', sku: 'CHA-01', salePriceCents: 900, promoPriceCents: 790, initialStockMilli: 10000 })
    await s.products.create(admin, { name: 'Açúcar', salePriceCents: 500 })
    expect((await s.products.list(admin, { search: 'cafe torrado' })).items.map((i) => i.name)).toEqual(['Café Torrado 500g'])
    expect((await s.products.list(admin, { search: 'cha-01' })).total).toBe(1)
    expect((await s.products.list(admin, { categoryId: cat.id })).total).toBe(1)
    expect((await s.products.list(admin, { stock: 'out' })).items.map((i) => i.name)).toEqual(['Açúcar'])
    expect((await s.products.list(admin, { stock: 'low' })).total).toBe(2)
    expect((await s.products.list(admin, { promo: true })).items.map((i) => i.name)).toEqual(['Chá Mate'])
    expect((await s.products.list(admin, { sort: 'price', direction: 'desc' })).items[0].name).toBe('Café Torrado 500g')
  })

  it('alerta de margem baixa conforme a configuração', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await s.products.create(admin, { name: 'Margem ok', costCents: 1000, salePriceCents: 2000 })
    await s.products.create(admin, { name: 'Margem baixa', costCents: 1000, salePriceCents: 1100 })
    const items = (await s.products.list(admin, {})).items
    expect(items.find((i) => i.name === 'Margem baixa')?.lowMargin).toBe(true)
    expect(items.find((i) => i.name === 'Margem ok')?.lowMargin).toBe(false)
    await s.settings.updatePricing(admin, { minMarginBps: 500, defaultTargetMarginBps: 3000, defaultTaxBps: 0, defaultCardFeeBps: 0, defaultCommissionBps: 0 })
    expect((await s.products.list(admin, {})).items.every((i) => !i.lowMargin)).toBe(true)
  })

  it('exclusão lógica: bloqueia com estoque; sem estoque, oculta e libera o código de barras', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const withStock = await s.products.create(admin, camiseta)
    await expect(s.products.remove(admin, { id: withStock.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    const p = await s.products.create(admin, { name: 'Sem estoque', barcode: '999' })
    await s.products.remove(admin, { id: p.id })
    expect((await s.products.list(admin, { status: 'all' })).items.map((i) => i.id)).not.toContain(p.id)
    expect(await t.db.product.count()).toBe(2)
    await expect(s.products.create(admin, { name: 'Reuso', barcode: '999' })).resolves.toBeDefined()
    await expect(s.products.get(admin, { id: p.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('cadastro rápido gera estoque inicial rastreável', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    const cat = await s.categories.create(admin, { name: 'Papelaria' })
    const p = await s.products.quickCreate(admin, { name: 'Caderno', categoryId: cat.id, costCents: 800, salePriceCents: 1500, initialStockMilli: 20000 })
    expect(p).toMatchObject({ categoryId: cat.id, costCents: 800, salePriceCents: 1500, stockMilli: 20000 })
    expect(await t.db.stockMovement.count({ where: { productId: p.id, type: 'INITIAL' } })).toBe(1)
  })
})

describe('precificação por categoria', () => {
  it('mostra prévia e aplica somente aos produtos confirmados', async () => {
    t = await createTestDatabase()
    const { s, admin, manager } = await actors(t.db)
    const cat = await s.categories.create(admin, { name: 'Vestuário', defaultMarginBps: 3000 })
    const a = await s.products.create(admin, { name: 'Prod A', categoryId: cat.id, costCents: 4700, salePriceCents: 5000 })
    const b = await s.products.create(admin, { name: 'Prod B', categoryId: cat.id, costCents: 1000, salePriceCents: 1200 })
    await s.products.create(admin, { name: 'Sem custo', categoryId: cat.id, salePriceCents: 100 })

    const preview = await s.products.categoryPricingPreview(admin, { categoryId: cat.id })
    expect(preview.marginBps).toBe(3000)
    expect(preview.items.find((i) => i.productId === a.id)?.suggestedPriceCents).toBe(6714)
    expect(preview.items.find((i) => i.name === 'Sem custo')).toMatchObject({ suggestedPriceCents: null, problem: 'Produto sem custo informado' })
    // nada mudou só com a prévia
    expect((await t.db.product.findUniqueOrThrow({ where: { id: a.id } })).salePriceCents).toBe(5000)

    await expect(s.products.categoryPricingPreview(manager, { categoryId: cat.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const r = await s.products.categoryPricingApply(admin, { categoryId: cat.id, marginBps: 3000, productIds: [a.id] })
    expect(r.updated).toBe(1)
    expect((await t.db.product.findUniqueOrThrow({ where: { id: a.id } })).salePriceCents).toBe(6714)
    expect((await t.db.product.findUniqueOrThrow({ where: { id: b.id } })).salePriceCents).toBe(1200)
    const hist = await s.products.priceHistory(admin, { id: a.id })
    expect(hist[0].reason).toContain('Precificação por categoria')
  })
})
