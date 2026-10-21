import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReceiptHtml } from '../../electron/services/receipt'
import { allocate } from '../../electron/services/sale.service'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

const rid = () => randomUUID()
const today = new Date()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const caneta = await a.s.products.create(a.admin, { name: 'Caneta', barcode: '111', costCents: 100, salePriceCents: 250, initialStockMilli: 10000 })
  const caderno = await a.s.products.create(a.admin, {
    name: 'Caderno',
    costCents: 800,
    salePriceCents: 2000,
    promoPriceCents: 1500,
    promoStartsAt: iso(new Date(today.getTime() - 86400000)),
    promoEndsAt: iso(new Date(today.getTime() + 86400000)),
    wholesalePriceCents: 1200,
    wholesaleMinMilli: 10000,
    initialStockMilli: 50000
  })
  const tenis = await a.s.products.create(a.admin, {
    name: 'Tênis',
    costCents: 10000,
    salePriceCents: 20000,
    hasVariants: true,
    variantOptions: [{ name: 'Tam', values: ['40', '41'] }],
    variants: [
      { attributes: { Tam: '40' }, salePriceCents: 25000, initialStockMilli: 2000 },
      { attributes: { Tam: '41' }, initialStockMilli: 2000 }
    ]
  })
  await a.s.cash.open(a.operator, { requestId: rid(), openingCents: 10000 })
  await a.s.cash.open(a.admin, { requestId: rid(), openingCents: 0 })
  const stockOf = async (id: number) => (await t.db.product.findUniqueOrThrow({ where: { id } })).stockMilli
  const sell = (actor: typeof a.operator, extra: Record<string, unknown> = {}) =>
    a.s.sales.finalize(actor, {
      requestId: rid(),
      items: [
        { productId: caneta.id, quantityMilli: 2000 },
        { productId: caderno.id, quantityMilli: 1000 }
      ],
      payments: [{ method: 'CASH', amountCents: 5000 }],
      ...extra
    })
  return { ...a, caneta, caderno, tenis, stockOf, sell }
}

describe('finalização de venda', () => {
  it('exige caixa aberto', async () => {
    const { s, manager, caneta } = await scenario()
    await expect(
      s.sales.finalize(manager, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 250 }] })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Abra o caixa') })
  })

  it('registra venda, itens, pagamento, baixa de estoque, caixa e auditoria (com troco)', async () => {
    const { s, operator, caneta, caderno, stockOf, sell } = await scenario()
    const sale = await sell(operator)
    // 2 × 2,50 + 1 × 15,00 (promoção vigente) = 20,00; pago 50,00 → troco 30,00
    expect(sale).toMatchObject({ status: 'COMPLETED', subtotalCents: 2000, totalCents: 2000, paidCents: 5000, changeCents: 3000 })
    expect(sale.items.map((i) => [i.description, i.unitPriceCents, i.totalCents])).toEqual([
      ['Caneta', 250, 500],
      ['Caderno', 1500, 1500]
    ])
    expect(await stockOf(caneta.id)).toBe(8000)
    expect(await stockOf(caderno.id)).toBe(49000)
    const movement = await t.db.stockMovement.findFirstOrThrow({ where: { type: 'SALE', productId: caneta.id } })
    expect(movement).toMatchObject({ quantityMilli: -2000, referenceType: 'SALE', referenceId: String(sale.id), userId: operator.userId })
    const cash = await t.db.cashMovement.findMany({ where: { referenceId: String(sale.id) } })
    expect(cash).toHaveLength(1)
    expect(cash[0]).toMatchObject({ type: 'SALE', method: 'CASH', amountCents: 2000 }) // líquido do troco
    const stored = await t.db.sale.findUniqueOrThrow({ where: { id: sale.id } })
    expect(stored.costTotalCents).toBe(2 * 100 + 800)
    expect(stored.cashSessionId).not.toBeNull()
    const session = await s.cash.current(operator)
    expect(session).toMatchObject({ cashBalanceCents: 10000 + 2000, salesCount: 1, salesTotalCents: 2000 })
    expect(await t.db.auditLog.count({ where: { action: 'sale.create' } })).toBe(1)
  })

  it('não duplica a venda ao reenviar a mesma finalização', async () => {
    const { s, operator, caneta, stockOf } = await scenario()
    const input = { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }], payments: [{ method: 'CASH' as const, amountCents: 250 }] }
    const first = await s.sales.finalize(operator, input)
    const [second, third] = await Promise.all([s.sales.finalize(operator, input), s.sales.finalize(operator, input)])
    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect(second.duplicate).toBe(true)
    expect(await t.db.sale.count()).toBe(1)
    expect(await stockOf(caneta.id)).toBe(9000)
    expect(await t.db.cashMovement.count()).toBe(1)
  })

  it('preço é calculado no servidor: atacado por quantidade e preço próprio da variação', async () => {
    const { s, operator, caderno, tenis } = await scenario()
    const preview = await s.sales.preview(operator, {
      items: [
        { productId: caderno.id, quantityMilli: 10000 },
        { productId: tenis.id, variantId: tenis.variants[0].id, quantityMilli: 1000 },
        { productId: tenis.id, variantId: tenis.variants[1].id, quantityMilli: 1000 }
      ]
    })
    expect(preview.lines.map((l) => [l.unitPriceCents, l.priceKind])).toEqual([
      [1200, 'wholesale'],
      [25000, 'variant'],
      [20000, 'retail']
    ])
    expect(preview.totalCents).toBe(12000 + 25000 + 20000)
    await expect(s.sales.preview(operator, { items: [{ productId: tenis.id, quantityMilli: 1000 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('pagamento misto, troco só em dinheiro e validações de pagamento', async () => {
    const { s, operator, caderno } = await scenario()
    const items = [{ productId: caderno.id, quantityMilli: 1000 }] // 15,00
    const sale = await s.sales.finalize(operator, {
      requestId: rid(),
      items,
      payments: [
        { method: 'PIX', amountCents: 1000 },
        { method: 'CASH', amountCents: 1000 }
      ]
    })
    expect(sale.changeCents).toBe(500)
    const cash = await t.db.cashMovement.findMany({ where: { referenceId: String(sale.id) }, orderBy: { method: 'asc' } })
    expect(cash.map((c) => [c.method, c.amountCents])).toEqual([
      ['CASH', 500],
      ['PIX', 1000]
    ])
    await expect(s.sales.finalize(operator, { requestId: rid(), items, payments: [{ method: 'DEBIT_CARD', amountCents: 2000 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.sales.finalize(operator, { requestId: rid(), items, payments: [{ method: 'CASH', amountCents: 1000 }] })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('faltam R$ 5,00')
    })
    await expect(s.sales.finalize(operator, { requestId: rid(), items, payments: [{ method: 'PIX', amountCents: 1500, installments: 3 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      s.sales.finalize(operator, { requestId: rid(), items, payments: [{ method: 'CREDIT_CARD', amountCents: 1500, installments: 3 }] })
    ).resolves.toMatchObject({ payments: [{ method: 'CREDIT_CARD', installments: 3, status: 'REGISTERED' }] })
  })

  it('estoque insuficiente desfaz a venda inteira', async () => {
    const { s, operator, caneta, tenis, stockOf } = await scenario()
    await expect(
      s.sales.finalize(operator, {
        requestId: rid(),
        items: [
          { productId: caneta.id, quantityMilli: 1000 },
          { productId: tenis.id, variantId: tenis.variants[1].id, quantityMilli: 3000 }
        ],
        payments: [{ method: 'CASH', amountCents: 100000 }]
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Estoque insuficiente') })
    expect(await t.db.sale.count()).toBe(0)
    expect(await t.db.cashMovement.count()).toBe(0)
    expect(await stockOf(caneta.id)).toBe(10000)
  })
})

describe('descontos autorizados', () => {
  it('operador precisa de autorização; supervisor sem limite suficiente é recusado', async () => {
    const { s, operator, admin, manager, roleId, reload, sell } = await scenario()
    const extra = { discountCents: 200 } // 10% de 20,00
    await expect(sell(operator, extra)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(sell(operator, { ...extra, authorization: { username: 'admin', password: 'errada' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // gerente tem pdv.discount, mas limite padrão 0%
    await expect(sell(operator, { ...extra, authorization: { username: 'gerente', password: 'senha1234' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await t.db.auditLog.count({ where: { action: 'auth.authorization_denied' } })).toBe(2) // senha errada + limite insuficiente

    const sale = await sell(operator, { ...extra, authorization: { username: 'admin', password: 'senhaForte1' } })
    expect(sale).toMatchObject({ totalCents: 1800, discountCents: 200, discountAuthorizedByName: 'Administrador' })
    // desconto geral rateado: a soma dos itens bate com o total
    expect(sale.items.reduce((acc, i) => acc + i.totalCents, 0)).toBe(1800)

    // gerente com limite de 15% aplica 10% sozinho
    await s.users.update(admin, { id: manager.userId, name: 'gerente', roleId: roleId('MANAGER'), active: true, maxDiscountBps: 1500 })
    const m = await reload(manager)
    await s.cash.open(m, { requestId: randomUUID(), openingCents: 0 })
    await expect(sell(m, extra)).resolves.toMatchObject({ discountAuthorizedByName: null, totalCents: 1800 })
    await expect(sell(m, { discountCents: 400 })).rejects.toMatchObject({ code: 'FORBIDDEN' }) // 20% > 15%
  })
})

describe('cancelamento', () => {
  it('exige autorização, estorna estoque e caixa e não cancela duas vezes', async () => {
    const { s, operator, caneta, stockOf, sell } = await scenario()
    const sale = await sell(operator)
    await expect(s.sales.cancel(operator, { saleId: sale.id, reason: 'Cliente desistiu' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const cancelled = await s.sales.cancel(operator, { saleId: sale.id, reason: 'Cliente desistiu', authorization: { username: 'admin', password: 'senhaForte1' } })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledByName: 'Administrador', cancelReason: 'Cliente desistiu' })
    expect(cancelled.payments.every((p) => p.status === 'CANCELLED')).toBe(true)
    expect(await stockOf(caneta.id)).toBe(10000)
    const cash = await t.db.cashMovement.findMany({ where: { referenceId: String(sale.id) }, orderBy: { id: 'asc' } })
    expect(cash.map((c) => [c.type, c.amountCents])).toEqual([
      ['SALE', 2000],
      ['SALE_CANCEL', -2000]
    ])
    expect((await s.cash.current(operator))?.cashBalanceCents).toBe(10000)
    await expect(s.sales.cancel(operator, { saleId: sale.id, reason: 'De novo', authorization: { username: 'admin', password: 'senhaForte1' } })).rejects.toMatchObject({ code: 'CONFLICT' })
    // vendas canceladas não contam no dashboard
    expect((await s.dashboard.summary((await s.auth.loadActor(1)).actor)).revenue.todayCents).toBe(0)
  })
})

describe('devoluções e vale-troca', () => {
  it('devolução parcial em dinheiro, limites por item e valor exato no último lote', async () => {
    const { s, operator, admin, caneta, stockOf, sell } = await scenario()
    const sale = await sell(operator, { discountCents: 100, authorization: { username: 'admin', password: 'senhaForte1' } })
    const item = sale.items.find((i) => i.description === 'Caneta')! // 2 un, total com rateio do desconto
    const auth = { username: 'admin', password: 'senhaForte1' }
    await expect(s.sales.returnItems(operator, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: item.id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'CASH' })).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const r1 = await s.sales.returnItems(operator, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: item.id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'CASH', authorization: auth })
    const r2 = await s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: item.id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'NONE' })
    expect(r1.refundCents + (await t.db.saleReturnItem.findMany({ where: { returnId: r2.returnId } }))[0].amountCents).toBe(item.totalCents)
    expect(r2.refundCents).toBe(0)
    expect(await stockOf(caneta.id)).toBe(10000)
    await expect(
      s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: item.id, quantityMilli: 1000 }], reason: 'Excesso', refundMethod: 'NONE' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    const detail = await s.sales.get(admin, { id: sale.id })
    expect(detail.items.find((i) => i.id === item.id)?.returnedMilli).toBe(2000)
    expect(detail.returns).toHaveLength(2)
    // venda com devolução não pode ser cancelada inteira
    await expect(s.sales.cancel(admin, { saleId: sale.id, reason: 'Tudo' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('vale-troca: gera código, paga outra venda, controla saldo e é restaurado no cancelamento', async () => {
    const { s, admin, caneta, caderno, sell } = await scenario()
    const sale = await sell(admin)
    const item = sale.items.find((i) => i.description === 'Caderno')!
    const r = await s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: item.id, quantityMilli: 1000 }], reason: 'Troca de modelo', refundMethod: 'VOUCHER' })
    expect(r.voucherCode).toMatch(/^VT[0-9A-F]{6}$/)
    expect(r.refundCents).toBe(1500)
    expect(await s.sales.voucher(admin, { code: r.voucherCode!.toLowerCase() })).toMatchObject({ balanceCents: 1500 })
    // o vale não sai do caixa
    expect(await t.db.cashMovement.count({ where: { type: 'RETURN_REFUND' } })).toBe(0)

    // usa R$ 10,00 do vale + R$ 2,50 em dinheiro numa nova compra de R$ 12,50
    const second = await s.sales.finalize(admin, {
      requestId: rid(),
      items: [{ productId: caneta.id, quantityMilli: 5000 }],
      payments: [
        { method: 'VOUCHER', amountCents: 1000, voucherCode: r.voucherCode },
        { method: 'CASH', amountCents: 250 }
      ]
    })
    expect(second.payments[0]).toMatchObject({ method: 'VOUCHER', voucherCode: r.voucherCode })
    expect((await s.sales.voucher(admin, { code: r.voucherCode! }))?.balanceCents).toBe(500)
    await expect(
      s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caderno.id, quantityMilli: 1000 }], payments: [{ method: 'VOUCHER', amountCents: 1500, voucherCode: r.voucherCode }] })
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('Saldo insuficiente') })

    await s.sales.cancel(admin, { saleId: second.id, reason: 'Erro de digitação' })
    expect((await s.sales.voucher(admin, { code: r.voucherCode! }))?.balanceCents).toBe(1500)
  })

  it('reembolso em dinheiro não pode exceder o dinheiro do caixa', async () => {
    const { s, admin, caderno } = await scenario()
    // caixa do admin abriu com 0; venda paga em PIX não coloca dinheiro na gaveta
    const sale = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caderno.id, quantityMilli: 1000 }], payments: [{ method: 'PIX', amountCents: 1500 }] })
    await expect(
      s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'CASH' })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Dinheiro insuficiente') })
    const ok = await s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'PIX' })
    expect(ok.refundCents).toBe(1500)
    const m = await t.db.cashMovement.findFirstOrThrow({ where: { type: 'RETURN_REFUND' } })
    expect(m).toMatchObject({ method: 'PIX', amountCents: -1500 })
  })
})

describe('consultas e comprovante', () => {
  it('operador vê apenas as próprias vendas; gerente vê todas', async () => {
    const { s, operator, admin, manager, sell } = await scenario()
    const mine = await sell(operator)
    const other = await sell(admin)
    expect((await s.sales.list(operator, {})).items.map((i) => i.id)).toEqual([mine.id])
    await expect(s.sales.get(operator, { id: other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await s.sales.list(manager, {})).total).toBe(2)
    expect((await s.sales.list(manager, { search: `#${other.id}` })).items.map((i) => i.id)).toEqual([other.id])
  })

  it('comprovante não fiscal escapa HTML e identifica a devolução', async () => {
    const { s, admin } = await scenario()
    const evil = await s.products.create(admin, { name: '<img src=x onerror=alert(1)>', salePriceCents: 100, initialStockMilli: 1000 })
    const sale = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: evil.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 100 }] })
    const company = await s.company.get(admin)
    const html = buildReceiptHtml(company, sale)
    expect(html).toContain('NÃO É DOCUMENTO FISCAL')
    expect(html).toContain(`COMPROVANTE DE VENDA Nº ${sale.id}`)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    const r = await s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantityMilli: 1000 }], reason: 'Teste', refundMethod: 'VOUCHER' })
    const retHtml = buildReceiptHtml(company, await s.sales.get(admin, { id: sale.id }), r.returnId)
    expect(retHtml).toContain('COMPROVANTE DE DEVOLUÇÃO')
    expect(retHtml).toContain(r.voucherCode!)
  })

  it('rateio exato de valores', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(7, [500, 1500])).toEqual([2, 5])
    expect(allocate(0, [1, 2])).toEqual([0, 0])
  })
})

describe('limite de desconto', () => {
  it('percentual exibido é arredondado normalmente, mas o limite não é burlado por arredondamento', async () => {
    const { s, admin, manager, roleId, reload, caneta, caderno } = await scenario()
    // R$ 2,50 sobre R$ 22,50 = 11,111…%
    const items = [{ productId: caneta.id, quantityMilli: 3000 }, { productId: caderno.id, quantityMilli: 1000 }]
    await s.users.update(admin, { id: manager.userId, name: 'gerente', roleId: roleId('MANAGER'), active: true, maxDiscountBps: 1111 })
    const m = await reload(manager)
    const p = await s.sales.preview(m, { items, discountCents: 250 })
    expect(p.discountBps).toBe(1111)
    expect(p.requiresAuthorization).toBe(true) // 11,11% de limite não cobre 11,111…%
    await s.users.update(admin, { id: manager.userId, name: 'gerente', roleId: roleId('MANAGER'), active: true, maxDiscountBps: 1112 })
    expect((await s.sales.preview(await reload(manager), { items, discountCents: 250 })).requiresAuthorization).toBe(false)
  })
})

describe('dashboard após devoluções', () => {
  it('faturamento e lucro bruto são líquidos de devoluções (vale-troca não conta duas vezes)', async () => {
    const { s, admin, caneta, caderno } = await scenario()
    const sale = await s.sales.finalize(admin, {
      requestId: rid(),
      items: [{ productId: caneta.id, quantityMilli: 3000 }, { productId: caderno.id, quantityMilli: 1000 }],
      discountCents: 250,
      payments: [{ method: 'CASH', amountCents: 2000 }]
    })
    const caneta1 = sale.items.find((i) => i.description === 'Caneta')!
    const r = await s.sales.returnItems(admin, { requestId: rid(), saleId: sale.id, items: [{ saleItemId: caneta1.id, quantityMilli: 1000 }], reason: 'Troca', refundMethod: 'VOUCHER' })
    await s.sales.finalize(admin, {
      requestId: rid(),
      items: [{ productId: caneta.id, quantityMilli: 1000 }],
      payments: [{ method: 'VOUCHER', amountCents: r.refundCents, voucherCode: r.voucherCode }, { method: 'CASH', amountCents: 250 - r.refundCents }]
    })
    const d = await s.dashboard.summary(admin)
    // 20,00 − 2,22 (devolvido em vale) + 2,50 = 20,28 — exatamente o dinheiro que entrou
    expect(d.revenue.todayCents).toBe(2000 - r.refundCents + 250)
    expect(d.revenue.monthCents).toBe(2000 - r.refundCents + 250)
    // custo: (3 canetas + caderno) − 1 caneta devolvida + 1 caneta = 3×1,00 + 8,00
    expect(d.month.grossProfitCents).toBe(2000 - r.refundCents + 250 - (300 + 800))
    expect(d.charts.daily.at(-1)?.totalCents).toBe(2000 - r.refundCents + 250)
    expect(d.charts.topProducts.find((p) => p.name === 'Caneta')?.quantityMilli).toBe(3000) // 3 − 1 + 1
  })
})
