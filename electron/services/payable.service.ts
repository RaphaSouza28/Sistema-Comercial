import type { DueSummary, PayableDto, PayableListResult } from '@shared/api'
import { idSchema } from '@shared/catalogSchemas'
import { formatMoney } from '@shared/format'
import {
  payableCancelSchema,
  payableListSchema,
  payablePaySchema,
  payableReverseSchema,
  payableSchema,
  payableUpdateSchema
} from '@shared/financeSchemas'
import { normalizeSearch, searchTextOf } from '@shared/text'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import { drawerBalance, requireOpenSession } from './cash.service'
import { requirePermission, type Actor } from './context'
import { daysOverdue, dueWindows, nextOccurrence, settlementDate } from './finance'
import { fromDateKey } from './product.mappers'

const include = {
  supplier: { select: { name: true } },
  createdBy: { select: { name: true } },
  paidBy: { select: { name: true } },
  recurrenceNext: { select: { id: true } }
} as const satisfies Prisma.AccountPayableInclude
type PayableRow = Prisma.AccountPayableGetPayload<{ include: typeof include }>

function toDto(p: PayableRow, now: Date): PayableDto {
  const { today } = dueWindows(now)
  const overdue = p.status === 'OPEN' && p.dueDate < today
  return {
    id: p.id,
    description: p.description,
    supplierId: p.supplierId,
    supplierName: p.supplier?.name ?? null,
    category: p.category,
    documentNumber: p.documentNumber,
    amountCents: p.amountCents,
    dueDate: p.dueDate.toISOString(),
    status: overdue ? 'OVERDUE' : p.status,
    daysOverdue: overdue ? daysOverdue(p.dueDate, now) : 0,
    paidAt: p.paidAt?.toISOString() ?? null,
    paidCents: p.paidCents,
    paymentMethod: p.paymentMethod,
    paidFromCash: p.paidFromCash,
    paidByName: p.paidBy?.name ?? null,
    receiptName: p.receiptName,
    recurrence: p.recurrence,
    recurrenceSourceId: p.recurrenceSourceId,
    recurrenceNextId: p.recurrenceNext?.id ?? null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    createdByName: p.createdBy?.name ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancelReason: p.cancelReason
  }
}

/**
 * Contas a pagar: despesas com vencimento, pagamento (opcionalmente com dinheiro da gaveta),
 * estorno, recorrência e comprovante anexado. Nenhum pagamento bancário é feito pelo sistema:
 * o registro indica que o usuário pagou por fora.
 */
export class PayableService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async searchText(db: DbClient, d: { description: string; supplierId: number | null; category: string | null; documentNumber: string | null }) {
    const supplier = d.supplierId ? await db.supplier.findFirst({ where: { id: d.supplierId, deletedAt: null } }) : null
    if (d.supplierId && !supplier) throw validationError('Fornecedor inválido.', { supplierId: 'Fornecedor inválido' })
    return searchTextOf(d.description, supplier?.name, d.category, d.documentNumber)
  }

  private async dto(db: DbClient, id: number): Promise<PayableDto> {
    const p = await db.accountPayable.findUnique({ where: { id }, include })
    if (!p) throw notFound('Conta não encontrada.')
    return toDto(p, this.now())
  }

  async list(actorInput: Actor | null, input: unknown): Promise<PayableListResult> {
    requirePermission(actorInput, 'finance.payables')
    const q = payableListSchema.parse(input ?? {})
    const { today } = dueWindows(this.now())
    const and: Prisma.AccountPayableWhereInput[] = []
    if (q.status === 'PENDING') and.push({ status: 'OPEN' })
    else if (q.status === 'OPEN') and.push({ status: 'OPEN', dueDate: { gte: today } })
    else if (q.status === 'OVERDUE') and.push({ status: 'OPEN', dueDate: { lt: today } })
    else if (q.status) and.push({ status: q.status })
    // Contas pagas são filtradas pela data de pagamento; as demais pelo vencimento
    const dateField = q.status === 'PAID' ? 'paidAt' : 'dueDate'
    if (q.from) and.push({ [dateField]: { gte: fromDateKey(q.from)! } })
    if (q.to) and.push({ [dateField]: { lte: fromDateKey(q.to, true)! } })
    if (q.supplierId) and.push({ supplierId: q.supplierId })
    if (q.category) and.push({ category: q.category })
    for (const t of normalizeSearch(q.search).split(' ').filter(Boolean)) and.push({ searchText: { contains: t } })
    const where = { AND: and }
    const orderBy: Prisma.AccountPayableOrderByWithRelationInput[] =
      q.status === 'PAID' ? [{ paidAt: 'desc' }, { id: 'desc' }] : q.status === 'CANCELLED' ? [{ id: 'desc' }] : [{ dueDate: 'asc' }, { id: 'asc' }]
    const [total, sums, rows] = await Promise.all([
      this.db.accountPayable.count({ where }),
      this.db.accountPayable.aggregate({ where, _sum: { amountCents: true, paidCents: true } }),
      this.db.accountPayable.findMany({ where, include, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    const now = this.now()
    return {
      items: rows.map((r) => toDto(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      amountCents: sums._sum.amountCents ?? 0,
      paidCents: sums._sum.paidCents ?? 0
    }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    requirePermission(actorInput, 'finance.payables')
    return this.dto(this.db, idSchema.parse(input).id)
  }

  async create(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const data = payableSchema.parse(input)
    const id = await this.db.$transaction(async (tx) => {
      const p = await tx.accountPayable.create({
        data: {
          description: data.description,
          supplierId: data.supplierId,
          category: data.category,
          documentNumber: data.documentNumber,
          amountCents: data.amountCents,
          dueDate: fromDateKey(data.dueDate)!,
          recurrence: data.recurrence,
          notes: data.notes,
          searchText: await this.searchText(tx, data),
          createdById: actor.userId
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'payable.create', entity: 'AccountPayable', entityId: p.id, details: { amountCents: p.amountCents, dueDate: data.dueDate } })
      return p.id
    })
    return this.dto(this.db, id)
  }

  async update(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const data = payableUpdateSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const current = await tx.accountPayable.findUnique({ where: { id: data.id } })
      if (!current) throw notFound('Conta não encontrada.')
      if (current.status !== 'OPEN') throw conflict('Só é possível alterar contas em aberto.')
      await tx.accountPayable.update({
        where: { id: data.id },
        data: {
          description: data.description,
          supplierId: data.supplierId,
          category: data.category,
          documentNumber: data.documentNumber,
          amountCents: data.amountCents,
          dueDate: fromDateKey(data.dueDate)!,
          recurrence: data.recurrence,
          notes: data.notes,
          searchText: await this.searchText(tx, data)
        }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'payable.update',
        entity: 'AccountPayable',
        entityId: data.id,
        details: { from: { amountCents: current.amountCents, dueDate: current.dueDate.toISOString() }, to: { amountCents: data.amountCents, dueDate: data.dueDate } }
      })
    })
    return this.dto(this.db, data.id)
  }

  /** Registra o pagamento. Reenviar o mesmo requestId não paga duas vezes. Contas recorrentes geram a próxima. */
  async pay(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const data = payablePaySchema.parse(input)
    const now = this.now()
    const paidAt = settlementDate(data.paidAt, now)
    if (data.fromCash && data.method !== 'CASH') throw validationError('Somente pagamentos em dinheiro saem da gaveta do caixa.')

    await this.db.$transaction(async (tx) => {
      const already = await tx.accountPayable.findUnique({ where: { paymentKey: data.requestId } })
      if (already) return
      const p = await tx.accountPayable.findUnique({ where: { id: data.id } })
      if (!p) throw notFound('Conta não encontrada.')
      if (p.status === 'PAID') throw conflict('Esta conta já foi paga.')
      if (p.status === 'CANCELLED') throw conflict('Esta conta foi cancelada.')

      if (data.fromCash) {
        const session = await requireOpenSession(tx, actor.userId)
        const balance = await drawerBalance(tx, session)
        if (data.paidCents > balance) throw conflict(`Dinheiro insuficiente na gaveta (${formatMoney(balance)}).`)
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'PAYABLE',
            method: 'CASH',
            amountCents: -data.paidCents,
            description: `Pagamento: ${p.description}`,
            referenceType: 'PAYABLE',
            referenceId: String(p.id),
            idempotencyKey: `PAYABLE:${data.requestId}`,
            userId: actor.userId
          }
        })
      }
      await tx.accountPayable.update({
        where: { id: p.id },
        data: { status: 'PAID', paidAt, paidCents: data.paidCents, paymentMethod: data.method, paidFromCash: data.fromCash, paymentKey: data.requestId, paidById: actor.userId }
      })

      // Recorrência: a próxima ocorrência é criada uma única vez (recurrenceSourceId é único)
      const nextDue = nextOccurrence(p.dueDate, p.recurrence)
      if (nextDue && !(await tx.accountPayable.findUnique({ where: { recurrenceSourceId: p.id } }))) {
        await tx.accountPayable.create({
          data: {
            description: p.description,
            supplierId: p.supplierId,
            category: p.category,
            amountCents: p.amountCents,
            dueDate: nextDue,
            recurrence: p.recurrence,
            recurrenceSourceId: p.id,
            notes: p.notes,
            searchText: p.searchText,
            createdById: actor.userId
          }
        })
      }
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'payable.pay',
        entity: 'AccountPayable',
        entityId: p.id,
        details: { amountCents: p.amountCents, paidCents: data.paidCents, method: data.method, fromCash: data.fromCash, paidAt: paidAt.toISOString() }
      })
    })
    return this.dto(this.db, data.id)
  }

  /** Desfaz um pagamento registrado por engano; se saiu da gaveta, o dinheiro volta ao caixa aberto. */
  async reverse(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const { id, reason } = payableReverseSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const p = await tx.accountPayable.findUnique({ where: { id } })
      if (!p) throw notFound('Conta não encontrada.')
      if (p.status !== 'PAID') throw conflict('Esta conta não está paga.')
      if (p.paidFromCash) {
        const session = await requireOpenSession(tx, actor.userId)
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'PAYABLE',
            method: 'CASH',
            amountCents: p.paidCents ?? 0,
            description: `Estorno do pagamento: ${p.description}`,
            referenceType: 'PAYABLE',
            referenceId: String(p.id),
            idempotencyKey: `PAYABLE_REVERSE:${p.paymentKey}`,
            userId: actor.userId
          }
        })
      }
      await tx.accountPayable.update({
        where: { id },
        data: { status: 'OPEN', paidAt: null, paidCents: null, paymentMethod: null, paidFromCash: false, paymentKey: null, paidById: null }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'payable.reverse',
        entity: 'AccountPayable',
        entityId: id,
        details: { reason, paidCents: p.paidCents, paidAt: p.paidAt?.toISOString(), fromCash: p.paidFromCash }
      })
    })
    return this.dto(this.db, id)
  }

  async cancel(actorInput: Actor | null, input: unknown): Promise<PayableDto> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const { id, reason } = payableCancelSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const p = await tx.accountPayable.findUnique({ where: { id } })
      if (!p) throw notFound('Conta não encontrada.')
      if (p.status !== 'OPEN') throw conflict(p.status === 'PAID' ? 'Conta paga: estorne o pagamento antes de cancelar.' : 'Esta conta já foi cancelada.')
      await tx.accountPayable.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: this.now(), cancelReason: reason } })
      await writeAudit(tx, { userId: actor.userId, action: 'payable.cancel', entity: 'AccountPayable', entityId: id, details: { reason } })
    })
    return this.dto(this.db, id)
  }

  /** Alertas de vencimento (em aberto) e total pago no mês. */
  async summary(actorInput: Actor | null): Promise<DueSummary> {
    requirePermission(actorInput, 'finance.payables')
    const w = dueWindows(this.now())
    const open = { status: 'OPEN' as const }
    const sum = (where: Prisma.AccountPayableWhereInput) => this.db.accountPayable.aggregate({ where, _sum: { amountCents: true }, _count: { _all: true } })
    const [overdue, today, next7, all, paid] = await Promise.all([
      sum({ ...open, dueDate: { lt: w.today } }),
      sum({ ...open, dueDate: { gte: w.today, lt: w.tomorrow } }),
      sum({ ...open, dueDate: { gte: w.today, lt: w.in8Days } }),
      sum(open),
      this.db.accountPayable.aggregate({ where: { status: 'PAID', paidAt: { gte: w.monthStart } }, _sum: { paidCents: true } })
    ])
    return {
      overdueCount: overdue._count._all,
      overdueCents: overdue._sum.amountCents ?? 0,
      dueTodayCount: today._count._all,
      dueTodayCents: today._sum.amountCents ?? 0,
      next7Count: next7._count._all,
      next7Cents: next7._sum.amountCents ?? 0,
      openCents: all._sum.amountCents ?? 0,
      settledMonthCents: paid._sum.paidCents ?? 0
    }
  }

  /** Categorias já usadas (sugestões no formulário). */
  async categories(actorInput: Actor | null): Promise<string[]> {
    requirePermission(actorInput, 'finance.payables')
    const rows = await this.db.accountPayable.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } })
    return rows.map((r) => r.category!)
  }

  // ───────────── Comprovante (o arquivo é copiado pelo processo principal) ─────────────

  /** Grava o comprovante e devolve o caminho anterior (para o processo principal apagar). */
  async setReceipt(actorInput: Actor | null, input: unknown, file: { path: string; name: string } | null): Promise<{ dto: PayableDto; previous: string | null }> {
    const actor = requirePermission(actorInput, 'finance.payables')
    const { id } = idSchema.parse(input)
    const p = await this.db.accountPayable.findUnique({ where: { id } })
    if (!p) throw notFound('Conta não encontrada.')
    await this.db.accountPayable.update({ where: { id }, data: { receiptPath: file?.path ?? null, receiptName: file?.name ?? null } })
    await writeAudit(this.db, { userId: actor.userId, action: file ? 'payable.receipt' : 'payable.receipt-remove', entity: 'AccountPayable', entityId: id, details: { name: file?.name ?? p.receiptName } })
    return { dto: await this.dto(this.db, id), previous: p.receiptPath }
  }

  async receiptFile(actorInput: Actor | null, input: unknown): Promise<string> {
    requirePermission(actorInput, 'finance.payables')
    const { id } = idSchema.parse(input)
    const p = await this.db.accountPayable.findUnique({ where: { id } })
    if (!p?.receiptPath) throw notFound('Esta conta não tem comprovante anexado.')
    return p.receiptPath
  }
}
