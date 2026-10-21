import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})
const rid = () => randomUUID()

describe('integridade dos dados', () => {
  it('após um dia de operação, estoque, caixa, vendas e contas fecham com os registros que os originam', async () => {
    t = await createTestDatabase()
    const { s, admin, operator } = await actors(t.db)
    const caneta = await s.products.create(admin, { name: 'Caneta', costCents: 100, salePriceCents: 300, initialStockMilli: 50000 })
    const camiseta = await s.products.create(admin, {
      name: 'Camiseta',
      salePriceCents: 5000,
      hasVariants: true,
      variantOptions: [{ name: 'Tamanho', values: ['P', 'M'] }],
      variants: [
        { attributes: { Tamanho: 'P' }, initialStockMilli: 5000 },
        { attributes: { Tamanho: 'M' }, initialStockMilli: 5000 }
      ]
    })
    const [p, m] = (await s.products.get(admin, { id: camiseta.id })).variants
    const cliente = await s.customers.create(admin, { name: 'Ana', document: '529.982.247-25', creditLimitCents: 50000 })
    await s.cash.open(operator, { requestId: rid(), openingCents: 10000 })
    await s.cash.open(admin, { requestId: rid(), openingCents: 0 })

    // Vendas variadas, repetição (idempotência), cancelamento e devoluções
    const key = rid()
    const v1 = await s.sales.finalize(operator, { requestId: key, items: [{ productId: caneta.id, quantityMilli: 5000 }], payments: [{ method: 'CASH', amountCents: 2000 }] })
    await s.sales.finalize(operator, { requestId: key, items: [{ productId: caneta.id, quantityMilli: 5000 }], payments: [{ method: 'CASH', amountCents: 2000 }] })
    const v2 = await s.sales.finalize(operator, { requestId: rid(), items: [{ productId: camiseta.id, variantId: p.id, quantityMilli: 2000 }], payments: [{ method: 'PIX', amountCents: 10000 }] })
    const v3 = await s.sales.finalize(admin, { requestId: rid(), customerId: cliente.id, items: [{ productId: camiseta.id, variantId: m.id, quantityMilli: 1000 }, { productId: caneta.id, quantityMilli: 2000 }], payments: [{ method: 'STORE_CREDIT', amountCents: 5600, installments: 2 }] })
    // Gaveta do gerente vazia: não há dinheiro para devolver ao cliente
    await expect(s.sales.cancel(admin, { saleId: v1.id, reason: 'Erro de lançamento' })).rejects.toThrow(/Dinheiro insuficiente na gaveta/)
    await s.sales.returnItems(admin, { requestId: rid(), saleId: v2.id, items: [{ saleItemId: v2.items[0].id, quantityMilli: 1000 }], reason: 'Troca', refundMethod: 'VOUCHER' })
    await s.stock.entry(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 10000, unitCostCents: 90 }], documentNumber: 'NF-1' })
    await s.cash.addMovement(operator, { requestId: rid(), type: 'WITHDRAWAL', method: 'CASH', amountCents: 1500, description: 'Sangria' })
    const [parcela] = (await s.receivables.list(admin, { saleId: v3.id })).items
    await s.receivables.receive(admin, { id: parcela.id, requestId: rid(), amountCents: 2800, method: 'CASH' })
    await s.sales.cancel(admin, { saleId: v1.id, reason: 'Erro de lançamento' })
    const conta = await s.payables.create(admin, { description: 'Luz', amountCents: 1000, dueDate: '2026-10-20' })
    await s.payables.pay(admin, { id: conta.id, requestId: rid(), paidCents: 1000, method: 'CASH', fromCash: true })

    // 1) Integridade física e referencial do SQLite
    const integrity = await t.db.$queryRawUnsafe<Record<string, string>[]>('PRAGMA integrity_check')
    expect(Object.values(integrity[0])[0]).toBe('ok')
    expect(await t.db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])

    // 2) Estoque = soma das movimentações (produto e cada variação)
    for (const prod of await t.db.product.findMany({ include: { variants: true } })) {
      const moves = await t.db.stockMovement.aggregate({ where: { productId: prod.id }, _sum: { quantityMilli: true } })
      expect(prod.stockMilli).toBe(moves._sum.quantityMilli ?? 0)
      for (const v of prod.variants) {
        const vm = await t.db.stockMovement.aggregate({ where: { variantId: v.id }, _sum: { quantityMilli: true } })
        expect(v.stockMilli).toBe(vm._sum.quantityMilli ?? 0)
      }
      if (prod.variants.length) expect(prod.stockMilli).toBe(prod.variants.reduce((a, v) => a + v.stockMilli, 0))
    }
    expect((await t.db.product.findUniqueOrThrow({ where: { id: caneta.id } })).stockMilli).toBe(50000 - 2000 + 10000) // venda cancelada estornou

    // 3) Vendas: total = soma dos itens; pago = soma dos pagamentos; troco só em dinheiro
    for (const sale of await t.db.sale.findMany({ include: { items: true, payments: true } })) {
      expect(sale.items.reduce((a, i) => a + i.totalCents, 0)).toBe(sale.totalCents)
      expect(sale.payments.reduce((a, x) => a + x.amountCents, 0)).toBe(sale.paidCents)
      expect(sale.paidCents - sale.changeCents).toBe(sale.totalCents)
    }
    expect(await t.db.sale.count()).toBe(3) // a repetição não criou venda

    // 4) Caixa: gaveta = abertura + movimentos em dinheiro (o estorno sai do caixa de quem cancela)
    const opSession = (await s.cash.current(operator))!
    expect(opSession.cashBalanceCents).toBe(10000 + 1500 - 1500) // venda (líquida do troco), sangria
    const adminSession = (await s.cash.current(admin))!
    expect(adminSession.cashBalanceCents).toBe(0 - 1500 + 2800 - 1000) // estorno do cancelamento, parcela recebida, conta paga
    for (const session of await t.db.cashSession.findMany()) {
      const sum = await t.db.cashMovement.aggregate({ where: { cashSessionId: session.id, method: 'CASH' }, _sum: { amountCents: true } })
      expect(session.openingCents + (sum._sum.amountCents ?? 0)).toBeGreaterThanOrEqual(0) // gaveta nunca negativa
    }

    // 5) Contas a receber: recebido = soma dos recebimentos válidos; saldo do cliente coerente
    for (const r of await t.db.accountReceivable.findMany({ include: { payments: true } })) {
      const valid = r.payments.filter((x) => !x.reversedAt)
      expect(r.receivedCents).toBe(valid.reduce((a, x) => a + x.amountCents + x.discountCents, 0))
      expect(r.receivedCents).toBeLessThanOrEqual(r.amountCents)
    }
    expect((await s.customers.get(admin, { id: cliente.id })).openBalanceCents).toBe(5600 - 2800)

    // 6) Toda operação relevante deixou rastro na auditoria
    const actions = new Set((await t.db.auditLog.findMany({ select: { action: true } })).map((a) => a.action))
    for (const a of ['sale.create', 'sale.cancel', 'sale.return', 'stock.entry', 'cash.open', 'cash.withdrawal', 'receivable.receive', 'payable.pay']) expect(actions).toContain(a)
  })
})
