import type { DueSummary, ReceivableDetail, ReceivableDto, ReceivableListResult } from '@shared/api'
import { idSchema } from '@shared/catalogSchemas'
import { formatMoney } from '@shared/format'
import {
  receivableCancelSchema,
  receivableListSchema,
  receivableReceiveSchema,
  receivableReverseSchema,
  receivableSchema,
  receivableUpdateSchema
} from '@shared/financeSchemas'
import { normalizeSearch } from '@shared/text'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import { drawerBalance, findOpenSession, requireOpenSession } from './cash.service'
import { requirePermission, type Actor } from './context'
import { addMonthsClamped, daysOverdue, dueWindows, settlementDate, splitInstallments } from './finance'
import { fromDateKey } from './product.mappers'

const include = {
  customer: { select: { name: true } },
  createdBy: { select: { name: true } },
  sale: { select: { _count: { select: { receivables: true } } } }
} as const satisfies Prisma.AccountReceivableInclude
type ReceivableRow = Prisma.AccountReceivableGetPayload<{ include: typeof include }>

const detailInclude = {
  ...include,
  payments: { include: { user: { select: { name: true } }, reversedBy: { select: { name: true } } }, orderBy: { id: 'asc' } }
} as const satisfies Prisma.AccountReceivableInclude
type DetailRow = Prisma.AccountReceivableGetPayload<{ include: typeof detailInclude }>

const PENDING = ['OPEN', 'PARTIAL'] as const

function toDto(r: ReceivableRow, now: Date): ReceivableDto {
  const { today } = dueWindows(now)
  const pending = r.status === 'OPEN' || r.status === 'PARTIAL'
  const overdue = pending && r.dueDate < today
  return {
    id: r.id,
    description: r.description,
    customerId: r.customerId,
    customerName: r.customer?.name ?? null,
    saleId: r.saleId,
    installmentNumber: r.installmentNumber,
    installmentCount: r.sale?._count.receivables ?? 1,
    amountCents: r.amountCents,
    receivedCents: r.receivedCents,
    remainingCents: pending ? r.amountCents - r.receivedCents : 0,
    dueDate: r.dueDate.toISOString(),
    status: overdue ? 'OVERDUE' : r.status,
    daysOverdue: overdue ? daysOverdue(r.dueDate, now) : 0,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason
  }
}

function toDetail(r: DetailRow, now: Date): ReceivableDetail {
  return {
    ...toDto(r, now),
    createdByName: r.createdBy?.name ?? null,
    payments: r.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      interestCents: p.interestCents,
      discountCents: p.discountCents,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      userName: p.user.name,
      cashSessionId: p.cashSessionId,
      reversedAt: p.reversedAt?.toISOString() ?? null,
      reversedByName: p.reversedBy?.name ?? null,
      reverseReason: p.reverseReason
    }))
  }
}

/** Parcelas do crediário de uma venda (chamado dentro da transação da venda). */
export async function createSaleInstallments(
  tx: DbClient,
  sale: { id: number; customerId: number; userId: number },
  totalCents: number,
  count: number,
  firstDue: Date
): Promise<void> {
  const parts = splitInstallments(totalCents, count)
  for (const [i, amountCents] of parts.entries()) {
    await tx.accountReceivable.create({
      data: {
        description: count > 1 ? `Venda #${sale.id} — parcela ${i + 1}/${count}` : `Venda #${sale.id} — crediário`,
        customerId: sale.customerId,
        saleId: sale.id,
        installmentNumber: i + 1,
        amountCents,
        dueDate: addMonthsClamped(firstDue, i),
        createdById: sale.userId
      }
    })
  }
}

/** Saldo devedor do cliente (parcelas em aberto ou parciais). */
export async function customerOpenBalance(db: DbClient, customerId: number): Promise<number> {
  const s = await db.accountReceivable.aggregate({ where: { customerId, status: { in: [...PENDING] } }, _sum: { amountCents: true, receivedCents: true } })
  return (s._sum.amountCents ?? 0) - (s._sum.receivedCents ?? 0)
}

/**
 * Contas a receber: crediário das vendas e lançamentos avulsos, recebimentos parciais com juros/desconto,
 * estorno de recebimentos e integração com o caixa aberto do usuário.
 */
export class ReceivableService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async detail(db: DbClient, id: number): Promise<ReceivableDetail> {
    const r = await db.accountReceivable.findUnique({ where: { id }, include: detailInclude })
    if (!r) throw notFound('Conta a receber não encontrada.')
    return toDetail(r, this.now())
  }

  async list(actorInput: Actor | null, input: unknown): Promise<ReceivableListResult> {
    requirePermission(actorInput, 'finance.receivables')
    const q = receivableListSchema.parse(input ?? {})
    const { today } = dueWindows(this.now())
    const and: Prisma.AccountReceivableWhereInput[] = []
    if (q.status === 'PENDING') and.push({ status: { in: [...PENDING] } })
    else if (q.status === 'OVERDUE') and.push({ status: { in: [...PENDING] }, dueDate: { lt: today } })
    else if (q.status === 'OPEN' || q.status === 'PARTIAL') and.push({ status: q.status, dueDate: { gte: today } })
    else if (q.status) and.push({ status: q.status })
    if (q.from) and.push({ dueDate: { gte: fromDateKey(q.from)! } })
    if (q.to) and.push({ dueDate: { lte: fromDateKey(q.to, true)! } })
    if (q.customerId) and.push({ customerId: q.customerId })
    if (q.saleId) and.push({ saleId: q.saleId })
    if (q.search) {
      const n = Number(q.search.replace('#', ''))
      const term = normalizeSearch(q.search)
      and.push({
        OR: [
          ...(Number.isInteger(n) && n > 0 ? [{ id: n }, { saleId: n }] : []),
          { description: { contains: q.search } },
          ...(term ? [{ customer: { searchText: { contains: term } } }] : [])
        ]
      })
    }
    const where = { AND: and }
    const [total, sums, rows] = await Promise.all([
      this.db.accountReceivable.count({ where }),
      this.db.accountReceivable.aggregate({ where, _sum: { amountCents: true, receivedCents: true } }),
      this.db.accountReceivable.findMany({ where, include, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    const pendingSums = await this.db.accountReceivable.aggregate({ where: { AND: [...and, { status: { in: [...PENDING] } }] }, _sum: { amountCents: true, receivedCents: true } })
    const now = this.now()
    return {
      items: rows.map((r) => toDto(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      amountCents: sums._sum.amountCents ?? 0,
      remainingCents: (pendingSums._sum.amountCents ?? 0) - (pendingSums._sum.receivedCents ?? 0)
    }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<ReceivableDetail> {
    requirePermission(actorInput, 'finance.receivables')
    return this.detail(this.db, idSchema.parse(input).id)
  }

  /** Lançamento avulso, opcionalmente parcelado em meses. */
  async create(actorInput: Actor | null, input: unknown): Promise<ReceivableDto[]> {
    const actor = requirePermission(actorInput, 'finance.receivables')
    const data = receivableSchema.parse(input)
    const ids = await this.db.$transaction(async (tx) => {
      if (data.customerId && !(await tx.customer.findFirst({ where: { id: data.customerId, deletedAt: null } }))) throw validationError('Cliente inválido.')
      const first = fromDateKey(data.firstDueDate)!
      const parts = splitInstallments(data.amountCents, data.installments)
      const created: number[] = []
      for (const [i, amountCents] of parts.entries()) {
        const r = await tx.accountReceivable.create({
          data: {
            description: data.installments > 1 ? `${data.description} (${i + 1}/${data.installments})` : data.description,
            customerId: data.customerId,
            installmentNumber: i + 1,
            amountCents,
            dueDate: addMonthsClamped(first, i),
            notes: data.notes,
            createdById: actor.userId
          }
        })
        created.push(r.id)
      }
      await writeAudit(tx, { userId: actor.userId, action: 'receivable.create', entity: 'AccountReceivable', entityId: created[0], details: { amountCents: data.amountCents, installments: data.installments, ids: created } })
      return created
    })
    const rows = await this.db.accountReceivable.findMany({ where: { id: { in: ids } }, include, orderBy: { id: 'asc' } })
    return rows.map((r) => toDto(r, this.now()))
  }

  /** Renegociação simples: descrição, vencimento e observações. */
  async update(actorInput: Actor | null, input: unknown): Promise<ReceivableDetail> {
    const actor = requirePermission(actorInput, 'finance.receivables')
    const data = receivableUpdateSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const r = await tx.accountReceivable.findUnique({ where: { id: data.id } })
      if (!r) throw notFound('Conta a receber não encontrada.')
      if (!PENDING.includes(r.status as (typeof PENDING)[number])) throw conflict('Só é possível alterar valores em aberto.')
      await tx.accountReceivable.update({ where: { id: data.id }, data: { description: data.description, dueDate: fromDateKey(data.dueDate)!, notes: data.notes } })
      await writeAudit(tx, { userId: actor.userId, action: 'receivable.update', entity: 'AccountReceivable', entityId: data.id, details: { from: r.dueDate.toISOString(), to: data.dueDate } })
    })
    return this.detail(this.db, data.id)
  }

  /**
   * Recebimento total ou parcial. O mesmo requestId nunca é registrado duas vezes e o valor não pode
   * ultrapassar o saldo. Dinheiro exige caixa aberto (entra na gaveta); outras formas entram no caixa
   * aberto do usuário, se houver.
   */
  async receive(actorInput: Actor | null, input: unknown): Promise<ReceivableDetail> {
    const actor = requirePermission(actorInput, 'finance.receivables')
    const data = receivableReceiveSchema.parse(input)
    const paidAt = settlementDate(data.paidAt, this.now())
    const id = await this.db.$transaction(async (tx) => {
      const already = await tx.receivablePayment.findUnique({ where: { idempotencyKey: data.requestId } })
      if (already) return already.receivableId
      const r = await tx.accountReceivable.findUnique({ where: { id: data.id } })
      if (!r) throw notFound('Conta a receber não encontrada.')
      if (!PENDING.includes(r.status as (typeof PENDING)[number])) throw conflict(r.status === 'PAID' ? 'Este valor já foi recebido.' : 'Esta conta foi cancelada.')
      const remaining = r.amountCents - r.receivedCents
      const settled = data.amountCents + data.discountCents
      if (settled > remaining) throw validationError(`Valor maior que o saldo em aberto (${formatMoney(remaining)}).`, { amountCents: 'Maior que o saldo' })

      const session = data.method === 'CASH' ? await requireOpenSession(tx, actor.userId) : await findOpenSession(tx, actor.userId)
      const payment = await tx.receivablePayment.create({
        data: {
          receivableId: r.id,
          amountCents: data.amountCents,
          interestCents: data.interestCents,
          discountCents: data.discountCents,
          method: data.method,
          paidAt,
          userId: actor.userId,
          idempotencyKey: data.requestId,
          cashSessionId: session?.id ?? null
        }
      })
      if (session) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'RECEIVABLE',
            method: data.method,
            amountCents: data.amountCents + data.interestCents,
            description: `Recebimento: ${r.description}`,
            referenceType: 'RECEIVABLE_PAYMENT',
            referenceId: String(payment.id),
            idempotencyKey: `RECEIVABLE:${payment.id}`,
            userId: actor.userId
          }
        })
      }
      // Atualização condicional: dois recebimentos simultâneos não ultrapassam o saldo
      const updated = await tx.accountReceivable.updateMany({
        where: { id: r.id, receivedCents: r.receivedCents },
        data: { receivedCents: r.receivedCents + settled, status: settled === remaining ? 'PAID' : 'PARTIAL' }
      })
      if (updated.count !== 1) throw conflict('O saldo desta conta mudou. Atualize e tente novamente.')
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'receivable.receive',
        entity: 'AccountReceivable',
        entityId: r.id,
        details: { paymentId: payment.id, amountCents: data.amountCents, interestCents: data.interestCents, discountCents: data.discountCents, method: data.method, cashSessionId: session?.id ?? null }
      })
      return r.id
    })
    return this.detail(this.db, id)
  }

  /** Estorna um recebimento: o saldo volta a ficar em aberto e o dinheiro sai do caixa aberto. */
  async reverse(actorInput: Actor | null, input: unknown): Promise<ReceivableDetail> {
    const actor = requirePermission(actorInput, 'finance.receivables')
    const { paymentId, reason } = receivableReverseSchema.parse(input)
    const id = await this.db.$transaction(async (tx) => {
      const p = await tx.receivablePayment.findUnique({ where: { id: paymentId }, include: { receivable: true } })
      if (!p) throw notFound('Recebimento não encontrado.')
      if (p.reversedAt) throw conflict('Este recebimento já foi estornado.')
      if (p.receivable.status === 'CANCELLED') throw conflict('A conta foi cancelada.')
      const total = p.amountCents + p.interestCents
      if (p.cashSessionId) {
        // O valor entrou em um caixa: a saída é registrada no caixa aberto de quem estorna
        const session = await requireOpenSession(tx, actor.userId)
        if (p.method === 'CASH') {
          const balance = await drawerBalance(tx, session)
          if (total > balance) throw conflict(`Dinheiro insuficiente na gaveta (${formatMoney(balance)}).`)
        }
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'RECEIVABLE',
            method: p.method,
            amountCents: -total,
            description: `Estorno de recebimento: ${p.receivable.description}`,
            referenceType: 'RECEIVABLE_PAYMENT',
            referenceId: String(p.id),
            idempotencyKey: `RECEIVABLE_REVERSE:${p.id}`,
            userId: actor.userId
          }
        })
      }
      await tx.receivablePayment.update({ where: { id: p.id }, data: { reversedAt: this.now(), reversedById: actor.userId, reverseReason: reason } })
      const received = p.receivable.receivedCents - p.amountCents - p.discountCents
      await tx.accountReceivable.update({ where: { id: p.receivableId }, data: { receivedCents: received, status: received > 0 ? 'PARTIAL' : 'OPEN' } })
      await writeAudit(tx, { userId: actor.userId, action: 'receivable.reverse', entity: 'AccountReceivable', entityId: p.receivableId, details: { paymentId: p.id, reason, amountCents: total } })
      return p.receivableId
    })
    return this.detail(this.db, id)
  }

  /** Cancela um lançamento avulso sem recebimentos. Parcelas de venda são canceladas com a venda. */
  async cancel(actorInput: Actor | null, input: unknown): Promise<ReceivableDetail> {
    const actor = requirePermission(actorInput, 'finance.receivables')
    const { id, reason } = receivableCancelSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const r = await tx.accountReceivable.findUnique({ where: { id } })
      if (!r) throw notFound('Conta a receber não encontrada.')
      if (r.saleId) throw conflict(`Parcela da venda #${r.saleId}: cancele ou devolva a venda no PDV.`)
      if (r.status === 'CANCELLED') throw conflict('Esta conta já foi cancelada.')
      if (r.receivedCents > 0) throw conflict('Há recebimentos registrados. Estorne-os antes de cancelar.')
      await tx.accountReceivable.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: this.now(), cancelReason: reason } })
      await writeAudit(tx, { userId: actor.userId, action: 'receivable.cancel', entity: 'AccountReceivable', entityId: id, details: { reason } })
    })
    return this.detail(this.db, id)
  }

  async summary(actorInput: Actor | null): Promise<DueSummary> {
    requirePermission(actorInput, 'finance.receivables')
    const w = dueWindows(this.now())
    const pending = { status: { in: [...PENDING] } }
    const sum = async (where: Prisma.AccountReceivableWhereInput) => {
      const a = await this.db.accountReceivable.aggregate({ where, _sum: { amountCents: true, receivedCents: true }, _count: { _all: true } })
      return { count: a._count._all, cents: (a._sum.amountCents ?? 0) - (a._sum.receivedCents ?? 0) }
    }
    const [overdue, today, next7, all, received] = await Promise.all([
      sum({ ...pending, dueDate: { lt: w.today } }),
      sum({ ...pending, dueDate: { gte: w.today, lt: w.tomorrow } }),
      sum({ ...pending, dueDate: { gte: w.today, lt: w.in8Days } }),
      sum(pending),
      this.db.receivablePayment.aggregate({ where: { reversedAt: null, paidAt: { gte: w.monthStart } }, _sum: { amountCents: true, interestCents: true } })
    ])
    return {
      overdueCount: overdue.count,
      overdueCents: overdue.cents,
      dueTodayCount: today.count,
      dueTodayCents: today.cents,
      next7Count: next7.count,
      next7Cents: next7.cents,
      openCents: all.cents,
      settledMonthCents: (received._sum.amountCents ?? 0) + (received._sum.interestCents ?? 0)
    }
  }

  /** Dados do recibo de um recebimento. */
  async paymentForReceipt(actorInput: Actor | null, paymentId: number) {
    requirePermission(actorInput, 'finance.receivables')
    const p = await this.db.receivablePayment.findUnique({ where: { id: paymentId }, include: { user: { select: { name: true } }, receivable: { include: { customer: true } } } })
    if (!p) throw notFound('Recebimento não encontrado.')
    if (p.reversedAt) throw conflict('Recebimento estornado: não é possível emitir o recibo.')
    return p
  }
}
