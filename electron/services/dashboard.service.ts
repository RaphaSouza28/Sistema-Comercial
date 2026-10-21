import type { DashboardSummary } from '@shared/api'
import type { Db } from '../database/connection'
import * as repo from '../repositories/dashboard.repository'
import { addDays, addMonths, dayKey, monthKey, startOfDay, startOfMonth, startOfWeek } from '../utils/dates'
import { requirePermission, type Actor } from './context'

const DAILY_WINDOW = 30
const MONTHLY_WINDOW = 12
const TOP_PRODUCTS = 8

/** Indicadores calculados exclusivamente a partir dos registros do banco. */
export class DashboardService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  async summary(actor: Actor | null): Promise<DashboardSummary> {
    requirePermission(actor, 'dashboard.view')
    const now = this.now()
    const today = startOfDay(now)
    const month = startOfMonth(now)
    const dailyFrom = addDays(today, -(DAILY_WINDOW - 1))
    const monthlyFrom = addMonths(month, -(MONTHLY_WINDOW - 1))
    const chartFrom = dailyFrom < monthlyFrom ? dailyFrom : monthlyFrom

    const [day, week, monthAgg, sales, returns, top, payments, productsCount, lowStockCount, pendingOrders, pendingQuotes, payables, receivables, cash] =
      await Promise.all([
        repo.sumCompletedSales(this.db, today),
        repo.sumCompletedSales(this.db, startOfWeek(now)),
        repo.sumCompletedSales(this.db, month),
        repo.completedSalesSince(this.db, chartFrom),
        repo.returnsSince(this.db, chartFrom),
        repo.topProductsSince(this.db, month, TOP_PRODUCTS),
        repo.paymentsByMethodSince(this.db, month),
        repo.countActiveProducts(this.db),
        repo.countLowStock(this.db),
        repo.countPendingOrders(this.db),
        repo.countPendingQuotes(this.db),
        repo.openPayables(this.db, today),
        repo.openReceivables(this.db, today),
        repo.openCashBalance(this.db)
      ])

    // Série diária (últimos 30 dias) e mensal (últimos 12 meses), com zeros nos períodos sem vendas.
    const daily = new Map<string, { totalCents: number; count: number }>()
    for (let i = 0; i < DAILY_WINDOW; i++) daily.set(dayKey(addDays(dailyFrom, i)), { totalCents: 0, count: 0 })
    const monthly = new Map<string, { totalCents: number; grossProfitCents: number }>()
    for (let i = 0; i < MONTHLY_WINDOW; i++) monthly.set(monthKey(addMonths(monthlyFrom, i)), { totalCents: 0, grossProfitCents: 0 })
    const operators = new Map<number, { totalCents: number; count: number }>()

    for (const s of sales) {
      const d = daily.get(dayKey(s.createdAt))
      if (d) {
        d.totalCents += s.totalCents
        d.count += 1
      }
      const m = monthly.get(monthKey(s.createdAt))
      if (m) {
        m.totalCents += s.totalCents
        m.grossProfitCents += s.totalCents - s.costTotalCents
      }
      if (s.createdAt >= month) {
        const o = operators.get(s.userId) ?? { totalCents: 0, count: 0 }
        o.totalCents += s.totalCents
        o.count += 1
        operators.set(s.userId, o)
      }
    }

    // Devoluções reduzem faturamento (valor reembolsado, inclusive em vale-troca) e custo
    // (itens voltam ao estoque). Sem isso, o vale-troca seria faturado duas vezes.
    const returned = (from: Date) =>
      returns.filter((r) => r.createdAt >= from).reduce((a, r) => ({ refund: a.refund + r.refundCents, cost: a.cost + r.costCents }), { refund: 0, cost: 0 })
    const rToday = returned(today)
    const rWeek = returned(startOfWeek(now))
    const rMonth = returned(month)
    const returnedQty = new Map<number, number>()
    for (const r of returns) {
      const d = daily.get(dayKey(r.createdAt))
      if (d) d.totalCents -= r.refundCents
      const m = monthly.get(monthKey(r.createdAt))
      if (m) {
        m.totalCents -= r.refundCents
        m.grossProfitCents -= r.refundCents - r.costCents
      }
      if (r.createdAt >= month) for (const i of r.items) returnedQty.set(i.productId, (returnedQty.get(i.productId) ?? 0) + i.quantityMilli)
    }

    const [lastBackup, lastAttempt] = await Promise.all([
      this.db.backupRecord.findFirst({ where: { status: { in: ['OK', 'REMOVED'] } }, orderBy: { id: 'desc' } }),
      this.db.backupRecord.findFirst({ where: { kind: { in: ['MANUAL', 'AUTOMATIC'] } }, orderBy: { id: 'desc' } })
    ])
    const [products, users] = await Promise.all([
      top.length ? repo.productNames(this.db, top.map((t) => t.productId)) : Promise.resolve([]),
      operators.size ? repo.userNames(this.db, [...operators.keys()]) : Promise.resolve([])
    ])
    const productName = new Map(products.map((p) => [p.id, p.name]))
    const userName = new Map(users.map((u) => [u.id, u.name]))

    return {
      generatedAt: now.toISOString(),
      revenue: {
        todayCents: day.totalCents - rToday.refund,
        weekCents: week.totalCents - rWeek.refund,
        monthCents: monthAgg.totalCents - rMonth.refund
      },
      month: {
        salesCount: monthAgg.count,
        averageTicketCents: monthAgg.count ? Math.round(monthAgg.totalCents / monthAgg.count) : 0,
        grossProfitCents: monthAgg.totalCents - rMonth.refund - (monthAgg.costCents - rMonth.cost)
      },
      productsCount,
      lowStockCount,
      pendingOrders,
      pendingQuotes,
      payables,
      receivables,
      cash,
      backup: {
        lastAt: lastBackup?.createdAt.toISOString() ?? null,
        lastFailed: !!lastAttempt && lastAttempt.status === 'FAILED'
      },
      charts: {
        daily: [...daily].map(([date, v]) => ({ date, ...v })),
        monthly: [...monthly].map(([m, v]) => ({ month: m, ...v })),
        topProducts: top.map((t) => ({
          productId: t.productId,
          name: productName.get(t.productId) ?? `Produto #${t.productId}`,
          quantityMilli: (t._sum.quantityMilli ?? 0) - (returnedQty.get(t.productId) ?? 0),
          totalCents: t._sum.totalCents ?? 0
        })),
        paymentMethods: payments
          .map((p) => ({ method: p.method, totalCents: p._sum.amountCents ?? 0, count: p._count._all }))
          .sort((a, b) => b.totalCents - a.totalCents),
        operators: [...operators]
          .map(([userId, v]) => ({ userId, name: userName.get(userId) ?? `Usuário #${userId}`, ...v }))
          .sort((a, b) => b.totalCents - a.totalCents)
      }
    }
  }
}
