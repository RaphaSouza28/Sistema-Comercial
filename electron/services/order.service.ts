import { z } from 'zod'
import { normalizeSearch } from '@shared/text'
import type { DocumentPreview, OrderDetail, OrderListResult } from '@shared/api'
import { documentItemSchema, orderCancelSchema, orderListSchema, orderSchema, orderStatusSchema, orderUpdateSchema } from '@shared/commerceSchemas'
import { idSchema } from '@shared/catalogSchemas'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import type { AuthService } from './auth.service'
import { requirePermission, type Actor } from './context'
import { authorizeDiscount, discountLimitOf } from './discount'
import { priceDocumentLines, toLineDto } from './documentLines'
import { fromDateKey } from './product.mappers'

const detailInclude = {
  user: { select: { name: true } },
  customer: { select: { id: true, name: true, document: true, phone: true } },
  items: { include: { product: { select: { unit: true, isService: true } } }, orderBy: { id: 'asc' } },
  sale: { select: { id: true, status: true } },
  _count: { select: { items: true } }
} as const satisfies Prisma.OrderInclude

type OrderRow = Prisma.OrderGetPayload<{ include: typeof detailInclude }>

/** Pedido convertido em venda (não cancelada) não pode mais ser alterado. */
const convertedSale = (o: { sale: { id: number; status: string } | null }) => (o.sale && o.sale.status !== 'CANCELLED' ? o.sale.id : null)

const previewSchema = z.object({ items: z.array(documentItemSchema).min(1).max(300), discountCents: z.number().int().min(0).default(0) })

/** Pré-visualização de pedido/orçamento (cálculo, descontos e necessidade de autorização). */
export async function previewDocument(db: Db, auth: AuthService, actor: Actor, input: unknown, allowFreeText: boolean): Promise<DocumentPreview> {
  const data = previewSchema.parse(input)
  const r = await priceDocumentLines(db, data.items, data.discountCents, { allowFreeText })
  const maxDiscountBps = await discountLimitOf(auth, actor)
  return {
    lines: r.lines.map((l) => ({ index: l.index, description: l.description, unitPriceCents: l.unitPriceCents, grossCents: l.grossCents, discountCents: l.discountCents, totalCents: l.totalCents })),
    subtotalCents: r.subtotalCents,
    itemsDiscountCents: r.itemsDiscountCents,
    documentDiscountCents: r.documentDiscountCents,
    totalCents: r.totalCents,
    discountBps: r.discountBps,
    maxDiscountBps,
    requiresAuthorization: r.discountCents > 0 && r.requiredBps > maxDiscountBps
  }
}

/** Pedidos: registro, acompanhamento por status e conversão em venda (pelo PDV). Não baixam estoque. */
export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService
  ) {}

  private toDetail(o: OrderRow): OrderDetail {
    return {
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      customerName: o.customer?.name ?? null,
      totalCents: o.totalCents,
      itemCount: o._count.items,
      expectedDeliveryAt: o.expectedDeliveryAt?.toISOString() ?? null,
      userName: o.user.name,
      saleId: convertedSale(o),
      quoteId: o.quoteId,
      customer: o.customer,
      items: o.items.map(toLineDto),
      subtotalCents: o.subtotalCents,
      discountCents: o.discountCents,
      notes: o.notes,
      discountAuthorizedByName: null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      cancelReason: o.cancelReason
    }
  }

  async detail(db: DbClient, id: number): Promise<OrderDetail> {
    const o = await db.order.findUnique({ where: { id }, include: detailInclude })
    if (!o) throw notFound('Pedido não encontrado.')
    const d = this.toDetail(o)
    if (o.discountAuthorizedById) d.discountAuthorizedByName = (await db.user.findUnique({ where: { id: o.discountAuthorizedById } }))?.name ?? null
    return d
  }

  async list(actorInput: Actor | null, input: unknown): Promise<OrderListResult> {
    requirePermission(actorInput, 'orders.manage')
    const q = orderListSchema.parse(input ?? {})
    const and: Prisma.OrderWhereInput[] = []
    if (q.status === 'OPEN') and.push({ status: { in: ['PENDING', 'CONFIRMED', 'PICKING', 'READY'] } })
    else if (q.status) and.push({ status: q.status })
    if (q.customerId) and.push({ customerId: q.customerId })
    if (q.search) {
      const n = Number(q.search.replace('#', ''))
      and.push({ OR: [...(Number.isInteger(n) && n > 0 ? [{ id: n }] : []), { customer: { searchText: { contains: normalizeSearch(q.search) } } }] })
    }
    const where = { AND: and }
    const [total, rows] = await Promise.all([
      this.db.order.count({ where }),
      this.db.order.findMany({ where, include: detailInclude, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((o) => {
        const { customer: _c, items: _i, subtotalCents: _s, discountCents: _d, notes: _n, discountAuthorizedByName: _a, deliveredAt: _e, cancelledAt: _x, cancelReason: _r, ...item } = this.toDetail(o)
        return item
      })
    }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    requirePermission(actorInput, 'orders.manage', 'pdv.sell')
    return this.detail(this.db, idSchema.parse(input).id)
  }

  async preview(actorInput: Actor | null, input: unknown): Promise<DocumentPreview> {
    const actor = requirePermission(actorInput, 'orders.manage', 'quotes.manage')
    return previewDocument(this.db, this.auth, actor, input, true)
  }

  /** Grava itens com preços e descontos combinados (desconto acima do limite exige autorização). */
  async writeItems(
    tx: DbClient,
    actor: Actor,
    data: { items: z.output<typeof documentItemSchema>[]; discountCents: number; authorization?: unknown },
    action: string
  ) {
    const priced = await priceDocumentLines(tx, data.items, data.discountCents, { allowFreeText: false })
    const authorizerId = await authorizeDiscount(this.auth, actor, priced.discountCents, priced.requiredBps, data.authorization, action)
    return { priced, authorizerId }
  }

  async create(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    const actor = requirePermission(actorInput, 'orders.manage')
    const data = orderSchema.parse(input)
    const { priced, authorizerId } = await this.writeItems(this.db, actor, data, 'order.discount')
    const id = await this.db.$transaction(async (tx) => {
      if (data.customerId && !(await tx.customer.findFirst({ where: { id: data.customerId, deletedAt: null } }))) throw validationError('Cliente inválido.')
      const o = await tx.order.create({
        data: {
          customerId: data.customerId,
          userId: actor.userId,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          expectedDeliveryAt: fromDateKey(data.expectedDeliveryAt),
          notes: data.notes,
          discountAuthorizedById: authorizerId,
          items: { create: priced.lines.map((l) => ({ productId: l.productId!, variantId: l.variantId, description: l.description, quantityMilli: l.quantityMilli, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents, totalCents: l.totalCents })) }
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'order.create', entity: 'Order', entityId: o.id, details: { totalCents: o.totalCents, discountAuthorizedBy: authorizerId } })
      return o.id
    })
    return this.detail(this.db, id)
  }

  async update(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    const actor = requirePermission(actorInput, 'orders.manage')
    const data = orderUpdateSchema.parse(input)
    const current = await this.db.order.findUnique({ where: { id: data.id }, include: detailInclude })
    if (!current) throw notFound('Pedido não encontrado.')
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) throw conflict('Só é possível alterar pedidos pendentes ou confirmados.')
    if (convertedSale(current)) throw conflict('Pedido já convertido em venda.')
    const { priced, authorizerId } = await this.writeItems(this.db, actor, data, 'order.discount')
    await this.db.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: data.id } })
      await tx.order.update({
        where: { id: data.id },
        data: {
          customerId: data.customerId,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          expectedDeliveryAt: fromDateKey(data.expectedDeliveryAt),
          notes: data.notes,
          discountAuthorizedById: authorizerId,
          items: { create: priced.lines.map((l) => ({ productId: l.productId!, variantId: l.variantId, description: l.description, quantityMilli: l.quantityMilli, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents, totalCents: l.totalCents })) }
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'order.update', entity: 'Order', entityId: data.id, details: { totalCents: priced.totalCents } })
    })
    return this.detail(this.db, data.id)
  }

  async setStatus(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    const actor = requirePermission(actorInput, 'orders.manage')
    const { id, status } = orderStatusSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { id } })
      if (!o) throw notFound('Pedido não encontrado.')
      if (o.status === 'CANCELLED' || o.status === 'DELIVERED') throw conflict('Pedido entregue ou cancelado não muda de situação.')
      await tx.order.update({ where: { id }, data: { status, deliveredAt: status === 'DELIVERED' ? new Date() : null } })
      await writeAudit(tx, { userId: actor.userId, action: 'order.status', entity: 'Order', entityId: id, details: { from: o.status, to: status } })
    })
    return this.detail(this.db, id)
  }

  async cancel(actorInput: Actor | null, input: unknown): Promise<OrderDetail> {
    const actor = requirePermission(actorInput, 'orders.manage')
    const { id, reason } = orderCancelSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { id }, include: { sale: { select: { id: true, status: true } } } })
      if (!o) throw notFound('Pedido não encontrado.')
      if (o.status === 'CANCELLED') throw conflict('Pedido já cancelado.')
      if (o.status === 'DELIVERED') throw conflict('Pedido entregue não pode ser cancelado. Use a devolução da venda.')
      if (convertedSale(o)) throw conflict(`Pedido convertido na venda #${o.sale!.id}. Cancele a venda antes.`)
      // Desvincula o orçamento de origem para que ele possa ser convertido novamente
      await tx.order.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, quoteId: null } })
      await writeAudit(tx, { userId: actor.userId, action: 'order.cancel', entity: 'Order', entityId: id, details: { reason, quoteId: o.quoteId } })
    })
    return this.detail(this.db, id)
  }
}
