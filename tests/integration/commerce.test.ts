import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCatalogHtml, buildQuoteHtml } from '../../electron/services/documentsHtml'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

const rid = () => randomUUID()
const dayKey = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ADMIN_AUTH = { username: 'admin', password: 'senhaForte1' }

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const cat = await a.s.categories.create(a.admin, { name: 'Papelaria' })
  const caderno = await a.s.products.create(a.admin, { name: 'Caderno', categoryId: cat.id, costCents: 800, salePriceCents: 2000, initialStockMilli: 10000 })
  const caneta = await a.s.products.create(a.admin, { name: 'Caneta', categoryId: cat.id, costCents: 100, salePriceCents: 300, promoPriceCents: 250, initialStockMilli: 0 })
  const montagem = await a.s.products.create(a.admin, { name: 'Montagem de kit', salePriceCents: 1500, isService: true })
  const cliente = await a.s.customers.create(a.admin, { name: 'José da Silva', document: '529.982.247-25', phone: '(11) 98765-4321', consent: true })
  await a.s.cash.open(a.admin, { requestId: rid(), openingCents: 0 })
  const stockOf = async (id: number) => (await t.db.product.findUniqueOrThrow({ where: { id } })).stockMilli
  return { ...a, cat, caderno, caneta, montagem, cliente, stockOf }
}

describe('clientes', () => {
  it('cadastro com validação, busca sem acento, consentimento e documento único', async () => {
    const { s, admin, cliente } = await scenario()
    expect(cliente.consentAt).not.toBeNull()
    await expect(s.customers.create(admin, { name: 'Outro', document: '52998224725' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.customers.create(admin, { name: 'X Y', document: '123' })).rejects.toThrow()
    expect((await s.customers.list(admin, { search: 'jose silva' })).items.map((c) => c.id)).toEqual([cliente.id])
    expect((await s.customers.search(admin, { query: '98765' })).map((c) => c.id)).toEqual([cliente.id])
    const updated = await s.customers.update(admin, { id: cliente.id, name: 'José da Silva Jr.', document: '52998224725', active: true, consent: false, city: 'Curitiba', state: 'pr' })
    expect(updated).toMatchObject({ consentAt: null, state: 'PR' })
  })

  it('histórico de compras, pedidos e orçamentos no cadastro', async () => {
    const { s, admin, cliente, caderno } = await scenario()
    await s.sales.finalize(admin, { requestId: rid(), customerId: cliente.id, items: [{ productId: caderno.id, quantityMilli: 2000 }], payments: [{ method: 'PIX', amountCents: 4000 }] })
    await s.orders.create(admin, { customerId: cliente.id, items: [{ productId: caderno.id, quantityMilli: 1000 }] })
    await s.quotes.create(admin, { customerId: cliente.id, validUntil: dayKey(10), items: [{ productId: caderno.id, quantityMilli: 1000 }] })
    const list = await s.customers.list(admin, {})
    expect(list.items[0]).toMatchObject({ salesCount: 1, salesTotalCents: 4000, openBalanceCents: 0 })
    const d = await s.customers.get(admin, { id: cliente.id })
    expect([d.sales.length, d.orders.length, d.quotes.length]).toEqual([1, 1, 1])
    // busca de pedidos/orçamentos pelo cliente ignora acentos e maiúsculas
    expect((await s.orders.list(admin, { search: 'JOSÉ' })).total).toBe(1)
    expect((await s.quotes.list(admin, { search: 'jose da' })).total).toBe(1)
  })

  it('LGPD: exportação dos dados e anonimização preservando as vendas', async () => {
    const { s, admin, cliente, caderno } = await scenario()
    const sale = await s.sales.finalize(admin, { requestId: rid(), customerId: cliente.id, customerDocument: '52998224725', items: [{ productId: caderno.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 2000 }] })
    const exported = await s.customers.exportData(admin, { id: cliente.id })
    const json = JSON.parse(exported.json)
    expect(json.cliente.document).toBe('52998224725')
    expect(json.compras).toHaveLength(1)

    await s.customers.anonymize(admin, { id: cliente.id })
    const c = await t.db.customer.findUniqueOrThrow({ where: { id: cliente.id } })
    expect(c).toMatchObject({ name: `Cliente anonimizado #${cliente.id}`, document: null, phone: null, email: null, active: false })
    expect(c.anonymizedAt).not.toBeNull()
    const keptSale = await t.db.sale.findUniqueOrThrow({ where: { id: sale.id } })
    expect(keptSale).toMatchObject({ customerId: cliente.id, customerDocument: null, totalCents: 2000 })
    await expect(s.customers.update(admin, { id: cliente.id, name: 'Volta', active: true })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.customers.exportData(admin, { id: cliente.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await t.db.auditLog.count({ where: { action: { in: ['customer.export', 'customer.anonymize'] } } })).toBe(2)
  })
})

describe('pedidos', () => {
  it('registra com preço vigente, não baixa estoque e segue os status', async () => {
    const { s, admin, cliente, caderno, caneta, stockOf } = await scenario()
    const o = await s.orders.create(admin, {
      customerId: cliente.id,
      expectedDeliveryAt: dayKey(3),
      items: [
        { productId: caderno.id, quantityMilli: 2000 },
        { productId: caneta.id, quantityMilli: 4000, discountCents: 100 }
      ]
    })
    expect(o).toMatchObject({ status: 'PENDING', subtotalCents: 4000 + 1000, discountCents: 100, totalCents: 4900 })
    expect(o.items[1].unitPriceCents).toBe(250) // promoção
    expect(await stockOf(caderno.id)).toBe(10000)
    for (const status of ['CONFIRMED', 'PICKING', 'READY'] as const) await s.orders.setStatus(admin, { id: o.id, status })
    await expect(s.orders.update(admin, { id: o.id, items: [{ productId: caderno.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'CONFLICT' })
    const delivered = await s.orders.setStatus(admin, { id: o.id, status: 'DELIVERED' })
    expect(delivered.deliveredAt).not.toBeNull()
    await expect(s.orders.setStatus(admin, { id: o.id, status: 'PENDING' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.orders.cancel(admin, { id: o.id, reason: 'Tarde demais' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await s.orders.list(admin, { status: 'OPEN' })).total).toBe(0)
  })

  it('desconto acima do limite exige autorização na criação', async () => {
    const { s, manager, caderno } = await scenario()
    const input = { items: [{ productId: caderno.id, quantityMilli: 1000 }], discountCents: 200 }
    await expect(s.orders.create(manager, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const o = await s.orders.create(manager, { ...input, authorization: ADMIN_AUTH })
    expect(o.discountAuthorizedByName).toBe('Administrador')
  })

  it('vira venda com os preços combinados, uma única vez; cancelar a venda libera o pedido', async () => {
    const { s, admin, cliente, caderno, stockOf } = await scenario()
    const o = await s.orders.create(admin, { customerId: cliente.id, items: [{ productId: caderno.id, quantityMilli: 2000 }], discountCents: 400 })
    // preço do produto sobe depois do pedido: a venda respeita o combinado
    await t.db.product.update({ where: { id: caderno.id }, data: { salePriceCents: 9999 } })
    const source = await s.sales.source(admin, { orderId: o.id })
    expect(source).toMatchObject({ type: 'ORDER', totalCents: 3600, customer: { id: cliente.id } })

    const sale = await s.sales.finalize(admin, { requestId: rid(), orderId: o.id, items: [{ productId: caderno.id, quantityMilli: 99000 }], payments: [{ method: 'CASH', amountCents: 3600 }] })
    expect(sale).toMatchObject({ totalCents: 3600, discountCents: 400, customer: { id: cliente.id } })
    expect(sale.items.map((i) => [i.quantityMilli, i.unitPriceCents])).toEqual([[2000, 2000]]) // itens enviados foram ignorados
    expect(await stockOf(caderno.id)).toBe(8000)
    expect((await s.orders.get(admin, { id: o.id })).saleId).toBe(sale.id)

    await expect(s.sales.finalize(admin, { requestId: rid(), orderId: o.id, payments: [{ method: 'CASH', amountCents: 3600 }] })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.orders.cancel(admin, { id: o.id, reason: 'x x x' })).rejects.toMatchObject({ code: 'CONFLICT' })

    await s.sales.cancel(admin, { saleId: sale.id, reason: 'Cliente desistiu' })
    expect(await stockOf(caderno.id)).toBe(10000)
    expect((await s.orders.get(admin, { id: o.id })).saleId).toBeNull()
    await expect(s.sales.finalize(admin, { requestId: rid(), orderId: o.id, payments: [{ method: 'CASH', amountCents: 3600 }] })).resolves.toMatchObject({ totalCents: 3600 })
  })
})

describe('orçamentos', () => {
  it('não baixa estoque, aceita linha livre e serviço, controla validade', async () => {
    const { s, admin, caderno, montagem, stockOf } = await scenario()
    await expect(s.quotes.create(admin, { validUntil: dayKey(-1), items: [{ productId: caderno.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    const q = await s.quotes.create(admin, {
      contactName: 'Maria Interessada',
      contactPhone: '11987654321',
      validUntil: dayKey(7),
      items: [
        { productId: caderno.id, quantityMilli: 5000 },
        { productId: montagem.id, quantityMilli: 1000 },
        { description: 'Frete especial', unitPriceCents: 3000, quantityMilli: 1000 }
      ]
    })
    expect(q).toMatchObject({ status: 'DRAFT', totalCents: 10000 + 1500 + 3000, hasFreeLines: true, customerName: 'Maria Interessada' })
    expect(await stockOf(caderno.id)).toBe(10000)
    await expect(s.quotes.toOrder(admin, { id: q.id })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('texto livre') })

    // expira
    await t.db.quote.update({ where: { id: q.id }, data: { validUntil: new Date(Date.now() - 2 * 86400000) } })
    expect((await s.quotes.get(admin, { id: q.id })).status).toBe('EXPIRED')
    expect((await s.quotes.list(admin, { status: 'EXPIRED' })).total).toBe(1)
    await expect(s.quotes.setStatus(admin, { id: q.id, status: 'SENT' })).rejects.toMatchObject({ code: 'CONFLICT' })
    // nova validade reabre como rascunho
    const reopened = await s.quotes.update(admin, { id: q.id, validUntil: dayKey(5), items: [{ productId: caderno.id, quantityMilli: 5000 }, { productId: montagem.id, quantityMilli: 1000 }] })
    expect(reopened).toMatchObject({ status: 'DRAFT', hasFreeLines: false })
  })

  it('converte em pedido (uma vez) e o pedido em venda; serviço não movimenta estoque', async () => {
    const { s, admin, cliente, caderno, montagem, stockOf } = await scenario()
    const q = await s.quotes.create(admin, { customerId: cliente.id, validUntil: dayKey(7), items: [{ productId: caderno.id, quantityMilli: 1000 }, { productId: montagem.id, quantityMilli: 1000 }] })
    await s.quotes.setStatus(admin, { id: q.id, status: 'SENT' })
    const order = await s.quotes.toOrder(admin, { id: q.id, expectedDeliveryAt: dayKey(2) })
    expect(order).toMatchObject({ quoteId: q.id, totalCents: 3500, customer: { id: cliente.id } })
    expect((await s.quotes.get(admin, { id: q.id })).status).toBe('APPROVED')
    await expect(s.quotes.toOrder(admin, { id: q.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.sales.finalize(admin, { requestId: rid(), quoteId: q.id, payments: [{ method: 'PIX', amountCents: 3500 }] })).rejects.toMatchObject({ code: 'CONFLICT' })

    const sale = await s.sales.finalize(admin, { requestId: rid(), orderId: order.id, payments: [{ method: 'PIX', amountCents: 3500 }] })
    expect(sale.items).toHaveLength(2)
    expect(await stockOf(caderno.id)).toBe(9000)
    expect(await t.db.stockMovement.count({ where: { productId: montagem.id } })).toBe(0)

    // cancelar o pedido de um orçamento libera o orçamento para nova conversão
    const q2 = await s.quotes.create(admin, { validUntil: dayKey(7), items: [{ productId: caderno.id, quantityMilli: 1000 }] })
    const o2 = await s.quotes.toOrder(admin, { id: q2.id })
    await s.orders.cancel(admin, { id: o2.id, reason: 'Refazer' })
    await expect(s.quotes.toOrder(admin, { id: q2.id })).resolves.toMatchObject({ quoteId: q2.id })
  })

  it('vende orçamento direto no PDV com os preços do orçamento', async () => {
    const { s, admin, caneta, caderno } = await scenario()
    await t.db.product.update({ where: { id: caneta.id }, data: { stockMilli: 10000 } })
    const q = await s.quotes.create(admin, { validUntil: dayKey(3), items: [{ productId: caderno.id, quantityMilli: 1000, discountCents: 500 }] })
    const sale = await s.sales.finalize(admin, { requestId: rid(), quoteId: q.id, payments: [{ method: 'CASH', amountCents: 1500 }] })
    expect(sale.totalCents).toBe(1500)
    const after = await s.quotes.get(admin, { id: q.id })
    expect(after).toMatchObject({ status: 'APPROVED', saleId: sale.id })
  })
})

describe('serviços e catálogo', () => {
  it('serviço não aceita estoque nem aparece no controle de estoque', async () => {
    const { s, admin, montagem } = await scenario()
    await expect(s.products.create(admin, { name: 'Instalação', isService: true, initialStockMilli: 1000 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.stock.entry(admin, { requestId: rid(), items: [{ productId: montagem.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await s.stock.overview(admin, {})).items.some((i) => i.productId === montagem.id)).toBe(false)
    // atualizar sem informar isService mantém o serviço
    const detail = await s.products.get(admin, { id: montagem.id })
    await s.products.update(admin, { id: montagem.id, name: 'Montagem de kit completo', hasVariants: false })
    expect((await s.products.get(admin, { id: montagem.id })).isService).toBe(detail.isService)
  })

  it('catálogo por categoria com promoção, filtro de estoque e HTML escapado', async () => {
    const { s, admin, operator } = await scenario()
    const all = await s.catalog.data(operator, {})
    expect(all.categories.map((c) => c.name)).toEqual(['Papelaria', 'Outros produtos'])
    const papel = all.categories[0].products
    expect(papel.find((p) => p.name === 'Caneta')).toMatchObject({ promo: true, priceCents: 250, regularPriceCents: 300, inStock: false })
    const inStock = await s.catalog.data(operator, { inStockOnly: true })
    expect(inStock.categories.flatMap((c) => c.products.map((p) => p.name))).toEqual(['Caderno', 'Montagem de kit'])
    expect((await s.catalog.data(operator, { promoOnly: true })).productCount).toBe(1)

    await s.products.create(admin, { name: '<script>alert(1)</script>', salePriceCents: 100 })
    const html = buildCatalogHtml(null, await s.catalog.data(operator, {}), () => null)
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    const q = await s.quotes.create(admin, { validUntil: dayKey(3), contactName: '<b>x</b>', items: [{ description: '<i>serviço</i>', unitPriceCents: 100, quantityMilli: 1000 }] })
    const qh = buildQuoteHtml(null, q)
    expect(qh).toContain(`Orçamento nº ${q.id}`)
    expect(qh).not.toContain('<b>x</b>')
  })
})
