import type { ReportColumn, ReportResult, ReportRow } from '@shared/api'
import { REPORTS, reportSchema, type ReportKey } from '@shared/financeSchemas'
import { formatDate, formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS, REFUND_METHOD_LABELS, STOCK_MOVEMENT_LABELS, monthLabel } from '@shared/labels'
import type { Db } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { addDays, dayKey, monthKey, startOfDay } from '../utils/dates'
import { validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { fromDateKey } from './product.mappers'
import type { StockService } from './stock.service'

type Query = { key: ReportKey; from: Date; to: Date; fromKey: string; toKey: string; categoryId: number | null; productId: number | null }
type Built = Pick<ReportResult, 'columns' | 'rows' | 'totals' | 'chart' | 'notes'>

const MAX_DAYS = 731
const MAX_ROWS = 10_000

const col = (key: string, label: string, format: ReportColumn['format'] = 'text'): ReportColumn => ({ key, label, format })
/** Margem em pontos-base (lucro / receita). */
const margin = (profit: number, revenue: number) => (revenue > 0 ? Math.round((profit * 10000) / revenue) : null)
const sumBy = <T>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)
const costOf = (unitCostCents: number, quantityMilli: number) => Math.round((unitCostCents * quantityMilli) / 1000)

/**
 * Relatórios gerenciais. Todos os valores vêm dos registros gravados (vendas, itens, devoluções,
 * pagamentos, movimentações e contas); nada é estimado ou fictício.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly stock: StockService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async run(actorInput: Actor | null, input: unknown): Promise<ReportResult> {
    const actor = requirePermission(actorInput, 'reports.view')
    const data = reportSchema.parse(input)
    const from = fromDateKey(data.from)!
    const to = fromDateKey(data.to, true)!
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) throw validationError('Escolha um período de até 2 anos.', { to: 'Período muito longo' })
    const q: Query = { key: data.key, from, to, fromKey: data.from, toKey: data.to, categoryId: data.categoryId, productId: data.productId }
    const built = await this.build(actor, q)
    return { key: q.key, title: REPORTS[q.key].label, subtitle: await this.subtitle(q), generatedAt: this.now().toISOString(), ...built }
  }

  private async subtitle(q: Query): Promise<string> {
    const def = REPORTS[q.key]
    const parts: string[] = []
    if (def.filters.includes('period' as never)) parts.push(`Período: ${formatDate(q.from)} a ${formatDate(q.to)}`)
    else parts.push(`Posição em ${formatDate(this.now())}`)
    if (q.categoryId && def.filters.includes('category' as never)) {
      const c = await this.db.category.findUnique({ where: { id: q.categoryId } })
      if (c) parts.push(`Categoria: ${c.name}`)
    }
    if (q.productId && def.filters.includes('product' as never)) {
      const p = await this.db.product.findUnique({ where: { id: q.productId } })
      if (p) parts.push(`Produto: ${p.name}`)
    }
    return parts.join(' · ')
  }

  private build(actor: Actor, q: Query): Promise<Built> {
    switch (q.key) {
      case 'sales-daily':
        return this.salesByPeriod(q, 'day')
      case 'sales-monthly':
        return this.salesByPeriod(q, 'month')
      case 'payment-methods':
        return this.paymentMethods(q)
      case 'discounts':
        return this.discounts(q)
      case 'cancellations':
        return this.cancellations(q)
      case 'operators':
        return this.operators(q)
      case 'products-top':
        return this.products(q, 'top')
      case 'products-bottom':
        return this.products(q, 'bottom')
      case 'stock':
        return this.stockPosition(actor, q)
      case 'stock-movements':
        return this.stockMovements(q)
      case 'cash-flow':
        return this.cashFlow(q)
      case 'payables':
        return this.payables(q)
      case 'receivables':
        return this.receivables(q)
    }
  }

  // ───────────── Vendas ─────────────

  private productWhere(q: Query): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = []
    if (q.categoryId) and.push({ OR: [{ categoryId: q.categoryId }, { subcategoryId: q.categoryId }] })
    if (q.productId) and.push({ id: q.productId })
    return { AND: and }
  }

  /** Itens vendidos (vendas concluídas) e itens devolvidos no período, com os filtros de produto. */
  private async soldAndReturned(q: Query) {
    const product = this.productWhere(q)
    const [items, returned] = await Promise.all([
      this.db.saleItem.findMany({
        where: { sale: { status: 'COMPLETED', createdAt: { gte: q.from, lte: q.to } }, product },
        select: { saleId: true, productId: true, quantityMilli: true, unitCostCents: true, totalCents: true, discountCents: true, sale: { select: { createdAt: true } } }
      }),
      this.db.saleReturnItem.findMany({
        where: { saleReturn: { createdAt: { gte: q.from, lte: q.to } }, saleItem: { product } },
        select: {
          quantityMilli: true,
          amountCents: true,
          saleReturn: { select: { createdAt: true, refundMethod: true } },
          saleItem: { select: { productId: true, unitCostCents: true } }
        }
      })
    ])
    // Devolução sem reembolso não reduz a receita (o cliente pagou); o custo sempre volta ao estoque
    const returns = returned.map((r) => ({
      productId: r.saleItem.productId,
      createdAt: r.saleReturn.createdAt,
      quantityMilli: r.quantityMilli,
      refundCents: r.saleReturn.refundMethod === 'NONE' ? 0 : r.amountCents,
      costCents: costOf(r.saleItem.unitCostCents, r.quantityMilli)
    }))
    return { items, returns }
  }

  private async salesByPeriod(q: Query, by: 'day' | 'month'): Promise<Built> {
    const { items, returns } = await this.soldAndReturned(q)
    const keyOf = (d: Date) => (by === 'day' ? dayKey(d) : monthKey(d))
    const buckets = new Map<string, { sales: Set<number>; gross: number; discount: number; revenue: number; refunds: number; cost: number }>()
    // Períodos sem venda aparecem zerados (leitura correta do gráfico)
    for (let d = startOfDay(q.from); d <= q.to; d = by === 'day' ? addDays(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      buckets.set(keyOf(d), { sales: new Set(), gross: 0, discount: 0, revenue: 0, refunds: 0, cost: 0 })
    }
    for (const i of items) {
      const b = buckets.get(keyOf(i.sale.createdAt))!
      b.sales.add(i.saleId)
      b.gross += i.totalCents + i.discountCents
      b.discount += i.discountCents
      b.revenue += i.totalCents
      b.cost += costOf(i.unitCostCents, i.quantityMilli)
    }
    for (const r of returns) {
      const b = buckets.get(keyOf(r.createdAt))
      if (!b) continue
      b.refunds += r.refundCents
      b.cost -= r.costCents
    }
    const rows: ReportRow[] = [...buckets].map(([key, b]) => {
      const net = b.revenue - b.refunds
      return {
        period: by === 'day' ? formatDate(fromDateKey(key)!) : monthLabel(key),
        sales: b.sales.size,
        gross: b.gross,
        discount: b.discount,
        revenue: b.revenue,
        refunds: b.refunds,
        net,
        cost: b.cost,
        profit: net - b.cost,
        margin: margin(net - b.cost, net),
        ticket: b.sales.size ? Math.round(b.revenue / b.sales.size) : 0
      }
    })
    const salesCount = new Set(items.map((i) => i.saleId)).size
    const t = {
      gross: sumBy(rows, (r) => r.gross as number),
      discount: sumBy(rows, (r) => r.discount as number),
      revenue: sumBy(rows, (r) => r.revenue as number),
      refunds: sumBy(rows, (r) => r.refunds as number),
      net: sumBy(rows, (r) => r.net as number),
      cost: sumBy(rows, (r) => r.cost as number)
    }
    return {
      columns: [
        col('period', by === 'day' ? 'Dia' : 'Mês'),
        col('sales', 'Vendas', 'int'),
        col('gross', 'Valor bruto', 'money'),
        col('discount', 'Descontos', 'money'),
        col('revenue', 'Faturamento', 'money'),
        col('refunds', 'Devoluções', 'money'),
        col('net', 'Receita líquida', 'money'),
        col('cost', 'Custo (CMV)', 'money'),
        col('profit', 'Lucro bruto', 'money'),
        col('margin', 'Margem', 'percent'),
        col('ticket', 'Ticket médio', 'money')
      ],
      rows,
      totals: { period: 'Total', sales: salesCount, ...t, profit: t.net - t.cost, margin: margin(t.net - t.cost, t.net), ticket: salesCount ? Math.round(t.revenue / salesCount) : 0 },
      chart: { type: 'bar', x: 'period', series: [{ key: 'net', label: 'Receita líquida' }, { key: 'profit', label: 'Lucro bruto' }] },
      notes: [
        'Faturamento = vendas concluídas (cancelamentos excluídos). Devoluções reduzem a receita na data da devolução, exceto as sem reembolso.',
        'Custo = custo unitário gravado no momento da venda; itens devolvidos voltam ao custo do estoque.',
        ...(q.categoryId || q.productId ? ['Com filtro de produto/categoria, "Vendas" conta as vendas que tiveram ao menos um item filtrado.'] : [])
      ]
    }
  }

  private async paymentMethods(q: Query): Promise<Built> {
    const sales = await this.db.sale.findMany({
      where: { status: 'COMPLETED', createdAt: { gte: q.from, lte: q.to } },
      select: { id: true, changeCents: true, payments: { select: { method: true, amountCents: true } } }
    })
    const by = new Map<string, { sales: Set<number>; amount: number }>()
    for (const s of sales) {
      for (const p of s.payments) {
        const b = by.get(p.method) ?? { sales: new Set(), amount: 0 }
        b.sales.add(s.id)
        b.amount += p.amountCents
        by.set(p.method, b)
      }
      // Troco sai do dinheiro recebido
      if (s.changeCents) by.get('CASH')!.amount -= s.changeCents
    }
    const total = sumBy([...by.values()], (b) => b.amount)
    const rows = [...by]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([method, b]) => ({ method: PAYMENT_METHOD_LABELS[method] ?? method, sales: b.sales.size, amount: b.amount, share: total ? Math.round((b.amount * 10000) / total) : 0 }))
    return {
      columns: [col('method', 'Forma de pagamento'), col('sales', 'Vendas', 'int'), col('amount', 'Valor recebido', 'money'), col('share', 'Participação', 'percent')],
      rows,
      totals: { method: 'Total', sales: sales.length, amount: total, share: total ? 10000 : 0 },
      chart: { type: 'bar', x: 'method', series: [{ key: 'amount', label: 'Valor recebido' }] },
      notes: [
        'Dinheiro já descontado do troco. Uma venda paga com mais de uma forma aparece em cada uma delas.',
        'PIX e cartão sem TEF são registros manuais do operador, não confirmações bancárias.'
      ]
    }
  }

  private async discounts(q: Query): Promise<Built> {
    const sales = await this.db.sale.findMany({
      where: { status: 'COMPLETED', discountCents: { gt: 0 }, createdAt: { gte: q.from, lte: q.to } },
      include: { user: { select: { name: true } }, customer: { select: { name: true } }, discountAuthorizedBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS
    })
    const rows = sales.map((s) => ({
      date: s.createdAt.toISOString(),
      sale: `#${s.id}`,
      operator: s.user.name,
      customer: s.customer?.name ?? '',
      subtotal: s.subtotalCents,
      discount: s.discountCents,
      pct: margin(s.discountCents, s.subtotalCents),
      authorizedBy: s.discountAuthorizedBy?.name ?? ''
    }))
    const subtotal = sumBy(sales, (s) => s.subtotalCents)
    const discount = sumBy(sales, (s) => s.discountCents)
    return {
      columns: [
        col('date', 'Data', 'datetime'),
        col('sale', 'Venda'),
        col('operator', 'Operador'),
        col('customer', 'Cliente'),
        col('subtotal', 'Subtotal', 'money'),
        col('discount', 'Desconto', 'money'),
        col('pct', '% desconto', 'percent'),
        col('authorizedBy', 'Autorizado por')
      ],
      rows,
      totals: { date: null, sale: `${rows.length} venda(s)`, operator: '', customer: '', subtotal, discount, pct: margin(discount, subtotal), authorizedBy: '' },
      chart: null,
      notes: ['Inclui descontos por item e na venda. "Autorizado por" aparece quando o desconto ultrapassou o limite do operador.']
    }
  }

  private async cancellations(q: Query): Promise<Built> {
    const [cancelled, returns] = await Promise.all([
      this.db.sale.findMany({
        where: { status: 'CANCELLED', cancelledAt: { gte: q.from, lte: q.to } },
        include: { user: { select: { name: true } }, cancelledBy: { select: { name: true } } },
        take: MAX_ROWS
      }),
      this.db.saleReturn.findMany({
        where: { createdAt: { gte: q.from, lte: q.to } },
        include: { user: { select: { name: true } }, items: { select: { amountCents: true } } },
        take: MAX_ROWS
      })
    ])
    const rows: (ReportRow & { _t: number })[] = [
      ...cancelled.map((s) => ({
        _t: s.cancelledAt!.getTime(),
        date: s.cancelledAt!.toISOString(),
        type: 'Cancelamento',
        sale: `#${s.id}`,
        operator: s.user.name,
        authorizedBy: s.cancelledBy?.name ?? '',
        reason: s.cancelReason ?? '',
        refund: 'Estorno das formas de pagamento',
        amount: s.totalCents
      })),
      ...returns.map((r) => ({
        _t: r.createdAt.getTime(),
        date: r.createdAt.toISOString(),
        type: 'Devolução',
        sale: `#${r.saleId}`,
        operator: r.user.name,
        authorizedBy: '',
        reason: r.reason,
        refund: REFUND_METHOD_LABELS[r.refundMethod] ?? r.refundMethod,
        amount: sumBy(r.items, (i) => i.amountCents)
      }))
    ].sort((a, b) => a._t - b._t)
    return {
      columns: [
        col('date', 'Data', 'datetime'),
        col('type', 'Tipo'),
        col('sale', 'Venda'),
        col('operator', 'Operador'),
        col('authorizedBy', 'Cancelado/autorizado por'),
        col('reason', 'Motivo'),
        col('refund', 'Reembolso'),
        col('amount', 'Valor', 'money')
      ],
      rows: rows.map(({ _t, ...r }) => r),
      totals: {
        date: null,
        type: `${cancelled.length} cancelamento(s), ${returns.length} devolução(ões)`,
        sale: '',
        operator: '',
        authorizedBy: '',
        reason: '',
        refund: '',
        amount: sumBy(rows, (r) => r.amount as number)
      },
      chart: null,
      notes: []
    }
  }

  private async operators(q: Query): Promise<Built> {
    const range = { gte: q.from, lte: q.to }
    const [sales, cancelled, returns] = await Promise.all([
      this.db.sale.findMany({ where: { status: 'COMPLETED', createdAt: range }, select: { userId: true, totalCents: true, discountCents: true } }),
      this.db.sale.findMany({ where: { status: 'CANCELLED', cancelledAt: range }, select: { userId: true, totalCents: true } }),
      this.db.saleReturn.findMany({ where: { createdAt: range }, select: { userId: true, refundCents: true } })
    ])
    const by = new Map<number, { sales: number; revenue: number; discount: number; cancelled: number; cancelledCents: number; refunds: number }>()
    const get = (id: number) => by.get(id) ?? (by.set(id, { sales: 0, revenue: 0, discount: 0, cancelled: 0, cancelledCents: 0, refunds: 0 }), by.get(id)!)
    for (const s of sales) {
      const b = get(s.userId)
      b.sales += 1
      b.revenue += s.totalCents
      b.discount += s.discountCents
    }
    for (const s of cancelled) {
      const b = get(s.userId)
      b.cancelled += 1
      b.cancelledCents += s.totalCents
    }
    for (const r of returns) get(r.userId).refunds += r.refundCents
    const users = await this.db.user.findMany({ where: { id: { in: [...by.keys()] } }, select: { id: true, name: true } })
    const name = new Map(users.map((u) => [u.id, u.name]))
    const rows = [...by]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([id, b]) => ({
        operator: name.get(id) ?? `#${id}`,
        sales: b.sales,
        revenue: b.revenue,
        ticket: b.sales ? Math.round(b.revenue / b.sales) : 0,
        discount: b.discount,
        discountPct: margin(b.discount, b.revenue + b.discount),
        cancelled: b.cancelled,
        cancelledCents: b.cancelledCents,
        refunds: b.refunds
      }))
    const t = { sales: sumBy(rows, (r) => r.sales), revenue: sumBy(rows, (r) => r.revenue), discount: sumBy(rows, (r) => r.discount) }
    return {
      columns: [
        col('operator', 'Operador'),
        col('sales', 'Vendas', 'int'),
        col('revenue', 'Faturamento', 'money'),
        col('ticket', 'Ticket médio', 'money'),
        col('discount', 'Descontos', 'money'),
        col('discountPct', '% desconto', 'percent'),
        col('cancelled', 'Cancelamentos', 'int'),
        col('cancelledCents', 'Valor cancelado', 'money'),
        col('refunds', 'Reembolsos', 'money')
      ],
      rows,
      totals: {
        operator: 'Total',
        ...t,
        ticket: t.sales ? Math.round(t.revenue / t.sales) : 0,
        discountPct: margin(t.discount, t.revenue + t.discount),
        cancelled: sumBy(rows, (r) => r.cancelled),
        cancelledCents: sumBy(rows, (r) => r.cancelledCents),
        refunds: sumBy(rows, (r) => r.refunds)
      },
      chart: { type: 'bar', x: 'operator', series: [{ key: 'revenue', label: 'Faturamento' }] },
      notes: ['Operador = usuário que registrou a venda no PDV. Cancelamentos contam pela data do cancelamento.']
    }
  }

  // ───────────── Produtos e estoque ─────────────

  private async products(q: Query, mode: 'top' | 'bottom'): Promise<Built> {
    const { items, returns } = await this.soldAndReturned(q)
    const by = new Map<number, { qty: number; revenue: number; cost: number }>()
    const get = (id: number) => by.get(id) ?? (by.set(id, { qty: 0, revenue: 0, cost: 0 }), by.get(id)!)
    for (const i of items) {
      const b = get(i.productId)
      b.qty += i.quantityMilli
      b.revenue += i.totalCents
      b.cost += costOf(i.unitCostCents, i.quantityMilli)
    }
    for (const r of returns) {
      const b = get(r.productId)
      b.qty -= r.quantityMilli
      b.revenue -= r.refundCents
      b.cost -= r.costCents
    }
    // "Menos vendidos" inclui produtos ativos sem nenhuma venda no período
    const products = await this.db.product.findMany({
      where: mode === 'bottom' ? { AND: [this.productWhere(q), { deletedAt: null, active: true }] } : { id: { in: [...by.keys()] } },
      select: { id: true, internalCode: true, name: true, unit: true, category: { select: { name: true } } }
    })
    const rows = products
      .map((p) => {
        const b = by.get(p.id) ?? { qty: 0, revenue: 0, cost: 0 }
        return { code: p.internalCode, product: p.name, category: p.category?.name ?? '', unit: p.unit, qty: b.qty, revenue: b.revenue, cost: b.cost, profit: b.revenue - b.cost, margin: margin(b.revenue - b.cost, b.revenue) }
      })
      .filter((r) => mode === 'bottom' || r.qty > 0 || r.revenue !== 0)
      .sort((a, b) => (mode === 'top' ? b.qty - a.qty || b.revenue - a.revenue : a.qty - b.qty || a.revenue - b.revenue))
    const t = { revenue: sumBy(rows, (r) => r.revenue), cost: sumBy(rows, (r) => r.cost) }
    return {
      columns: [
        col('code', 'Código'),
        col('product', 'Produto'),
        col('category', 'Categoria'),
        col('unit', 'Un.'),
        col('qty', 'Quantidade', 'qty'),
        col('revenue', 'Receita', 'money'),
        col('cost', 'Custo', 'money'),
        col('profit', 'Lucro bruto', 'money'),
        col('margin', 'Margem', 'percent')
      ],
      rows,
      totals: { code: '', product: `${rows.length} produto(s)`, category: '', unit: '', qty: null, ...t, profit: t.revenue - t.cost, margin: margin(t.revenue - t.cost, t.revenue) },
      chart: mode === 'top' && rows.length ? { type: 'bar', x: 'product', series: [{ key: 'revenue', label: 'Receita' }] } : null,
      notes: ['Quantidades e valores líquidos de devoluções. Produtos com variações aparecem somados.']
    }
  }

  private async stockPosition(actor: Actor, q: Query): Promise<Built> {
    const positions = await this.stock.positionsForReport(actor, { categoryId: q.categoryId ?? undefined, productIds: q.productId ? [q.productId] : undefined })
    const prices = await this.db.product.findMany({ where: { id: { in: [...new Set(positions.map((p) => p.productId))] } }, select: { id: true, salePriceCents: true, variants: { select: { id: true, salePriceCents: true } } } })
    const priceOf = new Map<string, number>()
    for (const p of prices) {
      priceOf.set(`${p.id}:`, p.salePriceCents)
      for (const v of p.variants) priceOf.set(`${p.id}:${v.id}`, v.salePriceCents ?? p.salePriceCents)
    }
    const STATUS: Record<string, string> = { ok: 'Normal', low: 'Abaixo do mínimo', out: 'Sem estoque', negative: 'Negativo' }
    const rows = positions.map((p) => {
      const price = priceOf.get(`${p.productId}:${p.variantId ?? ''}`) ?? 0
      const qty = Math.max(p.stockMilli, 0)
      return {
        code: p.internalCode,
        product: p.variantName ? `${p.name} — ${p.variantName}` : p.name,
        category: p.categoryName ?? '',
        unit: p.unit,
        qty: p.stockMilli,
        min: p.minStockMilli,
        unitCost: p.unitCostCents,
        costValue: p.stockValueCents ?? 0,
        price,
        saleValue: Math.round((price * qty) / 1000),
        status: STATUS[p.status] ?? p.status
      }
    })
    return {
      columns: [
        col('code', 'Código'),
        col('product', 'Produto'),
        col('category', 'Categoria'),
        col('unit', 'Un.'),
        col('qty', 'Estoque', 'qty'),
        col('min', 'Mínimo', 'qty'),
        col('unitCost', 'Custo unit.', 'money'),
        col('costValue', 'Valor (custo)', 'money'),
        col('price', 'Preço venda', 'money'),
        col('saleValue', 'Valor (venda)', 'money'),
        col('status', 'Situação')
      ],
      rows,
      totals: {
        code: '',
        product: `${rows.length} item(ns)`,
        category: '',
        unit: '',
        qty: null,
        min: null,
        unitCost: null,
        costValue: sumBy(rows, (r) => r.costValue),
        price: null,
        saleValue: sumBy(rows, (r) => r.saleValue),
        status: `${positions.filter((p) => p.status === 'low').length} abaixo do mínimo`
      },
      chart: null,
      notes: ['Posição atual (o período não se aplica). Serviços não têm estoque e não aparecem. Saldos negativos não entram no valor.']
    }
  }

  private async stockMovements(q: Query): Promise<Built> {
    const rows = await this.db.stockMovement.findMany({
      where: { createdAt: { gte: q.from, lte: q.to }, product: this.productWhere(q) },
      include: { product: { select: { internalCode: true, name: true, unit: true } }, variant: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS + 1
    })
    const truncated = rows.length > MAX_ROWS
    const list = rows.slice(0, MAX_ROWS).map((m) => ({
      date: m.createdAt.toISOString(),
      code: m.product.internalCode,
      product: m.variant ? `${m.product.name} — ${m.variant.name}` : m.product.name,
      type: STOCK_MOVEMENT_LABELS[m.type],
      qty: m.quantityMilli,
      balance: m.balanceAfterMilli,
      user: m.user?.name ?? '',
      reason: m.reason ?? ''
    }))
    return {
      columns: [
        col('date', 'Data', 'datetime'),
        col('code', 'Código'),
        col('product', 'Produto'),
        col('type', 'Tipo'),
        col('qty', 'Quantidade', 'qty'),
        col('balance', 'Saldo após', 'qty'),
        col('user', 'Usuário'),
        col('reason', 'Motivo / documento')
      ],
      rows: list,
      totals: {
        date: null,
        code: '',
        product: `${list.length} movimentação(ões)`,
        type: '',
        qty: null,
        balance: null,
        user: `Entradas: ${list.filter((m) => m.qty > 0).length}`,
        reason: `Saídas: ${list.filter((m) => m.qty < 0).length}`
      },
      chart: null,
      notes: truncated ? [`Mostrando as primeiras ${MAX_ROWS} movimentações. Reduza o período para ver todas.`] : []
    }
  }

  // ───────────── Financeiro ─────────────

  /**
   * Fluxo de caixa diário: entradas realizadas (vendas recebidas, líquidas de cancelamentos e reembolsos,
   * e recebimentos de contas), saídas realizadas (contas pagas) e previsão (vencimentos em aberto).
   */
  private async cashFlow(q: Query): Promise<Built> {
    const range = { gte: q.from, lte: q.to }
    const today = startOfDay(this.now())
    const [sales, received, paid, toReceive, toPay, overdueIn, overdueOut] = await Promise.all([
      this.db.cashMovement.findMany({ where: { type: { in: ['SALE', 'SALE_CANCEL', 'RETURN_REFUND'] }, createdAt: range }, select: { createdAt: true, amountCents: true } }),
      this.db.receivablePayment.findMany({ where: { reversedAt: null, paidAt: range }, select: { paidAt: true, amountCents: true, interestCents: true } }),
      this.db.accountPayable.findMany({ where: { status: 'PAID', paidAt: range }, select: { paidAt: true, paidCents: true } }),
      this.db.accountReceivable.findMany({ where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: q.from < today ? today : q.from, lte: q.to } }, select: { dueDate: true, amountCents: true, receivedCents: true } }),
      this.db.accountPayable.findMany({ where: { status: 'OPEN', dueDate: { gte: q.from < today ? today : q.from, lte: q.to } }, select: { dueDate: true, amountCents: true } }),
      this.db.accountReceivable.aggregate({ where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: today } }, _sum: { amountCents: true, receivedCents: true } }),
      this.db.accountPayable.aggregate({ where: { status: 'OPEN', dueDate: { lt: today } }, _sum: { amountCents: true } })
    ])
    const days = new Map<string, { sales: number; received: number; paid: number; expectedIn: number; expectedOut: number }>()
    for (let d = startOfDay(q.from); d <= q.to; d = addDays(d, 1)) days.set(dayKey(d), { sales: 0, received: 0, paid: 0, expectedIn: 0, expectedOut: 0 })
    const add = (d: Date, field: 'sales' | 'received' | 'paid' | 'expectedIn' | 'expectedOut', cents: number) => {
      const day = days.get(dayKey(d))
      if (day) day[field] += cents
    }
    for (const m of sales) add(m.createdAt, 'sales', m.amountCents)
    for (const p of received) add(p.paidAt, 'received', p.amountCents + p.interestCents)
    for (const p of paid) add(p.paidAt!, 'paid', p.paidCents ?? 0)
    for (const r of toReceive) add(r.dueDate, 'expectedIn', r.amountCents - r.receivedCents)
    for (const p of toPay) add(p.dueDate, 'expectedOut', p.amountCents)
    let balance = 0
    const rows = [...days].map(([key, d]) => {
      const net = d.sales + d.received - d.paid
      balance += net + d.expectedIn - d.expectedOut
      return { date: formatDate(fromDateKey(key)!), sales: d.sales, received: d.received, paid: d.paid, net, expectedIn: d.expectedIn, expectedOut: d.expectedOut, balance }
    })
    const t = {
      sales: sumBy(rows, (r) => r.sales),
      received: sumBy(rows, (r) => r.received),
      paid: sumBy(rows, (r) => r.paid),
      expectedIn: sumBy(rows, (r) => r.expectedIn),
      expectedOut: sumBy(rows, (r) => r.expectedOut)
    }
    const overdueReceivable = (overdueIn._sum.amountCents ?? 0) - (overdueIn._sum.receivedCents ?? 0)
    return {
      columns: [
        col('date', 'Dia'),
        col('sales', 'Vendas recebidas', 'money'),
        col('received', 'Contas recebidas', 'money'),
        col('paid', 'Contas pagas', 'money'),
        col('net', 'Resultado do dia', 'money'),
        col('expectedIn', 'A receber (previsto)', 'money'),
        col('expectedOut', 'A pagar (previsto)', 'money'),
        col('balance', 'Saldo acumulado', 'money')
      ],
      rows,
      totals: { date: 'Total', ...t, net: t.sales + t.received - t.paid, balance },
      chart: { type: 'line', x: 'date', series: [{ key: 'balance', label: 'Saldo acumulado' }] },
      notes: [
        'Vendas recebidas: dinheiro (líquido de troco), PIX, cartões e outros, menos cancelamentos e reembolsos. Crediário entra quando a parcela é recebida; vale-troca não é entrada.',
        'Suprimentos e sangrias são transferências internas e não entram no fluxo.',
        `Previsão considera vencimentos de hoje em diante. Em atraso fora da previsão: a receber ${formatMoney(overdueReceivable)}, a pagar ${formatMoney(overdueOut._sum.amountCents ?? 0)}.`
      ]
    }
  }

  private async payables(q: Query): Promise<Built> {
    const today = startOfDay(this.now())
    const rows = await this.db.accountPayable.findMany({
      where: { status: { not: 'CANCELLED' }, dueDate: { gte: q.from, lte: q.to } },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS
    })
    const list = rows.map((p) => ({
      due: formatDate(p.dueDate),
      description: p.description,
      supplier: p.supplier?.name ?? '',
      category: p.category ?? '',
      status: p.status === 'PAID' ? 'Paga' : p.dueDate < today ? 'Atrasada' : 'Em aberto',
      amount: p.amountCents,
      paidAt: p.paidAt ? formatDate(p.paidAt) : '',
      paid: p.paidCents ?? 0,
      method: p.paymentMethod ? (PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod) : ''
    }))
    const byCategory = new Map<string, number>()
    for (const p of rows) byCategory.set(p.category ?? 'Sem categoria', (byCategory.get(p.category ?? 'Sem categoria') ?? 0) + p.amountCents)
    return {
      columns: [
        col('due', 'Vencimento'),
        col('description', 'Descrição'),
        col('supplier', 'Fornecedor'),
        col('category', 'Categoria'),
        col('status', 'Situação'),
        col('amount', 'Valor', 'money'),
        col('paidAt', 'Pago em'),
        col('paid', 'Valor pago', 'money'),
        col('method', 'Forma')
      ],
      rows: list,
      totals: {
        due: 'Total',
        description: `${list.length} conta(s)`,
        supplier: '',
        category: '',
        status: `${list.filter((r) => r.status === 'Atrasada').length} atrasada(s)`,
        amount: sumBy(rows, (r) => r.amountCents),
        paidAt: '',
        paid: sumBy(rows, (r) => r.paidCents ?? 0),
        method: ''
      },
      chart: null,
      notes: [
        'Contas com vencimento no período (canceladas excluídas).',
        `Por categoria: ${[...byCategory].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${formatMoney(v)}`).join(' · ') || '—'}`
      ]
    }
  }

  private async receivables(q: Query): Promise<Built> {
    const today = startOfDay(this.now())
    const rows = await this.db.accountReceivable.findMany({
      where: { status: { not: 'CANCELLED' }, dueDate: { gte: q.from, lte: q.to } },
      include: { customer: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS
    })
    const list = rows.map((r) => {
      const pending = r.status === 'OPEN' || r.status === 'PARTIAL'
      const late = pending && r.dueDate < today
      return {
        due: formatDate(r.dueDate),
        description: r.description,
        customer: r.customer?.name ?? '',
        status: r.status === 'PAID' ? 'Recebida' : late ? 'Atrasada' : r.status === 'PARTIAL' ? 'Parcial' : 'Em aberto',
        amount: r.amountCents,
        received: r.receivedCents,
        remaining: pending ? r.amountCents - r.receivedCents : 0,
        days: late ? Math.round((today.getTime() - startOfDay(r.dueDate).getTime()) / 86_400_000) : null
      }
    })
    return {
      columns: [
        col('due', 'Vencimento'),
        col('description', 'Descrição'),
        col('customer', 'Cliente'),
        col('status', 'Situação'),
        col('amount', 'Valor', 'money'),
        col('received', 'Recebido', 'money'),
        col('remaining', 'Em aberto', 'money'),
        col('days', 'Dias de atraso', 'int')
      ],
      rows: list,
      totals: {
        due: 'Total',
        description: `${list.length} conta(s)`,
        customer: '',
        status: `${list.filter((r) => r.status === 'Atrasada').length} atrasada(s)`,
        amount: sumBy(list, (r) => r.amount),
        received: sumBy(list, (r) => r.received),
        remaining: sumBy(list, (r) => r.remaining),
        days: null
      },
      chart: null,
      notes: ['Parcelas com vencimento no período (canceladas excluídas). "Recebido" considera descontos concedidos na quitação.']
    }
  }
}
