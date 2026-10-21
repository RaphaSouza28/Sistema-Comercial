import type { Db } from '../database/connection'

/** Consultas de leitura usadas pelo dashboard. Apenas vendas concluídas contam como faturamento. */

export async function sumCompletedSales(db: Db, from: Date) {
  const agg = await db.sale.aggregate({
    where: { status: 'COMPLETED', createdAt: { gte: from } },
    _sum: { totalCents: true, costTotalCents: true },
    _count: { _all: true }
  })
  return {
    totalCents: agg._sum.totalCents ?? 0,
    costCents: agg._sum.costTotalCents ?? 0,
    count: agg._count._all
  }
}

export function completedSalesSince(db: Db, from: Date) {
  return db.sale.findMany({
    where: { status: 'COMPLETED', createdAt: { gte: from } },
    select: { createdAt: true, totalCents: true, costTotalCents: true, userId: true }
  })
}

/** Devoluções no período: valor reembolsado (dinheiro, estorno ou vale) e custo dos itens que voltaram ao estoque. */
export async function returnsSince(db: Db, from: Date) {
  const rows = await db.saleReturn.findMany({
    where: { createdAt: { gte: from }, sale: { status: 'COMPLETED' } },
    select: {
      createdAt: true,
      refundCents: true,
      items: { select: { quantityMilli: true, saleItem: { select: { unitCostCents: true, productId: true } } } }
    }
  })
  return rows.map((r) => ({
    createdAt: r.createdAt,
    refundCents: r.refundCents,
    costCents: r.items.reduce((a, i) => a + Math.round((i.saleItem.unitCostCents * i.quantityMilli) / 1000), 0),
    items: r.items.map((i) => ({ productId: i.saleItem.productId, quantityMilli: i.quantityMilli }))
  }))
}

export function topProductsSince(db: Db, from: Date, take: number) {
  return db.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { status: 'COMPLETED', createdAt: { gte: from } } },
    _sum: { quantityMilli: true, totalCents: true },
    orderBy: { _sum: { quantityMilli: 'desc' } },
    take
  })
}

export function productNames(db: Db, ids: number[]) {
  return db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
}

export function userNames(db: Db, ids: number[]) {
  return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
}

export function paymentsByMethodSince(db: Db, from: Date) {
  return db.payment.groupBy({
    by: ['method'],
    where: { status: { not: 'CANCELLED' }, sale: { status: 'COMPLETED', createdAt: { gte: from } } },
    _sum: { amountCents: true },
    _count: { _all: true }
  })
}

export function countActiveProducts(db: Db): Promise<number> {
  return db.product.count({ where: { active: true, deletedAt: null, isService: false } })
}

export async function countLowStock(db: Db): Promise<number> {
  const [products, variants] = await Promise.all([
    db.product.count({
      where: {
        active: true,
        deletedAt: null,
        hasVariants: false,
        isService: false,
        OR: [{ stockMilli: { lte: 0 } }, { minStockMilli: { gt: 0 }, stockMilli: { lte: db.product.fields.minStockMilli } }]
      }
    }),
    db.productVariant.count({
      where: {
        active: true,
        deletedAt: null,
        product: { active: true, deletedAt: null, hasVariants: true },
        OR: [{ stockMilli: { lte: 0 } }, { minStockMilli: { gt: 0 }, stockMilli: { lte: db.productVariant.fields.minStockMilli } }]
      }
    })
  ])
  return products + variants
}

export function countPendingOrders(db: Db): Promise<number> {
  return db.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PICKING', 'READY'] } } })
}

export function countPendingQuotes(db: Db): Promise<number> {
  return db.quote.count({ where: { status: { in: ['DRAFT', 'SENT'] } } })
}

export async function openPayables(db: Db, today: Date) {
  const [agg, overdue] = await Promise.all([
    db.accountPayable.aggregate({ where: { status: 'OPEN' }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.accountPayable.count({ where: { status: 'OPEN', dueDate: { lt: today } } })
  ])
  return { openCount: agg._count._all, openCents: agg._sum.amountCents ?? 0, overdueCount: overdue }
}

export async function openReceivables(db: Db, today: Date) {
  const where = { status: { in: ['OPEN', 'PARTIAL'] as ('OPEN' | 'PARTIAL')[] } }
  const [agg, overdue] = await Promise.all([
    db.accountReceivable.aggregate({ where, _sum: { amountCents: true, receivedCents: true }, _count: { _all: true } }),
    db.accountReceivable.count({ where: { ...where, dueDate: { lt: today } } })
  ])
  return {
    openCount: agg._count._all,
    openCents: (agg._sum.amountCents ?? 0) - (agg._sum.receivedCents ?? 0),
    overdueCount: overdue
  }
}

/** Saldo em dinheiro das sessões de caixa abertas: valor de abertura + movimentações em dinheiro. */
export async function openCashBalance(db: Db) {
  const sessions = await db.cashSession.findMany({ where: { status: 'OPEN' }, select: { id: true, openingCents: true } })
  if (sessions.length === 0) return { openSessions: 0, balanceCents: 0 }
  const movements = await db.cashMovement.aggregate({
    where: { cashSessionId: { in: sessions.map((s) => s.id) }, method: 'CASH' },
    _sum: { amountCents: true }
  })
  const opening = sessions.reduce((acc, s) => acc + s.openingCents, 0)
  return { openSessions: sessions.length, balanceCents: opening + (movements._sum.amountCents ?? 0) }
}
