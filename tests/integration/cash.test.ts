import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCashReportHtml } from '../../electron/services/receipt'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

const rid = () => randomUUID()
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const caneta = await a.s.products.create(a.admin, { name: 'Caneta', costCents: 100, salePriceCents: 1000, initialStockMilli: 100000 })
  const session = await a.s.cash.open(a.operator, { requestId: rid(), openingCents: 10000 })
  const sell = (cents: number, method: 'CASH' | 'PIX' | 'DEBIT_CARD' = 'CASH', paid = cents) =>
    a.s.sales.finalize(a.operator, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: (cents / 1000) * 1000 }], payments: [{ method, amountCents: paid }] })
  const move = (type: 'SUPPLY' | 'WITHDRAWAL' | 'OTHER_IN' | 'OTHER_OUT', amountCents: number, method: 'CASH' | 'PIX' = 'CASH') =>
    a.s.cash.addMovement(a.operator, { requestId: rid(), type, amountCents, method, description: `Teste ${type}` })
  return { ...a, caneta, session, sell, move }
}

describe('movimentações do caixa', () => {
  it('suprimento, sangria, outras entradas/saídas e trava de saldo da gaveta', async () => {
    const { s, operator, move } = await scenario()
    await move('SUPPLY', 5000)
    await move('WITHDRAWAL', 8000)
    expect((await s.cash.current(operator))?.cashBalanceCents).toBe(7000)
    await expect(move('WITHDRAWAL', 7001)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('R$ 70,00') })
    await expect(move('OTHER_OUT', 7001)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(move('SUPPLY', 100, 'PIX')).rejects.toMatchObject({ code: 'VALIDATION' })
    const m = await move('OTHER_OUT', 1500)
    expect(m).toMatchObject({ type: 'OTHER_OUT', amountCents: -1500, description: 'Teste OTHER_OUT' })
    expect((await s.cash.current(operator))?.cashBalanceCents).toBe(5500)
    expect(await t.db.auditLog.count({ where: { action: { startsWith: 'cash.' } } })).toBeGreaterThanOrEqual(4)
  })

  it('reenviar a mesma movimentação não duplica; sem caixa aberto é recusado', async () => {
    const { s, operator, manager } = await scenario()
    const input = { requestId: rid(), type: 'SUPPLY' as const, amountCents: 1000, description: 'Troco extra' }
    const a = await s.cash.addMovement(operator, input)
    const b = await s.cash.addMovement(operator, input)
    expect(b.id).toBe(a.id)
    expect(await t.db.cashMovement.count({ where: { type: 'SUPPLY' } })).toBe(1)
    await expect(s.cash.addMovement(manager, { ...input, requestId: rid() })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('resumo e fechamento', () => {
  it('calcula o esperado por forma de pagamento com vendas, troco, cancelamento, devolução e sangria', async () => {
    const { s, operator, admin, session, sell, move } = await scenario()
    await sell(2000, 'CASH', 5000) // +20,00 em dinheiro (troco 30,00)
    await sell(3000, 'PIX') // +30,00 PIX
    const cancelada = await sell(1000, 'DEBIT_CARD') // +10,00 débito → cancelada
    await s.sales.cancel(operator, { saleId: cancelada.id, reason: 'Erro', authorization: { username: 'admin', password: 'senhaForte1' } })
    const devolvida = await sell(4000, 'CASH') // +40,00
    await s.sales.returnItems(admin, { requestId: rid(), saleId: devolvida.id, items: [{ saleItemId: devolvida.items[0].id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'NONE' })
    await s.sales.returnItems(operator, {
      requestId: rid(),
      saleId: devolvida.id,
      items: [{ saleItemId: devolvida.items[0].id, quantityMilli: 1000 }],
      reason: 'Defeito',
      refundMethod: 'CASH',
      authorization: { username: 'admin', password: 'senhaForte1' }
    }) // −10,00 dinheiro
    await move('SUPPLY', 2000)
    await move('WITHDRAWAL', 5000)

    const sum = await s.cash.summary(operator, { sessionId: session.id })
    const cash = sum.byMethod.find((m) => m.method === 'CASH')!
    expect(cash).toMatchObject({ openingCents: 10000, salesCents: 6000, refundsCents: -1000, suppliesCents: 2000, withdrawalsCents: -5000, expectedCents: 12000 })
    expect(sum.byMethod.find((m) => m.method === 'PIX')?.expectedCents).toBe(3000)
    const debit = sum.byMethod.find((m) => m.method === 'DEBIT_CARD')!
    expect(debit).toMatchObject({ salesCents: 1000, cancelsCents: -1000, expectedCents: 0 })
    expect(sum).toMatchObject({ expectedCashCents: 12000, salesCount: 3, salesTotalCents: 9000, cancelledCount: 1, returnsCount: 1 })
    expect((await s.cash.current(operator))?.cashBalanceCents).toBe(12000)
  })

  it('fecha com conferência; diferença exige justificativa; resumo fica congelado', async () => {
    const { s, operator, admin, session, sell } = await scenario()
    const sale = await sell(2000, 'CASH')
    await sell(3000, 'PIX')
    // contado 115,00 contra esperado 120,00 → falta 5,00
    await expect(s.cash.close(operator, { sessionId: session.id, countedCashCents: 11500 })).rejects.toMatchObject({ code: 'VALIDATION' })
    const closed = await s.cash.close(operator, { sessionId: session.id, countedCashCents: 11500, countedByMethod: { PIX: 3000 }, notes: 'Troco dado a mais' })
    expect(closed).toMatchObject({ status: 'CLOSED', expectedCents: 12000, countedCents: 11500, differenceCents: -500, closedByName: 'caixa', notes: 'Troco dado a mais' })
    expect(closed.summary.byMethod.find((m) => m.method === 'PIX')).toMatchObject({ countedCents: 3000, differenceCents: 0 })
    await expect(s.cash.close(operator, { sessionId: session.id, countedCashCents: 0, notes: 'x' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await s.cash.current(operator)).toBeNull()

    // sem caixa aberto não vende
    await expect(sell(1000)).rejects.toMatchObject({ code: 'CONFLICT' })

    // cancelamento posterior (em outro caixa) não altera o fechamento já registrado
    await s.cash.open(admin, { requestId: rid(), openingCents: 5000 })
    await s.sales.cancel(admin, { saleId: sale.id, reason: 'Pós-fechamento' })
    const after = await s.cash.get(admin, { sessionId: session.id })
    expect(after.summary.byMethod.find((m) => m.method === 'CASH')?.expectedCents).toBe(12000)
    expect(after.movements.some((m) => m.type === 'SALE_CANCEL')).toBe(false)
  })

  it('fechamento sem diferença não exige observação', async () => {
    const { s, operator, session } = await scenario()
    await expect(s.cash.close(operator, { sessionId: session.id, countedCashCents: 10000 })).resolves.toMatchObject({ differenceCents: 0 })
  })
})

describe('permissões e consultas', () => {
  it('operador não fecha nem consulta o caixa de outro; gerente fecha e vê todos', async () => {
    const { s, operator, manager, admin, session } = await scenario()
    const adminSession = await s.cash.open(admin, { requestId: rid(), openingCents: 0 })
    await expect(s.cash.close(operator, { sessionId: adminSession.id, countedCashCents: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.cash.get(operator, { sessionId: adminSession.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await s.cash.history(operator, {})).items.map((i) => i.id)).toEqual([session.id])
    expect((await s.cash.history(manager, {})).total).toBe(2)
    const closed = await s.cash.close(manager, { sessionId: session.id, countedCashCents: 10000 })
    expect(closed.closedByName).toBe('gerente')
    expect((await t.db.auditLog.findFirstOrThrow({ where: { action: 'cash.close' } })).details).toContain('"byOther":true')
    await expect(s.cash.daily(operator, { date: today() })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('relatório diário consolida todos os caixas do dia', async () => {
    const { s, manager, operator, session, sell, move } = await scenario()
    await sell(2000, 'CASH')
    await sell(3000, 'PIX')
    await move('SUPPLY', 1000)
    await move('WITHDRAWAL', 500)
    await s.cash.close(operator, { sessionId: session.id, countedCashCents: 12400, notes: 'Falta 1,00' })
    const r = await s.cash.daily(manager, { date: today() })
    expect(r).toMatchObject({ salesCount: 2, salesTotalCents: 5000, suppliesCents: 1000, withdrawalsCents: 500, differenceTotalCents: -100 })
    expect(r.sessions).toHaveLength(1)
    expect(r.byMethod.find((m) => m.method === 'CASH')?.netCents).toBe(2000 + 1000 - 500)
    expect(r.byMethod.find((m) => m.method === 'PIX')?.netCents).toBe(3000)
  })

  it('relatório de fechamento imprimível', async () => {
    const { s, operator, session } = await scenario()
    const closed = await s.cash.close(operator, { sessionId: session.id, countedCashCents: 10000 })
    const html = buildCashReportHtml(await s.company.get(operator), closed)
    expect(html).toContain(`FECHAMENTO DE CAIXA Nº ${session.id}`)
    expect(html).toContain('R$ 100,00')
    expect(html).toContain('Assinatura do operador')
  })
})
