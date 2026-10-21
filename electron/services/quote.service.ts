import type { DocumentPreview, OrderDetail, QuoteDetail, QuoteListResult } from '@shared/api'
import { normalizeSearch } from '@shared/text'
import { idSchema } from '@shared/catalogSchemas'
import { quoteListSchema, quoteSchema, quoteStatusSchema, quoteToOrderSchema, quoteUpdateSchema } from '@shared/commerceSchemas'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import type { AuthService } from './auth.service'
import { requirePermission, type Actor } from './context'
import { authorizeDiscount } from './discount'
import { priceDocumentLines, toLineDto } from './documentLines'
import { previewDocument, type OrderService } from './order.service'
import { fromDateKey, toDateKey } from './product.mappers'

const detailInclude = {
  user: { select: { name: true } },
  customer: { select: { id: true, name: true, document: true, phone: true } },
  items: { include: { product: { select: { unit: true, isService: true } } }, orderBy: { id: 'asc' } },
  order: { select: { id: true, status: true } },
  sale: { select: { id: true, status: true } },
  _count: { select: { items: true } }
} as const satisfies Prisma.QuoteInclude

type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof detailInclude }>

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Rascunho/enviado com validade vencida é tratado como expirado. */
export function effectiveQuoteStatus(q: { status: string; validUntil: Date | null }): QuoteDetail['status'] {
  if ((q.status === 'DRAFT' || q.status === 'SENT') && q.validUntil && q.validUntil < startOfToday()) return 'EXPIRED'
  return q.status as QuoteDetail['status']
}

/** Orçamentos: não baixam estoque; podem virar pedido ou venda (uma única vez). */
export class QuoteService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly orders: OrderService
  ) {}

  private toDetail(q: QuoteRow): QuoteDetail {
    return {
      id: q.id,
      createdAt: q.createdAt.toISOString(),
      status: effectiveQuoteStatus(q),
      validUntil: toDateKey(q.validUntil ?? q.createdAt)!,
      customerName: q.customer?.name ?? q.contactName,
      totalCents: q.totalCents,
      itemCount: q._count.items,
      userName: q.user.name,
      orderId: q.order && q.order.status !== 'CANCELLED' ? q.order.id : null,
      saleId: q.sale && q.sale.status !== 'CANCELLED' ? q.sale.id : null,
      customer: q.customer,
      contactName: q.contactName,
      contactPhone: q.contactPhone,
      items: q.items.map(toLineDto),
      subtotalCents: q.subtotalCents,
      discountCents: q.discountCents,
      notes: q.notes,
      discountAuthorizedByName: null,
      sentAt: q.sentAt?.toISOString() ?? null,
      decidedAt: q.decidedAt?.toISOString() ?? null,
      hasFreeLines: q.items.some((i) => i.productId === null)
    }
  }

  async detail(db: DbClient, id: number): Promise<QuoteDetail> {
    const q = await db.quote.findUnique({ where: { id }, include: detailInclude })
    if (!q) throw notFound('Orçamento não encontrado.')
    const d = this.toDetail(q)
    if (q.discountAuthorizedById) d.discountAuthorizedByName = (await db.user.findUnique({ where: { id: q.discountAuthorizedById } }))?.name ?? null
    return d
  }

  async list(actorInput: Actor | null, input: unknown): Promise<QuoteListResult> {
    requirePermission(actorInput, 'quotes.manage')
    const q = quoteListSchema.parse(input ?? {})
    const today = startOfToday()
    const and: Prisma.QuoteWhereInput[] = []
    if (q.status === 'EXPIRED') and.push({ status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: today } })
    else if (q.status === 'DRAFT' || q.status === 'SENT') and.push({ status: q.status, validUntil: { gte: today } })
    else if (q.status) and.push({ status: q.status })
    if (q.customerId) and.push({ customerId: q.customerId })
    if (q.search) {
      const n = Number(q.search.replace('#', ''))
      and.push({
        OR: [
          ...(Number.isInteger(n) && n > 0 ? [{ id: n }] : []),
          { customer: { searchText: { contains: normalizeSearch(q.search) } } },
          { contactName: { contains: q.search } }
        ]
      })
    }
    const where = { AND: and }
    const [total, rows] = await Promise.all([
      this.db.quote.count({ where }),
      this.db.quote.findMany({ where, include: detailInclude, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => {
        const d = this.toDetail(r)
        return { id: d.id, createdAt: d.createdAt, status: d.status, validUntil: d.validUntil, customerName: d.customerName, totalCents: d.totalCents, itemCount: d.itemCount, userName: d.userName, orderId: d.orderId, saleId: d.saleId }
      })
    }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<QuoteDetail> {
    requirePermission(actorInput, 'quotes.manage', 'pdv.sell')
    return this.detail(this.db, idSchema.parse(input).id)
  }

  async preview(actorInput: Actor | null, input: unknown): Promise<DocumentPreview> {
    const actor = requirePermission(actorInput, 'quotes.manage', 'orders.manage')
    return previewDocument(this.db, this.auth, actor, input, true)
  }

  private itemsData(lines: Awaited<ReturnType<typeof priceDocumentLines>>['lines']) {
    return lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      isService: l.isService,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      totalCents: l.totalCents
    }))
  }

  async create(actorInput: Actor | null, input: unknown): Promise<QuoteDetail> {
    const actor = requirePermission(actorInput, 'quotes.manage')
    const data = quoteSchema.parse(input)
    if (fromDateKey(data.validUntil)! < startOfToday()) throw validationError('A validade não pode estar no passado.', { validUntil: 'Data no passado' })
    const priced = await priceDocumentLines(this.db, data.items, data.discountCents, { allowFreeText: true })
    const authorizerId = await authorizeDiscount(this.auth, actor, priced.discountCents, priced.requiredBps, data.authorization, 'quote.discount')
    const id = await this.db.$transaction(async (tx) => {
      if (data.customerId && !(await tx.customer.findFirst({ where: { id: data.customerId, deletedAt: null } }))) throw validationError('Cliente inválido.')
      const q = await tx.quote.create({
        data: {
          customerId: data.customerId,
          contactName: data.customerId ? null : data.contactName,
          contactPhone: data.customerId ? null : data.contactPhone,
          userId: actor.userId,
          validUntil: fromDateKey(data.validUntil, true),
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          notes: data.notes,
          discountAuthorizedById: authorizerId,
          items: { create: this.itemsData(priced.lines) }
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'quote.create', entity: 'Quote', entityId: q.id, details: { totalCents: q.totalCents } })
      return q.id
    })
    return this.detail(this.db, id)
  }

  private async requireEditable(tx: DbClient, id: number) {
    const q = await tx.quote.findUnique({ where: { id }, include: detailInclude })
    if (!q) throw notFound('Orçamento não encontrado.')
    const d = this.toDetail(q)
    if (d.orderId || d.saleId) throw conflict('Orçamento já convertido em pedido ou venda.')
    return { q, d }
  }

  async update(actorInput: Actor | null, input: unknown): Promise<QuoteDetail> {
    const actor = requirePermission(actorInput, 'quotes.manage')
    const data = quoteUpdateSchema.parse(input)
    const { q } = await this.requireEditable(this.db, data.id)
    if (q.status === 'APPROVED' || q.status === 'REJECTED') throw conflict('Orçamento aprovado ou recusado não pode ser alterado. Volte-o para rascunho.')
    const priced = await priceDocumentLines(this.db, data.items, data.discountCents, { allowFreeText: true })
    const authorizerId = await authorizeDiscount(this.auth, actor, priced.discountCents, priced.requiredBps, data.authorization, 'quote.discount')
    await this.db.$transaction(async (tx) => {
      await tx.quoteItem.deleteMany({ where: { quoteId: data.id } })
      await tx.quote.update({
        where: { id: data.id },
        data: {
          customerId: data.customerId,
          contactName: data.customerId ? null : data.contactName,
          contactPhone: data.customerId ? null : data.contactPhone,
          // Alterar validade/itens de um orçamento expirado o reabre como rascunho
          status: q.status === 'SENT' ? 'SENT' : 'DRAFT',
          validUntil: fromDateKey(data.validUntil, true),
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          notes: data.notes,
          discountAuthorizedById: authorizerId,
          items: { create: this.itemsData(priced.lines) }
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'quote.update', entity: 'Quote', entityId: data.id, details: { totalCents: priced.totalCents } })
    })
    return this.detail(this.db, data.id)
  }

  async setStatus(actorInput: Actor | null, input: unknown): Promise<QuoteDetail> {
    const actor = requirePermission(actorInput, 'quotes.manage')
    const { id, status } = quoteStatusSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const { q, d } = await this.requireEditable(tx, id)
      if (d.status === 'EXPIRED' && status !== 'DRAFT') throw conflict('Orçamento expirado: altere a validade antes (ele volta para rascunho).')
      await tx.quote.update({
        where: { id },
        data: {
          status,
          sentAt: status === 'SENT' ? (q.sentAt ?? new Date()) : q.sentAt,
          decidedAt: status === 'APPROVED' || status === 'REJECTED' ? new Date() : null
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'quote.status', entity: 'Quote', entityId: id, details: { from: q.status, to: status } })
    })
    return this.detail(this.db, id)
  }

  /** Converte em pedido com os mesmos itens, preços e descontos; o orçamento fica aprovado. */
  async toOrder(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    const actor = requirePermission(actorInput, 'quotes.manage')
    requirePermission(actor, 'orders.manage')
    const { id, expectedDeliveryAt } = quoteToOrderSchema.parse(input)
    const orderId = await this.db.$transaction(async (tx) => {
      const { q, d } = await this.requireEditable(tx, id)
      assertConvertible(d)
      const o = await tx.order.create({
        data: {
          customerId: q.customerId,
          userId: actor.userId,
          subtotalCents: q.subtotalCents,
          discountCents: q.discountCents,
          totalCents: q.totalCents,
          expectedDeliveryAt: fromDateKey(expectedDeliveryAt),
          notes: [q.notes, `Gerado do orçamento #${q.id}`].filter(Boolean).join('\n'),
          quoteId: q.id,
          discountAuthorizedById: q.discountAuthorizedById,
          items: {
            create: q.items.map((i) => ({
              productId: i.productId!,
              variantId: i.variantId,
              description: i.description,
              quantityMilli: i.quantityMilli,
              unitPriceCents: i.unitPriceCents,
              discountCents: i.discountCents,
              totalCents: i.totalCents
            }))
          }
        }
      })
      await tx.quote.update({ where: { id }, data: { status: 'APPROVED', decidedAt: q.decidedAt ?? new Date() } })
      await writeAudit(tx, { userId: actor.userId, action: 'quote.to_order', entity: 'Quote', entityId: id, details: { orderId: o.id } })
      return o.id
    })
    return this.orders.detail(this.db, orderId)
  }
}

/** Regras para converter orçamento em pedido ou venda. */
export function assertConvertible(d: QuoteDetail): void {
  if (d.orderId) throw conflict(`Orçamento já convertido no pedido #${d.orderId}.`)
  if (d.saleId) throw conflict(`Orçamento já convertido na venda #${d.saleId}.`)
  if (d.status === 'EXPIRED') throw conflict('Orçamento expirado. Atualize a validade antes de converter.')
  if (d.status === 'REJECTED') throw conflict('Orçamento recusado não pode ser convertido.')
  if (d.hasFreeLines) throw conflict('O orçamento tem itens de texto livre. Substitua-os por produtos ou serviços cadastrados para converter.')
}
