import type {
  CashDailyReport,
  CashHistoryResult,
  CashMethodSummary,
  CashMovementDto,
  CashSessionDetail,
  CashSessionDto,
  CashSessionListItem,
  CashSummary
} from '@shared/api'
import { CASH_METHODS, cashCloseSchema, cashDailySchema, cashHistorySchema, cashMovementSchema, cashSessionIdSchema } from '@shared/cashSchemas'
import { formatMoney } from '@shared/format'
import { cashOpenSchema } from '@shared/salesSchemas'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, forbidden, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { fromDateKey, parseJson } from './product.mappers'

/** Sessão aberta do usuário (cada operador tem no máximo uma). */
export function findOpenSession(db: DbClient, userId: number) {
  return db.cashSession.findFirst({ where: { userId, status: 'OPEN' }, include: { user: { select: { name: true } } } })
}

export async function requireOpenSession(db: DbClient, userId: number) {
  const session = await findOpenSession(db, userId)
  if (!session) throw conflict('Abra o caixa antes de registrar vendas ou movimentações.')
  return session
}

/** Dinheiro na gaveta: abertura + todas as movimentações em dinheiro (vendas líquidas de troco, sangrias...). */
export async function drawerBalance(db: DbClient, session: { id: number; openingCents: number }): Promise<number> {
  const cash = await db.cashMovement.aggregate({ where: { cashSessionId: session.id, method: 'CASH' }, _sum: { amountCents: true } })
  return session.openingCents + (cash._sum.amountCents ?? 0)
}

export async function toCashSessionDto(db: DbClient, s: NonNullable<Awaited<ReturnType<typeof findOpenSession>>>): Promise<CashSessionDto> {
  const sales = await db.sale.aggregate({ where: { cashSessionId: s.id, status: 'COMPLETED' }, _sum: { totalCents: true }, _count: { _all: true } })
  return {
    id: s.id,
    status: s.status,
    userId: s.userId,
    userName: s.user.name,
    openingCents: s.openingCents,
    openedAt: s.openedAt.toISOString(),
    cashBalanceCents: await drawerBalance(db, s),
    salesCount: sales._count._all,
    salesTotalCents: sales._sum.totalCents ?? 0
  }
}

const listInclude = { user: { select: { name: true } }, closedBy: { select: { name: true } } } as const satisfies Prisma.CashSessionInclude
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof listInclude }>

const TYPE_FIELD: Record<string, keyof Omit<CashMethodSummary, 'method' | 'openingCents' | 'expectedCents' | 'countedCents' | 'differenceCents'>> = {
  SALE: 'salesCents',
  SALE_CANCEL: 'cancelsCents',
  RETURN_REFUND: 'refundsCents',
  SUPPLY: 'suppliesCents',
  WITHDRAWAL: 'withdrawalsCents',
  OTHER_IN: 'otherInCents',
  OTHER_OUT: 'otherOutCents',
  RECEIVABLE: 'otherInCents',
  PAYABLE: 'otherOutCents'
}

/**
 * Caixa: abertura, suprimentos, sangrias, outras entradas/saídas, conferência e fechamento.
 * Cada operador movimenta e fecha o próprio caixa; fechar o de outro exige cash.manage.
 */
export class CashService {
  constructor(private readonly db: Db) {}

  async current(actorInput: Actor | null): Promise<CashSessionDto | null> {
    const actor = requirePermission(actorInput, 'cash.operate', 'cash.manage', 'pdv.sell')
    const s = await findOpenSession(this.db, actor.userId)
    return s ? toCashSessionDto(this.db, s) : null
  }

  /** Abrir o caixa é idempotente: se já houver sessão aberta do usuário, ela é devolvida. */
  async open(actorInput: Actor | null, input: unknown): Promise<CashSessionDto> {
    const actor = requirePermission(actorInput, 'cash.operate')
    const data = cashOpenSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const existing = await findOpenSession(tx, actor.userId)
      if (existing) return toCashSessionDto(tx, existing)
      const created = await tx.cashSession.create({ data: { userId: actor.userId, openingCents: data.openingCents } })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'cash.open',
        entity: 'CashSession',
        entityId: created.id,
        details: { openingCents: data.openingCents, requestId: data.requestId }
      })
      return toCashSessionDto(tx, (await findOpenSession(tx, actor.userId))!)
    })
  }

  /** Suprimento, sangria e outras entradas/saídas no caixa aberto do próprio usuário. */
  async addMovement(actorInput: Actor | null, input: unknown): Promise<CashMovementDto> {
    const actor = requirePermission(actorInput, 'cash.operate')
    const data = cashMovementSchema.parse(input)
    const key = `CASH:${data.requestId}`
    const id = await this.db.$transaction(async (tx) => {
      const existing = await tx.cashMovement.findUnique({ where: { idempotencyKey: key } })
      if (existing) return existing.id
      const session = await requireOpenSession(tx, actor.userId)
      if ((data.type === 'SUPPLY' || data.type === 'WITHDRAWAL') && data.method !== 'CASH') {
        throw validationError('Suprimento e sangria são sempre em dinheiro.')
      }
      const outgoing = data.type === 'WITHDRAWAL' || data.type === 'OTHER_OUT'
      if (outgoing && data.method === 'CASH') {
        const balance = await drawerBalance(tx, session)
        if (data.amountCents > balance) {
          throw conflict(`Valor maior que o dinheiro na gaveta (${formatMoney(balance)}).`)
        }
      }
      const m = await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,
          type: data.type,
          method: data.method,
          amountCents: outgoing ? -data.amountCents : data.amountCents,
          description: data.description,
          referenceType: 'MANUAL',
          idempotencyKey: key,
          userId: actor.userId
        }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: `cash.${data.type.toLowerCase()}`,
        entity: 'CashSession',
        entityId: session.id,
        details: { amountCents: data.amountCents, method: data.method, description: data.description }
      })
      return m.id
    })
    const m = await this.db.cashMovement.findUniqueOrThrow({ where: { id }, include: { user: { select: { name: true } } } })
    return this.toMovementDto(m)
  }

  // ───────────── Resumo e fechamento ─────────────

  private canSee(actor: Actor, session: { userId: number }): boolean {
    return session.userId === actor.userId || actor.permissions.has('cash.manage') || actor.permissions.has('reports.view')
  }

  async summary(actorInput: Actor | null, input: unknown): Promise<CashSummary> {
    const actor = requirePermission(actorInput, 'cash.operate', 'cash.manage', 'reports.view')
    const { sessionId } = cashSessionIdSchema.parse(input)
    const session = await this.db.cashSession.findUnique({ where: { id: sessionId } })
    if (!session) throw notFound('Caixa não encontrado.')
    if (!this.canSee(actor, session)) throw forbidden('Você só pode consultar o seu caixa.')
    return this.computeSummary(this.db, session)
  }

  private async computeSummary(db: DbClient, session: { id: number; openingCents: number; closingSummary: string | null; status: string }): Promise<CashSummary> {
    // Caixa fechado: usa o resumo congelado no fechamento (o histórico não muda depois)
    if (session.status === 'CLOSED' && session.closingSummary) return parseJson<CashSummary>(session.closingSummary, null as never)

    const groups = await db.cashMovement.groupBy({ by: ['method', 'type'], where: { cashSessionId: session.id }, _sum: { amountCents: true } })
    const byMethod: CashMethodSummary[] = CASH_METHODS.map((method) => {
      const row: CashMethodSummary = {
        method,
        openingCents: method === 'CASH' ? session.openingCents : 0,
        salesCents: 0,
        cancelsCents: 0,
        refundsCents: 0,
        suppliesCents: 0,
        withdrawalsCents: 0,
        otherInCents: 0,
        otherOutCents: 0,
        expectedCents: 0,
        countedCents: null,
        differenceCents: null
      }
      for (const g of groups.filter((x) => x.method === method)) {
        const field = TYPE_FIELD[g.type]
        if (field) row[field] += g._sum.amountCents ?? 0
      }
      row.expectedCents =
        row.openingCents + row.salesCents + row.cancelsCents + row.refundsCents + row.suppliesCents + row.withdrawalsCents + row.otherInCents + row.otherOutCents
      return row
    })
    const [sales, cancelled, returns] = await Promise.all([
      db.sale.aggregate({ where: { cashSessionId: session.id, status: 'COMPLETED' }, _sum: { totalCents: true }, _count: { _all: true } }),
      db.sale.count({ where: { cashSessionId: session.id, status: 'CANCELLED' } }),
      db.saleReturn.count({ where: { cashSessionId: session.id } })
    ])
    return {
      sessionId: session.id,
      byMethod,
      expectedCashCents: byMethod.find((m) => m.method === 'CASH')!.expectedCents,
      salesCount: sales._count._all,
      salesTotalCents: sales._sum.totalCents ?? 0,
      cancelledCount: cancelled,
      returnsCount: returns
    }
  }

  async close(actorInput: Actor | null, input: unknown): Promise<CashSessionDetail> {
    const actor = requirePermission(actorInput, 'cash.operate', 'cash.manage')
    const data = cashCloseSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const session = await tx.cashSession.findUnique({ where: { id: data.sessionId } })
      if (!session) throw notFound('Caixa não encontrado.')
      if (session.status !== 'OPEN') throw conflict('Este caixa já foi fechado.')
      if (session.userId !== actor.userId && !actor.permissions.has('cash.manage')) {
        throw forbidden('Você não pode fechar o caixa de outro operador.')
      }
      const summary = await this.computeSummary(tx, session)
      for (const m of summary.byMethod) {
        const counted = m.method === 'CASH' ? data.countedCashCents : data.countedByMethod[m.method]
        if (counted !== undefined) {
          m.countedCents = counted
          m.differenceCents = counted - m.expectedCents
        }
      }
      const hasDifference = summary.byMethod.some((m) => m.differenceCents !== null && m.differenceCents !== 0)
      if (hasDifference && !data.notes) {
        throw validationError('Há diferença entre o esperado e o contado. Justifique nas observações.', { notes: 'Justifique a diferença' })
      }
      const cash = summary.byMethod.find((m) => m.method === 'CASH')!
      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: actor.userId,
          expectedCents: cash.expectedCents,
          countedCents: data.countedCashCents,
          differenceCents: cash.differenceCents,
          notes: data.notes,
          closingSummary: JSON.stringify(summary)
        }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'cash.close',
        entity: 'CashSession',
        entityId: session.id,
        details: {
          operatorId: session.userId,
          expectedCents: cash.expectedCents,
          countedCents: data.countedCashCents,
          differenceCents: cash.differenceCents,
          byOther: session.userId !== actor.userId
        }
      })
    })
    return this.get(actor, { sessionId: data.sessionId })
  }

  // ───────────── Consultas ─────────────

  private toListItem(s: SessionRow, salesTotalCents: number): CashSessionListItem {
    return {
      id: s.id,
      userId: s.userId,
      userName: s.user.name,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      closedByName: s.closedBy?.name ?? null,
      openingCents: s.openingCents,
      salesTotalCents,
      expectedCents: s.expectedCents,
      countedCents: s.countedCents,
      differenceCents: s.differenceCents
    }
  }

  private toMovementDto(m: Prisma.CashMovementGetPayload<{ include: { user: { select: { name: true } } } }>): CashMovementDto {
    return {
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      type: m.type,
      method: m.method,
      amountCents: m.amountCents,
      description: m.description,
      userName: m.user.name,
      referenceType: m.referenceType,
      referenceId: m.referenceId
    }
  }

  private async salesTotals(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map()
    const rows = await this.db.sale.groupBy({ by: ['cashSessionId'], where: { cashSessionId: { in: ids }, status: 'COMPLETED' }, _sum: { totalCents: true } })
    return new Map(rows.map((r) => [r.cashSessionId!, r._sum.totalCents ?? 0]))
  }

  async get(actorInput: Actor | null, input: unknown): Promise<CashSessionDetail> {
    const actor = requirePermission(actorInput, 'cash.operate', 'cash.manage', 'reports.view')
    const { sessionId } = cashSessionIdSchema.parse(input)
    const s = await this.db.cashSession.findUnique({ where: { id: sessionId }, include: listInclude })
    if (!s) throw notFound('Caixa não encontrado.')
    if (!this.canSee(actor, s)) throw forbidden('Você só pode consultar o seu caixa.')
    const [summary, movements, totals] = await Promise.all([
      this.computeSummary(this.db, s),
      this.db.cashMovement.findMany({ where: { cashSessionId: s.id }, include: { user: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      this.salesTotals([s.id])
    ])
    return { ...this.toListItem(s, totals.get(s.id) ?? 0), notes: s.notes, summary, movements: movements.map((m) => this.toMovementDto(m)) }
  }

  async history(actorInput: Actor | null, input: unknown): Promise<CashHistoryResult> {
    const actor = requirePermission(actorInput, 'cash.operate', 'cash.manage', 'reports.view')
    const q = cashHistorySchema.parse(input ?? {})
    const and: Prisma.CashSessionWhereInput[] = []
    const seeAll = actor.permissions.has('cash.manage') || actor.permissions.has('reports.view')
    if (!seeAll) and.push({ userId: actor.userId })
    else if (q.userId) and.push({ userId: q.userId })
    if (q.status) and.push({ status: q.status })
    if (q.from) and.push({ openedAt: { gte: fromDateKey(q.from)! } })
    if (q.to) and.push({ openedAt: { lte: fromDateKey(q.to, true)! } })
    const where = { AND: and }
    const [total, rows] = await Promise.all([
      this.db.cashSession.count({ where }),
      this.db.cashSession.findMany({ where, include: listInclude, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    const totals = await this.salesTotals(rows.map((r) => r.id))
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => this.toListItem(r, totals.get(r.id) ?? 0)) }
  }

  /** Relatório do dia: caixas abertos na data e movimentação de todos os caixas no dia. */
  async daily(actorInput: Actor | null, input: unknown): Promise<CashDailyReport> {
    requirePermission(actorInput, 'cash.manage', 'reports.view')
    const { date } = cashDailySchema.parse(input)
    const from = fromDateKey(date)!
    const to = fromDateKey(date, true)!
    const inDay = { gte: from, lte: to }
    const [sessions, methods, types, sales, cancelled] = await Promise.all([
      this.db.cashSession.findMany({ where: { openedAt: inDay }, include: listInclude, orderBy: { id: 'asc' } }),
      this.db.cashMovement.groupBy({ by: ['method'], where: { createdAt: inDay }, _sum: { amountCents: true } }),
      this.db.cashMovement.groupBy({ by: ['type'], where: { createdAt: inDay }, _sum: { amountCents: true } }),
      this.db.sale.aggregate({ where: { createdAt: inDay, status: 'COMPLETED' }, _sum: { totalCents: true }, _count: { _all: true } }),
      this.db.sale.aggregate({ where: { cancelledAt: inDay, status: 'CANCELLED' }, _sum: { totalCents: true }, _count: { _all: true } })
    ])
    const totals = await this.salesTotals(sessions.map((s) => s.id))
    const sumType = (t: string) => types.find((x) => x.type === t)?._sum.amountCents ?? 0
    const closedToday = await this.db.cashSession.aggregate({ where: { closedAt: inDay }, _sum: { differenceCents: true } })
    return {
      date,
      sessions: sessions.map((s) => this.toListItem(s, totals.get(s.id) ?? 0)),
      byMethod: methods.map((m) => ({ method: m.method, netCents: m._sum.amountCents ?? 0 })).sort((a, b) => b.netCents - a.netCents),
      salesCount: sales._count._all,
      salesTotalCents: sales._sum.totalCents ?? 0,
      cancelledCount: cancelled._count._all,
      cancelledTotalCents: cancelled._sum.totalCents ?? 0,
      refundsCents: -sumType('RETURN_REFUND'),
      suppliesCents: sumType('SUPPLY'),
      withdrawalsCents: -sumType('WITHDRAWAL'),
      differenceTotalCents: closedToday._sum.differenceCents ?? 0
    }
  }
}
