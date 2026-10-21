import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { reportToCsv, reportToXlsx } from '../../electron/services/reportExport'
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

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const cat = await a.s.categories.create(a.admin, { name: 'Papelaria' })
  const caderno = await a.s.products.create(a.admin, { name: 'Caderno', categoryId: cat.id, costCents: 800, salePriceCents: 2000, initialStockMilli: 10000 })
  const caneta = await a.s.products.create(a.admin, { name: 'Caneta', costCents: 100, salePriceCents: 300, initialStockMilli: 50000 })
  const fornecedor = await a.s.suppliers.create(a.admin, { name: 'Energia Elétrica SA' })
  const cliente = await a.s.customers.create(a.admin, { name: 'Ana Crediário', document: '529.982.247-25', creditLimitCents: 10000 })
  const session = await a.s.cash.open(a.admin, { requestId: rid(), openingCents: 5000 })
  const drawer = async () => (await a.s.cash.current(a.admin))!.cashBalanceCents
  return { ...a, cat, caderno, caneta, fornecedor, cliente, session, drawer }
}

describe('contas a pagar', () => {
  it('atraso, pagamento com dinheiro da gaveta (uma vez só), recorrência, estorno e cancelamento', async () => {
    const { s, admin, operator, fornecedor, drawer } = await scenario()
    await expect(s.payables.list(operator, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const luz = await s.payables.create(admin, { description: 'Conta de luz', supplierId: fornecedor.id, category: 'Energia', amountCents: 3000, dueDate: dayKey(-2), recurrence: 'MONTHLY' })
    expect(luz).toMatchObject({ status: 'OVERDUE', daysOverdue: 2, supplierName: 'Energia Elétrica SA' })
    const aluguel = await s.payables.create(admin, { description: 'Aluguel', category: 'Imóvel', amountCents: 150000, dueDate: dayKey(3) })
    const summary = await s.payables.summary(admin)
    expect(summary).toMatchObject({ overdueCount: 1, overdueCents: 3000, next7Count: 1, next7Cents: 150000, openCents: 153000 })
    expect((await s.payables.list(admin, { status: 'OVERDUE' })).items.map((p) => p.id)).toEqual([luz.id])
    expect((await s.payables.list(admin, { search: 'eletrica' })).items.map((p) => p.id)).toEqual([luz.id])

    // Dinheiro insuficiente na gaveta
    await expect(s.payables.pay(admin, { id: aluguel.id, requestId: rid(), paidCents: 150000, method: 'CASH', fromCash: true })).rejects.toMatchObject({ code: 'CONFLICT' })
    // Pagamento com juros saindo da gaveta; reenvio não duplica
    const key = rid()
    const paid = await s.payables.pay(admin, { id: luz.id, requestId: key, paidCents: 3100, method: 'CASH', fromCash: true })
    await s.payables.pay(admin, { id: luz.id, requestId: key, paidCents: 3100, method: 'CASH', fromCash: true })
    expect(paid).toMatchObject({ status: 'PAID', paidCents: 3100, paidFromCash: true, paidByName: 'Administrador' })
    expect(await drawer()).toBe(5000 - 3100)
    await expect(s.payables.pay(admin, { id: luz.id, requestId: rid(), paidCents: 3100, method: 'PIX' })).rejects.toMatchObject({ code: 'CONFLICT' })

    // Próxima conta mensal criada uma única vez
    const next = await s.payables.get(admin, { id: paid.recurrenceNextId! })
    expect(next).toMatchObject({ status: 'OPEN', amountCents: 3000, recurrence: 'MONTHLY', recurrenceSourceId: luz.id })
    expect(new Date(next.dueDate).getMonth()).toBe((new Date(luz.dueDate).getMonth() + 1) % 12)

    // Estorno devolve o dinheiro à gaveta; pagar de novo não cria outra recorrência
    await expect(s.payables.cancel(admin, { id: luz.id, reason: 'Teste' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const reversed = await s.payables.reverse(admin, { id: luz.id, reason: 'Pago em duplicidade' })
    expect(reversed).toMatchObject({ status: 'OVERDUE', paidCents: null })
    expect(await drawer()).toBe(5000)
    await s.payables.pay(admin, { id: luz.id, requestId: rid(), paidCents: 3000, method: 'PIX' })
    expect(await t.db.accountPayable.count({ where: { recurrenceSourceId: luz.id } })).toBe(1)
    expect(await drawer()).toBe(5000)

    const cancelled = await s.payables.cancel(admin, { id: aluguel.id, reason: 'Contrato encerrado' })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Contrato encerrado' })
    await expect(s.payables.update(admin, { id: aluguel.id, description: 'Aluguel', amountCents: 1, dueDate: dayKey(1) })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await s.payables.categories(admin)).toEqual(['Energia', 'Imóvel'])
    expect(await t.db.auditLog.count({ where: { action: { startsWith: 'payable.' } } })).toBeGreaterThanOrEqual(6)
  })

  it('não aceita pagamento com data futura nem gaveta para outras formas', async () => {
    const { s, admin } = await scenario()
    const p = await s.payables.create(admin, { description: 'Internet', amountCents: 10000, dueDate: dayKey(0) })
    await expect(s.payables.pay(admin, { id: p.id, requestId: rid(), paidCents: 10000, method: 'PIX', paidAt: dayKey(2) })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(s.payables.pay(admin, { id: p.id, requestId: rid(), paidCents: 10000, method: 'PIX', fromCash: true })).rejects.toMatchObject({ code: 'VALIDATION' })
    const paid = await s.payables.pay(admin, { id: p.id, requestId: rid(), paidCents: 10000, method: 'PIX', paidAt: dayKey(-1) })
    expect(new Date(paid.paidAt!).getDate()).toBe(new Date(Date.now() - 86400000).getDate())
  })
})

describe('contas a receber', () => {
  it('parcelamento avulso, recebimento parcial com juros e desconto, sem duplicidade e com estorno', async () => {
    const { s, admin, cliente, drawer } = await scenario()
    const parts = await s.receivables.create(admin, { description: 'Serviço de encadernação', customerId: cliente.id, amountCents: 10000, firstDueDate: dayKey(-5), installments: 3 })
    expect(parts.map((p) => p.amountCents)).toEqual([3334, 3333, 3333])
    expect(parts[0]).toMatchObject({ status: 'OVERDUE', description: 'Serviço de encadernação (1/3)', daysOverdue: 5 })

    // Parcial em dinheiro com juros: entra na gaveta; mesmo requestId não duplica
    const key = rid()
    let r = await s.receivables.receive(admin, { id: parts[0].id, requestId: key, amountCents: 2000, interestCents: 150, method: 'CASH' })
    r = await s.receivables.receive(admin, { id: parts[0].id, requestId: key, amountCents: 2000, interestCents: 150, method: 'CASH' })
    expect(r).toMatchObject({ status: 'OVERDUE', receivedCents: 2000, remainingCents: 1334 })
    expect(r.payments).toHaveLength(1)
    expect(await drawer()).toBe(5000 + 2150)
    await expect(s.receivables.receive(admin, { id: parts[0].id, requestId: rid(), amountCents: 1335, method: 'PIX' })).rejects.toMatchObject({ code: 'VALIDATION' })

    // Quitação com desconto concedido
    r = await s.receivables.receive(admin, { id: parts[0].id, requestId: rid(), amountCents: 1300, discountCents: 34, method: 'PIX' })
    expect(r).toMatchObject({ status: 'PAID', receivedCents: 3334, remainingCents: 0 })
    await expect(s.receivables.receive(admin, { id: parts[0].id, requestId: rid(), amountCents: 1, method: 'PIX' })).rejects.toMatchObject({ code: 'CONFLICT' })

    // Estorno do recebimento em dinheiro: sai da gaveta e a parcela volta a ficar em aberto
    r = await s.receivables.reverse(admin, { paymentId: r.payments[0].id, reason: 'Lançado na parcela errada' })
    expect(r).toMatchObject({ receivedCents: 1334, status: 'OVERDUE' })
    expect(await drawer()).toBe(5000)
    await expect(s.receivables.reverse(admin, { paymentId: r.payments[0].id, reason: 'De novo' })).rejects.toMatchObject({ code: 'CONFLICT' })

    // Cancelar só sem recebimentos ativos
    await expect(s.receivables.cancel(admin, { id: parts[0].id, reason: 'Teste' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await s.receivables.cancel(admin, { id: parts[2].id, reason: 'Negociado' })).status).toBe('CANCELLED')

    const summary = await s.receivables.summary(admin)
    expect(summary.settledMonthCents).toBe(1300) // estornados não contam
    expect((await s.customers.get(admin, { id: cliente.id })).openBalanceCents).toBe(2000 + 3333) // 1ª parcela: 20,00 estornados voltam ao saldo
  })

  it('dinheiro exige caixa aberto; outras formas são aceitas sem caixa', async () => {
    const { s, manager } = await scenario()
    const [r] = await s.receivables.create(manager, { description: 'Empréstimo de equipamento', amountCents: 5000, firstDueDate: dayKey(10) })
    await expect(s.receivables.receive(manager, { id: r.id, requestId: rid(), amountCents: 1000, method: 'CASH' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const ok = await s.receivables.receive(manager, { id: r.id, requestId: rid(), amountCents: 1000, method: 'PIX' })
    expect(ok).toMatchObject({ status: 'PARTIAL', remainingCents: 4000 })
    expect(ok.payments[0].cashSessionId).toBeNull()
  })
})

describe('crediário no PDV', () => {
  it('exige cliente com limite, gera parcelas, respeita o limite e integra cancelamento e devolução', async () => {
    const { s, admin, operator, cliente, caderno, caneta } = await scenario()
    const sale = (customerId: number | null, amountCents: number, installments = 1) =>
      s.sales.finalize(admin, {
        requestId: rid(),
        customerId,
        items: [{ productId: caderno.id, quantityMilli: (amountCents / 2000) * 1000 }],
        payments: [{ method: 'STORE_CREDIT', amountCents, installments, firstDueDate: dayKey(30) }]
      })
    await expect(sale(null, 2000)).rejects.toMatchObject({ code: 'VALIDATION' })
    const semLimite = await s.customers.create(admin, { name: 'Sem Limite' })
    await expect(sale(semLimite.id, 2000)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(sale(cliente.id, 12000)).rejects.toThrow(/Limite de crediário insuficiente/)

    const v = await sale(cliente.id, 6000, 3)
    expect(v.installments.map((i) => i.amountCents)).toEqual([2000, 2000, 2000])
    expect(new Date(v.installments[1].dueDate).getMonth()).toBe((new Date(v.installments[0].dueDate).getMonth() + 1) % 12)
    // Crediário não entra no caixa
    expect(await t.db.cashMovement.count({ where: { referenceType: 'SALE', referenceId: String(v.id) } })).toBe(0)
    // Limite disponível no PDV
    const [found] = await s.customers.search(operator, { query: 'ana' })
    expect(found).toMatchObject({ creditLimitCents: 10000, creditAvailableCents: 4000 })
    await expect(sale(cliente.id, 6000)).rejects.toThrow(/disponível R\$ 40,00/)

    // Devolução de 1 caderno abatida das parcelas (da última para a primeira)
    await s.sales.returnItems(admin, { requestId: rid(), saleId: v.id, items: [{ saleItemId: v.items[0].id, quantityMilli: 1000 }], reason: 'Defeito', refundMethod: 'STORE_CREDIT' })
    const after = await s.sales.get(admin, { id: v.id })
    expect(after.installments.map((i) => [i.amountCents, i.status])).toEqual([[2000, 'OPEN'], [2000, 'OPEN'], [0, 'CANCELLED']])

    // Venda sem crediário não aceita abater crediário
    const avista = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 300 }] })
    await expect(
      s.sales.returnItems(admin, { requestId: rid(), saleId: avista.id, items: [{ saleItemId: avista.items[0].id, quantityMilli: 1000 }], reason: 'Teste', refundMethod: 'STORE_CREDIT' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    // Venda com parcela recebida não pode ser cancelada sem estornar
    const v2 = await sale(cliente.id, 2000)
    const [inst] = (await s.receivables.list(admin, { saleId: v2.id })).items
    const received = await s.receivables.receive(admin, { id: inst.id, requestId: rid(), amountCents: 500, method: 'PIX' })
    await expect(s.sales.cancel(admin, { saleId: v2.id, reason: 'Cliente desistiu' })).rejects.toThrow(/Estorne os recebimentos/)
    await expect(s.receivables.cancel(admin, { id: inst.id, reason: 'x x x' })).rejects.toThrow(/cancele ou devolva a venda/)
    await s.receivables.reverse(admin, { paymentId: received.payments[0].id, reason: 'Venda será cancelada' })
    await s.sales.cancel(admin, { saleId: v2.id, reason: 'Cliente desistiu' })
    expect((await s.receivables.get(admin, { id: inst.id })).status).toBe('CANCELLED')
  })

  it('somente o financeiro define limite de crediário', async () => {
    const { s, operator, manager, cliente } = await scenario()
    const c = await s.customers.create(operator, { name: 'Cliente do Caixa' })
    await expect(s.customers.update(operator, { id: c.id, name: 'Cliente do Caixa', active: true, creditLimitCents: 50000 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.customers.create(operator, { name: 'Outro Cliente', creditLimitCents: 100 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Editar outros dados sem enviar o limite mantém o limite atual
    const kept = await s.customers.update(operator, { id: cliente.id, name: 'Ana Crediário', document: '52998224725', active: true, city: 'Recife' })
    expect(kept.creditLimitCents).toBe(10000)
    const raised = await s.customers.update(manager, { id: cliente.id, name: 'Ana Crediário', document: '52998224725', active: true, creditLimitCents: 20000 })
    expect(raised.creditLimitCents).toBe(20000)
  })
})

/** Lê um arquivo de dentro do .xlsx (ZIP) usando o diretório central. */
function unzipEntry(zip: Buffer, name: string): string {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let p = zip.readUInt32LE(end + 16)
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const nameLen = zip.readUInt16LE(p + 28)
    const entry = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const offset = zip.readUInt32LE(p + 42)
    const size = zip.readUInt32LE(p + 20)
    if (entry === name) {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
      return zlib.inflateRawSync(zip.subarray(start, start + size)).toString('utf8')
    }
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32)
  }
  throw new Error(`entrada ${name} não encontrada`)
}

describe('relatórios', () => {
  it('vendas, margens, formas de pagamento, produtos, fluxo de caixa e exportação a partir dos registros', async () => {
    const { s, admin, operator, cat, caderno, caneta, cliente } = await scenario()
    const today = dayKey(0)
    await expect(s.reports.run(operator, { key: 'sales-daily', from: today, to: today })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(s.reports.run(admin, { key: 'sales-daily', from: dayKey(-800), to: today })).rejects.toMatchObject({ code: 'VALIDATION' })

    // 2 cadernos (40,00, custo 16,00) com desconto de 4,00 pago em dinheiro com troco + 10 canetas no PIX
    const v1 = await s.sales.finalize(admin, { requestId: rid(), discountCents: 400, items: [{ productId: caderno.id, quantityMilli: 2000 }], payments: [{ method: 'CASH', amountCents: 5000 }] })
    await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 10000 }], payments: [{ method: 'PIX', amountCents: 3000 }] })
    const cancelada = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneta.id, quantityMilli: 1000 }], payments: [{ method: 'PIX', amountCents: 300 }] })
    await s.sales.cancel(admin, { saleId: cancelada.id, reason: 'Erro de digitação' })
    // devolução de 1 caderno (18,00 após o desconto rateado) em dinheiro
    await s.sales.returnItems(admin, { requestId: rid(), saleId: v1.id, items: [{ saleItemId: v1.items[0].id, quantityMilli: 1000 }], reason: 'Troca', refundMethod: 'CASH' })
    await s.sales.finalize(admin, { requestId: rid(), customerId: cliente.id, items: [{ productId: caderno.id, quantityMilli: 1000 }], payments: [{ method: 'STORE_CREDIT', amountCents: 2000 }] })
    const conta = await s.payables.create(admin, { description: 'Material de limpeza', amountCents: 1500, dueDate: today })
    await s.payables.pay(admin, { id: conta.id, requestId: rid(), paidCents: 1500, method: 'PIX' })
    await s.payables.create(admin, { description: 'Aluguel', amountCents: 90000, dueDate: dayKey(1) })

    const daily = await s.reports.run(admin, { key: 'sales-daily', from: today, to: today })
    expect(daily.rows).toHaveLength(1)
    expect(daily.totals).toMatchObject({ sales: 3, gross: 4000 + 3000 + 2000, discount: 400, revenue: 3600 + 3000 + 2000, refunds: 1800, net: 6800, cost: 800 + 1000 + 800 })
    expect(daily.totals!.profit).toBe(6800 - 2600)
    expect(daily.totals!.margin).toBe(Math.round((4200 * 10000) / 6800))

    // Filtro por categoria: só cadernos
    const papelaria = await s.reports.run(admin, { key: 'sales-daily', from: today, to: today, categoryId: cat.id })
    expect(papelaria.totals).toMatchObject({ sales: 2, revenue: 5600, refunds: 1800, cost: 1600 })
    expect(papelaria.subtitle).toContain('Categoria: Papelaria')

    const methods = await s.reports.run(admin, { key: 'payment-methods', from: today, to: today })
    expect(Object.fromEntries(methods.rows.map((r) => [r.method, r.amount]))).toEqual({ Dinheiro: 3600, PIX: 3000, Crediário: 2000 })

    const top = await s.reports.run(admin, { key: 'products-top', from: today, to: today })
    expect(top.rows.map((r) => [r.product, r.qty])).toEqual([['Caneta', 10000], ['Caderno', 2000]])
    const bottom = await s.reports.run(admin, { key: 'products-bottom', from: today, to: today })
    expect(bottom.rows[0]).toMatchObject({ product: 'Caderno', qty: 2000 })

    const cancels = await s.reports.run(admin, { key: 'cancellations', from: today, to: today })
    expect(cancels.rows.map((r) => r.type)).toEqual(['Cancelamento', 'Devolução'])
    const ops = await s.reports.run(admin, { key: 'operators', from: today, to: today })
    expect(ops.rows[0]).toMatchObject({ operator: 'Administrador', sales: 3, cancelled: 1, refunds: 1800 })
    const discounts = await s.reports.run(admin, { key: 'discounts', from: today, to: today })
    expect(discounts.totals).toMatchObject({ discount: 400, subtotal: 4000 })

    // Fluxo: vendas recebidas (36 + 30 + 3 − 3 cancelada − 18 reembolso), crediário fora; conta paga 15; aluguel previsto amanhã
    const flow = await s.reports.run(admin, { key: 'cash-flow', from: today, to: dayKey(1) })
    expect(flow.rows[0]).toMatchObject({ sales: 3600 + 3000 - 1800, received: 0, paid: 1500, net: 4800 - 1500 })
    expect(flow.rows[1]).toMatchObject({ expectedOut: 90000 })
    expect(flow.totals!.balance).toBe(3300 - 90000)

    const stock = await s.reports.run(admin, { key: 'stock', from: today, to: today })
    expect(stock.rows.find((r) => r.product === 'Caderno')).toMatchObject({ qty: 10000 - 3000 + 1000, costValue: 8 * 800 })
    const payables = await s.reports.run(admin, { key: 'payables', from: today, to: dayKey(1) })
    expect(payables.totals).toMatchObject({ amount: 91500, paid: 1500 })
    const receivables = await s.reports.run(admin, { key: 'receivables', from: today, to: dayKey(40) })
    expect(receivables.totals).toMatchObject({ amount: 2000, remaining: 2000 })
    const moves = await s.reports.run(admin, { key: 'stock-movements', from: today, to: today, productId: caderno.id })
    expect(moves.rows.map((r) => r.type)).toEqual(['Estoque inicial', 'Venda', 'Devolução', 'Venda'])

    // Exportação: CSV no padrão brasileiro e XLSX válido com números
    const csv = reportToCsv(daily)
    expect(csv.startsWith('﻿Vendas por dia')).toBe(true)
    expect(csv).toContain('Faturamento (R$)')
    expect(csv).toContain(';86,00;')
    const xlsx = reportToXlsx(daily)
    expect(xlsx.subarray(0, 2).toString()).toBe('PK')
    const sheet = unzipEntry(xlsx, 'xl/worksheets/sheet1.xml')
    expect(sheet).toContain('<v>86</v>')
    expect(sheet).toContain('Receita líquida')
    expect(unzipEntry(xlsx, '[Content_Types].xml')).toContain('spreadsheetml.sheet.main+xml')
  })
})
