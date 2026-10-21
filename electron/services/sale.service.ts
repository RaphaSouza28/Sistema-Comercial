import { randomBytes } from 'node:crypto'
import type { z } from 'zod'
import type { PdvItem, SaleDetail, SaleListResult, SalePreview, SaleReturnResult, SaleSource, SellerDto, VoucherDto } from '@shared/api'
import { formatMoney } from '@shared/format'
import { totalUnitCost } from '@shared/pricing'
import { allocate, lineGross, unitPriceFor } from '@shared/salePricing'
import {
  pdvSearchSchema,
  saleCancelSchema,
  saleFinalizeSchema,
  saleListSchema,
  salePreviewSchema,
  saleReturnSchema,
  voucherLookupSchema
} from '@shared/salesSchemas'
import { normalizeSearch } from '@shared/text'
import type { Db, DbClient } from '../database/connection'
import type { PaymentMethod, Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, forbidden, notFound, validationError } from '../utils/errors'
import type { AuthService } from './auth.service'
import { drawerBalance, requireOpenSession } from './cash.service'
import { requirePermission, type Actor } from './context'
import { fromDateKey, productImageUrl } from './product.mappers'
import { createSaleInstallments, customerOpenBalance } from './receivable.service'
import { onSaleCancelled } from './fiscal/fiscal.service'
import { moveStock } from './stockCore'
import { addDays, startOfDay } from '../utils/dates'
import { effectiveQuoteStatus } from './quote.service'

type PreviewData = z.output<typeof salePreviewSchema>

const detailInclude = {
  user: { select: { name: true } },
  seller: { select: { name: true } },
  customer: { select: { id: true, name: true, document: true, phone: true } },
  cancelledBy: { select: { name: true } },
  discountAuthorizedBy: { select: { name: true } },
  items: { include: { product: { select: { unit: true } }, returnItems: true }, orderBy: { id: 'asc' } },
  payments: { include: { voucherReturn: { select: { voucherCode: true } } }, orderBy: { id: 'asc' } },
  returns: { include: { user: { select: { name: true } } }, orderBy: { id: 'asc' } },
  receivables: { orderBy: { installmentNumber: 'asc' } }
} as const satisfies Prisma.SaleInclude

type SaleRow = Prisma.SaleGetPayload<{ include: typeof detailInclude }>

function toDetail(s: SaleRow): SaleDetail {
  return {
    id: s.id,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    operatorName: s.user.name,
    sellerName: s.seller?.name ?? null,
    customer: s.customer,
    customerDocument: s.customerDocument,
    items: s.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      description: i.description,
      unit: i.product.unit,
      quantityMilli: i.quantityMilli,
      unitPriceCents: i.unitPriceCents,
      discountCents: i.discountCents,
      totalCents: i.totalCents,
      returnedMilli: i.returnItems.reduce((acc, r) => acc + r.quantityMilli, 0)
    })),
    payments: s.payments.map((p) => ({
      method: p.method,
      label: p.methodLabel,
      amountCents: p.amountCents,
      installments: p.installments,
      status: p.status,
      voucherCode: p.voucherReturn?.voucherCode ?? null
    })),
    subtotalCents: s.subtotalCents,
    discountCents: s.discountCents,
    totalCents: s.totalCents,
    paidCents: s.paidCents,
    changeCents: s.changeCents,
    notes: s.notes,
    discountAuthorizedByName: s.discountAuthorizedBy?.name ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    cancelledByName: s.cancelledBy?.name ?? null,
    cancelReason: s.cancelReason,
    returns: s.returns.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      refundMethod: r.refundMethod,
      refundCents: r.refundCents,
      voucherCode: r.voucherCode,
      userName: r.user.name,
      reason: r.reason
    })),
    installments: s.receivables.map((r) => ({
      id: r.id,
      number: r.installmentNumber,
      dueDate: r.dueDate.toISOString(),
      amountCents: r.amountCents,
      receivedCents: r.receivedCents,
      status: r.status
    })),
    cashSessionId: s.cashSessionId
  }
}

export { allocate } from '@shared/salePricing'

const MONEY_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER']

/** Devolução no crediário: reduz o saldo das parcelas em aberto, da última para a primeira. */
async function abateInstallments(tx: DbClient, saleId: number, amountCents: number): Promise<void> {
  const open = await tx.accountReceivable.findMany({ where: { saleId, status: { in: ['OPEN', 'PARTIAL'] } }, orderBy: { installmentNumber: 'desc' } })
  const available = open.reduce((a, i) => a + i.amountCents - i.receivedCents, 0)
  if (amountCents > available) {
    throw conflict(`O saldo em aberto do crediário (${formatMoney(available)}) é menor que o valor devolvido. Escolha outra forma de reembolso.`)
  }
  let left = amountCents
  for (const i of open) {
    if (left === 0) break
    const take = Math.min(left, i.amountCents - i.receivedCents)
    left -= take
    const amount = i.amountCents - take
    const settled = amount === i.receivedCents
    await tx.accountReceivable.update({
      where: { id: i.id },
      data: {
        amountCents: amount,
        ...(settled
          ? i.receivedCents > 0
            ? { status: 'PAID' }
            : { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Abatida por devolução' }
          : {}),
        notes: [i.notes, `Abatido ${formatMoney(take)} por devolução`].filter(Boolean).join('\n')
      }
    })
  }
}

export class SaleService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ───────────── Apoio ao PDV ─────────────

  async searchItems(actorInput: Actor | null, input: unknown): Promise<PdvItem[]> {
    requirePermission(actorInput, 'pdv.sell', 'orders.manage', 'quotes.manage')
    const { query, limit } = pdvSearchSchema.parse(input)
    const include = { variants: { where: { deletedAt: null, active: true }, orderBy: { id: 'asc' } } } as const
    const base = { deletedAt: null, active: true } as const
    let products = await this.db.product.findMany({
      where: {
        ...base,
        OR: [
          { barcode: query },
          { sku: query },
          { internalCode: query },
          { variants: { some: { deletedAt: null, active: true, OR: [{ barcode: query }, { sku: query }] } } }
        ]
      },
      include
    })
    const exactCode = products.length > 0
    if (!exactCode) {
      const terms = normalizeSearch(query).split(' ').filter(Boolean)
      products = await this.db.product.findMany({
        where: { ...base, AND: terms.map((t) => ({ searchText: { contains: t } })) },
        include,
        orderBy: { name: 'asc' },
        take: limit
      })
    }
    const items: PdvItem[] = []
    for (const p of products) {
      const common = {
        productId: p.id,
        internalCode: p.internalCode,
        name: p.name,
        unit: p.unit,
        allowNegativeStock: p.allowNegativeStock,
        salePriceCents: p.salePriceCents,
        promoPriceCents: p.promoPriceCents,
        promoStartsAt: p.promoStartsAt?.toISOString() ?? null,
        promoEndsAt: p.promoEndsAt?.toISOString() ?? null,
        wholesalePriceCents: p.wholesalePriceCents,
        wholesaleMinMilli: p.wholesaleMinMilli,
        imageUrl: productImageUrl(p.imagePath)
      }
      if (!p.hasVariants) {
        items.push({ ...common, variantId: null, variantName: null, barcode: p.barcode, stockMilli: p.stockMilli, variantPriceCents: null })
        continue
      }
      // Código de uma variação traz só ela; código do produto (ou busca por nome) traz todas
      const hits = exactCode ? p.variants.filter((v) => v.barcode === query || v.sku === query) : []
      for (const v of hits.length ? hits : p.variants) {
        items.push({ ...common, variantId: v.id, variantName: v.name, barcode: v.barcode, stockMilli: v.stockMilli, variantPriceCents: v.salePriceCents })
      }
    }
    return items.slice(0, limit)
  }

  async sellers(actorInput: Actor | null): Promise<SellerDto[]> {
    requirePermission(actorInput, 'pdv.sell')
    const users = await this.db.user.findMany({
      where: { active: true, OR: [{ role: { key: 'ADMIN' } }, { role: { permissions: { some: { permissionKey: 'pdv.sell' } } } }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    })
    return users
  }

  // ───────────── Cálculo ─────────────

  /** Preço autoritativo da venda: o servidor recalcula preços, descontos e total. */
  private async price(db: DbClient, data: PreviewData) {
    const now = this.now()
    const ids = [...new Set(data.items.map((i) => i.productId))]
    const products = await db.product.findMany({ where: { id: { in: ids } }, include: { variants: true } })
    const byId = new Map(products.map((p) => [p.id, p]))

    const lines = data.items.map((item, index) => {
      const p = byId.get(item.productId)
      if (!p || p.deletedAt || !p.active) throw validationError(`Produto indisponível para venda (item ${index + 1}).`)
      if (p.hasVariants && !item.variantId) throw validationError(`Selecione a variação de "${p.name}".`)
      if (!p.hasVariants && item.variantId) throw validationError(`"${p.name}" não possui variações.`)
      const v = item.variantId ? p.variants.find((x) => x.id === item.variantId) : null
      if (item.variantId && (!v || v.deletedAt || !v.active)) throw validationError(`Variação indisponível de "${p.name}".`)
      const { unitPriceCents, kind } = unitPriceFor({ ...p, variantPriceCents: v?.salePriceCents ?? null }, item.quantityMilli, now)
      const grossCents = lineGross(unitPriceCents, item.quantityMilli)
      if (item.discountCents > grossCents) throw validationError(`O desconto do item "${p.name}" é maior que o valor do item.`)
      return {
        index,
        product: p,
        variant: v ?? null,
        description: v ? `${p.name} — ${v.name}` : p.name,
        quantityMilli: item.quantityMilli,
        unitPriceCents,
        priceKind: kind,
        grossCents,
        discountCents: item.discountCents,
        totalCents: grossCents - item.discountCents,
        unitCostCents: totalUnitCost({ ...p, costCents: v?.costCents ?? p.costCents })
      }
    })
    const subtotalCents = lines.reduce((a, l) => a + l.grossCents, 0)
    const itemsDiscountCents = lines.reduce((a, l) => a + l.discountCents, 0)
    if (data.discountCents > subtotalCents - itemsDiscountCents) throw validationError('O desconto é maior que o valor da venda.')
    const totalCents = subtotalCents - itemsDiscountCents - data.discountCents
    const discount = itemsDiscountCents + data.discountCents
    return {
      lines,
      subtotalCents,
      itemsDiscountCents,
      saleDiscountCents: data.discountCents,
      totalCents,
      discountCents: discount,
      // Exibição: arredondamento normal. Limite: comparação exata com exceedsLimit()
      discountBps: subtotalCents > 0 ? Math.round((discount * 10000) / subtotalCents) : 0,
      /** Menor limite (bps) que cobre este desconto, sem arredondar a favor do operador. */
      requiredBps: subtotalCents > 0 ? Math.ceil((discount * 10000) / subtotalCents) : 0
    }
  }

  /** Venda normal: preço vigente. Venda de pedido/orçamento: itens e preços combinados no documento. */
  private async pricing(db: DbClient, data: z.output<typeof saleFinalizeSchema>) {
    if (data.orderId === null && data.quoteId === null) {
      return { ...(await this.price(db, data)), customerId: data.customerId, discountAuthorizedById: null as number | null }
    }
    return this.sourcePricing(db, data.orderId !== null ? { type: 'ORDER', id: data.orderId } : { type: 'QUOTE', id: data.quoteId! })
  }

  private async sourcePricing(db: DbClient, src: { type: 'ORDER' | 'QUOTE'; id: number }) {
    const include = { items: { include: { product: { include: { variants: true } } }, orderBy: { id: 'asc' as const } } }
    let doc: {
      customerId: number | null
      subtotalCents: number
      discountCents: number
      totalCents: number
      discountAuthorizedById: number | null
      items: { productId: number | null; variantId: number | null; description: string; quantityMilli: number; unitPriceCents: number; discountCents: number; totalCents: number; product: (Prisma.ProductGetPayload<{ include: { variants: true } }>) | null }[]
    }
    if (src.type === 'ORDER') {
      const o = await db.order.findUnique({ where: { id: src.id }, include })
      if (!o) throw notFound('Pedido não encontrado.')
      if (o.status === 'CANCELLED') throw conflict('Pedido cancelado não pode ser vendido.')
      const sold = await db.sale.findFirst({ where: { orderId: o.id } })
      if (sold) throw conflict(`Pedido já convertido na venda #${sold.id}.`)
      doc = o
    } else {
      const q = await db.quote.findUnique({ where: { id: src.id }, include: { ...include, order: true, sale: true } })
      if (!q) throw notFound('Orçamento não encontrado.')
      if (q.sale) throw conflict(`Orçamento já convertido na venda #${q.sale.id}.`)
      if (q.order) throw conflict(`Orçamento já convertido no pedido #${q.order.id}. Venda o pedido.`)
      const status = effectiveQuoteStatus(q)
      if (status === 'EXPIRED') throw conflict('Orçamento expirado. Atualize a validade antes de vender.')
      if (status === 'REJECTED') throw conflict('Orçamento recusado não pode ser vendido.')
      if (q.items.some((i) => i.productId === null)) throw conflict('O orçamento tem itens de texto livre. Substitua-os por produtos ou serviços cadastrados.')
      doc = q
    }
    const lines = doc.items.map((i, index) => {
      const p = i.product!
      if (p.deletedAt) throw conflict(`O produto "${i.description}" foi excluído e não pode ser vendido.`)
      const v = i.variantId ? p.variants.find((x) => x.id === i.variantId) ?? null : null
      if (i.variantId && (!v || v.deletedAt)) throw conflict(`A variação de "${i.description}" foi excluída.`)
      const grossCents = i.totalCents + i.discountCents
      return {
        index,
        product: p,
        variant: v,
        description: i.description,
        quantityMilli: i.quantityMilli,
        unitPriceCents: i.unitPriceCents,
        priceKind: 'retail' as const,
        grossCents,
        discountCents: i.discountCents,
        totalCents: i.totalCents,
        unitCostCents: totalUnitCost({ ...p, costCents: v?.costCents ?? p.costCents })
      }
    })
    return {
      lines,
      subtotalCents: doc.subtotalCents,
      itemsDiscountCents: doc.discountCents,
      saleDiscountCents: 0,
      totalCents: doc.totalCents,
      discountCents: doc.discountCents,
      discountBps: 0,
      requiredBps: 0,
      customerId: doc.customerId,
      discountAuthorizedById: doc.discountAuthorizedById
    }
  }

  /** Dados de um pedido/orçamento para o PDV (itens e valores somente leitura). */
  async source(actorInput: Actor | null, input: unknown): Promise<SaleSource> {
    requirePermission(actorInput, 'pdv.sell')
    const { orderId, quoteId } = (input ?? {}) as { orderId?: number; quoteId?: number }
    if (!Number.isInteger(orderId) && !Number.isInteger(quoteId)) throw validationError('Informe o pedido ou o orçamento.')
    const src = Number.isInteger(orderId) ? ({ type: 'ORDER', id: orderId! } as const) : ({ type: 'QUOTE', id: quoteId! } as const)
    const p = await this.sourcePricing(this.db, src)
    const customer = p.customerId ? await this.db.customer.findUnique({ where: { id: p.customerId }, select: { id: true, name: true, document: true, phone: true } }) : null
    return {
      type: src.type,
      id: src.id,
      customer,
      lines: p.lines.map((l) => ({
        description: l.description,
        unit: l.product.unit,
        quantityMilli: l.quantityMilli,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        totalCents: l.totalCents
      })),
      subtotalCents: p.subtotalCents,
      discountCents: p.discountCents,
      totalCents: p.totalCents
    }
  }

  private async discountLimit(actor: Actor): Promise<number> {
    if (!actor.permissions.has('pdv.discount')) return 0
    return (await this.auth.loadActor(actor.userId)).session.maxDiscountBps
  }

  async preview(actorInput: Actor | null, input: unknown): Promise<SalePreview> {
    const actor = requirePermission(actorInput, 'pdv.sell')
    const data = salePreviewSchema.parse(input)
    const r = await this.price(this.db, data)
    const maxDiscountBps = await this.discountLimit(actor)
    return {
      lines: r.lines.map((l) => ({
        index: l.index,
        description: l.description,
        unitPriceCents: l.unitPriceCents,
        priceKind: l.priceKind,
        grossCents: l.grossCents,
        discountCents: l.discountCents,
        totalCents: l.totalCents
      })),
      subtotalCents: r.subtotalCents,
      itemsDiscountCents: r.itemsDiscountCents,
      saleDiscountCents: r.saleDiscountCents,
      totalCents: r.totalCents,
      discountBps: r.discountBps,
      maxDiscountBps,
      requiresAuthorization: r.discountCents > 0 && r.requiredBps > maxDiscountBps
    }
  }

  // ───────────── Finalização ─────────────

  async finalize(actorInput: Actor | null, input: unknown): Promise<SaleDetail> {
    const actor = requirePermission(actorInput, 'pdv.sell')
    const data = saleFinalizeSchema.parse(input)

    const already = await this.db.sale.findUnique({ where: { idempotencyKey: data.requestId } })
    if (already) return { ...(await this.detail(this.db, already.id)), duplicate: true }

    const fromSource = data.orderId !== null || data.quoteId !== null
    if (data.orderId !== null && data.quoteId !== null) throw validationError('Informe o pedido ou o orçamento, não ambos.')
    if (!fromSource && data.items.length === 0) throw validationError('Adicione ao menos um item.')
    // Desconto acima do limite do operador exige autorização de supervisor
    // (pedidos/orçamentos: o desconto já foi autorizado na criação do documento)
    const pricing = await this.pricing(this.db, data)
    let authorizerId: number | null = null
    if (!fromSource && pricing.discountCents > 0 && pricing.requiredBps > (await this.discountLimit(actor))) {
      if (!data.authorization) {
        throw forbidden(`Desconto de ${(pricing.discountBps / 100).toLocaleString('pt-BR')}% acima do seu limite. É necessária a autorização de um supervisor.`)
      }
      const authorizer = await this.auth.verifyAuthorizer(data.authorization, 'pdv.discount', {
        action: 'sale.discount',
        requestedBy: actor.userId,
        minDiscountBps: pricing.requiredBps
      })
      authorizerId = authorizer.userId
    }

    const saleId = await this.db.$transaction(async (tx) => {
      // Repetição concorrente: a segunda finalização encontra a primeira dentro da transação
      const race = await tx.sale.findUnique({ where: { idempotencyKey: data.requestId } })
      if (race) return race.id

      const session = await requireOpenSession(tx, actor.userId)
      const p = await this.pricing(tx, data) // recalculado dentro da transação
      if (p.totalCents !== pricing.totalCents) throw conflict('Os preços mudaram durante a venda. Revise o carrinho.')
      if (p.totalCents <= 0) throw validationError('O total da venda deve ser maior que zero.')

      const customerId = fromSource ? p.customerId : data.customerId
      if (!fromSource && customerId && !(await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } }))) {
        throw validationError('Cliente inválido.')
      }
      if (data.sellerId && !(await tx.user.findFirst({ where: { id: data.sellerId, active: true } }))) {
        throw validationError('Vendedor inválido.')
      }

      // ── Pagamentos ──
      const vouchers = new Map<string, number>()
      for (const pay of data.payments) {
        if (pay.method !== 'CREDIT_CARD' && pay.method !== 'STORE_CREDIT' && pay.installments > 1) throw validationError('Parcelamento só é permitido no cartão de crédito e no crediário.')
        if (pay.method === 'VOUCHER') {
          if (!pay.voucherCode) throw validationError('Informe o código do vale-troca.')
          vouchers.set(pay.voucherCode.toUpperCase(), (vouchers.get(pay.voucherCode.toUpperCase()) ?? 0) + pay.amountCents)
        }
      }
      const voucherReturns = new Map<string, number>()
      for (const [code, amount] of vouchers) {
        const v = await tx.saleReturn.findUnique({ where: { voucherCode: code } })
        if (!v) throw validationError(`Vale-troca ${code} não encontrado.`)
        if (v.voucherBalanceCents < amount) throw validationError(`Saldo insuficiente no vale-troca ${code}: ${formatMoney(v.voucherBalanceCents)}.`)
        voucherReturns.set(code, v.id)
      }
      const credit = data.payments.filter((x) => x.method === 'STORE_CREDIT')
      if (credit.length > 1) throw validationError('Use uma única linha de crediário (com o número de parcelas).')
      if (credit.length === 1) {
        if (!customerId) throw validationError('Identifique o cliente para vender no crediário.')
        const c = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null, active: true, anonymizedAt: null } })
        if (!c || c.creditLimitCents === null) throw conflict('Este cliente não tem crediário liberado. Defina um limite no cadastro do cliente.')
        const available = c.creditLimitCents - (await customerOpenBalance(tx, customerId))
        if (credit[0].amountCents > available) throw conflict(`Limite de crediário insuficiente: disponível ${formatMoney(Math.max(available, 0))}.`)
      }
      const cashPaid = data.payments.filter((x) => x.method === 'CASH').reduce((a, x) => a + x.amountCents, 0)
      const nonCash = data.payments.filter((x) => x.method !== 'CASH').reduce((a, x) => a + x.amountCents, 0)
      if (nonCash > p.totalCents) throw validationError('Pagamentos em cartão, PIX, crediário, vale ou outros não podem exceder o total. Troco só em dinheiro.')
      const paidCents = cashPaid + nonCash
      if (paidCents < p.totalCents) throw validationError(`Pagamento insuficiente: faltam ${formatMoney(p.totalCents - paidCents)}.`)
      const changeCents = paidCents - p.totalCents

      // ── Venda e itens (desconto geral rateado entre os itens) ──
      const allocated = allocate(p.saleDiscountCents, p.lines.map((l) => l.totalCents))
      const sale = await tx.sale.create({
        data: {
          userId: actor.userId,
          sellerId: data.sellerId,
          customerId,
          customerDocument: data.customerDocument,
          cashSessionId: session.id,
          orderId: data.orderId,
          quoteId: data.quoteId,
          subtotalCents: p.subtotalCents,
          discountCents: p.discountCents,
          totalCents: p.totalCents,
          paidCents,
          changeCents,
          costTotalCents: p.lines.reduce((a, l) => a + Math.round((l.unitCostCents * l.quantityMilli) / 1000), 0),
          notes: data.notes,
          idempotencyKey: data.requestId,
          discountAuthorizedById: fromSource ? p.discountAuthorizedById : authorizerId
        }
      })
      if (data.quoteId) await tx.quote.update({ where: { id: data.quoteId }, data: { status: 'APPROVED', decidedAt: new Date() } })
      for (const [i, l] of p.lines.entries()) {
        const discountCents = l.discountCents + allocated[i]
        const item = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: l.product.id,
            variantId: l.variant?.id ?? null,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            unitCostCents: l.unitCostCents,
            discountCents,
            totalCents: l.grossCents - discountCents
          }
        })
        if (l.product.isService) continue // serviços não têm estoque
        await moveStock(tx, {
          productId: l.product.id,
          variantId: l.variant?.id ?? null,
          type: 'SALE',
          quantityMilli: -l.quantityMilli,
          reason: `Venda #${sale.id}`,
          referenceType: 'SALE',
          referenceId: String(sale.id),
          idempotencyKey: `SALE:${sale.id}:${item.id}`,
          userId: actor.userId,
          unitCostCents: l.unitCostCents
        })
      }

      for (const pay of data.payments) {
        const code = pay.voucherCode?.toUpperCase()
        await tx.payment.create({
          data: {
            saleId: sale.id,
            method: pay.method,
            methodLabel: pay.label,
            ...(['PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'].includes(pay.method) ? { nsu: pay.nsu, authorizationCode: pay.authorizationCode, cardBrand: pay.cardBrand } : {}),
            amountCents: pay.amountCents,
            installments: pay.installments,
            voucherReturnId: pay.method === 'VOUCHER' ? voucherReturns.get(code!)! : null
          }
        })
      }
      if (credit.length === 1) {
        const firstDue = credit[0].firstDueDate ? fromDateKey(credit[0].firstDueDate)! : addDays(startOfDay(new Date()), 30)
        await createSaleInstallments(tx, { id: sale.id, customerId: customerId!, userId: actor.userId }, credit[0].amountCents, credit[0].installments, firstDue)
      }
      for (const [code, amount] of vouchers) {
        const updated = await tx.saleReturn.updateMany({
          where: { voucherCode: code, voucherBalanceCents: { gte: amount } },
          data: { voucherBalanceCents: { decrement: amount } }
        })
        if (updated.count !== 1) throw conflict(`O saldo do vale-troca ${code} mudou. Tente novamente.`)
      }

      // ── Caixa: entradas por forma de pagamento (dinheiro líquido do troco) ──
      for (const method of MONEY_METHODS) {
        const sum = data.payments.filter((x) => x.method === method).reduce((a, x) => a + x.amountCents, 0)
        const amount = method === 'CASH' ? sum - changeCents : sum
        if (amount === 0) continue
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'SALE',
            method,
            amountCents: amount,
            description: `Venda #${sale.id}`,
            referenceType: 'SALE',
            referenceId: String(sale.id),
            idempotencyKey: `SALE:${sale.id}:${method}`,
            userId: actor.userId
          }
        })
      }

      await writeAudit(tx, {
        userId: actor.userId,
        action: 'sale.create',
        entity: 'Sale',
        entityId: sale.id,
        details: {
          totalCents: p.totalCents,
          discountCents: p.discountCents,
          items: p.lines.length,
          payments: data.payments.map((x) => x.method),
          discountAuthorizedBy: authorizerId
        }
      })
      return sale.id
    })
    return this.detail(this.db, saleId)
  }

  // ───────────── Cancelamento ─────────────

  async cancel(actorInput: Actor | null, input: unknown): Promise<SaleDetail> {
    const actor = requirePermission(actorInput, 'pdv.sell', 'pdv.cancel')
    const data = saleCancelSchema.parse(input)
    const sale = await this.db.sale.findUnique({ where: { id: data.saleId }, include: { returns: true } })
    if (!sale) throw notFound('Venda não encontrada.')
    if (sale.status === 'CANCELLED') throw conflict('Esta venda já foi cancelada.')
    if (sale.returns.length > 0) throw conflict('Esta venda possui devoluções. Use a devolução para os itens restantes.')

    let authorizer = actor
    if (!actor.permissions.has('pdv.cancel')) {
      if (!data.authorization) throw forbidden('O cancelamento precisa da autorização de um supervisor.')
      authorizer = await this.auth.verifyAuthorizer(data.authorization, 'pdv.cancel', { action: 'sale.cancel', requestedBy: actor.userId })
    }

    await this.db.$transaction(async (tx) => {
      const current = await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: { include: { product: { select: { isService: true } } } }, payments: true } })
      if (current.status === 'CANCELLED') throw conflict('Esta venda já foi cancelada.')
      await onSaleCancelled(tx, sale.id)
      const installments = await tx.accountReceivable.findMany({ where: { saleId: sale.id, status: { not: 'CANCELLED' } } })
      if (installments.some((i) => i.receivedCents > 0)) {
        throw conflict('Há parcelas do crediário já recebidas. Estorne os recebimentos em Contas a receber antes de cancelar a venda.')
      }
      await tx.accountReceivable.updateMany({
        where: { saleId: sale.id, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Venda #${sale.id} cancelada` }
      })
      const hasMoney = current.payments.some((pay) => MONEY_METHODS.includes(pay.method))
      const session = hasMoney ? await requireOpenSession(tx, actor.userId) : null
      // O dinheiro da venda volta ao cliente a partir da gaveta de quem cancela: ela precisa ter o valor
      const cashBack = current.payments.filter((x) => x.method === 'CASH').reduce((a, x) => a + x.amountCents, 0) - current.changeCents
      if (session && cashBack > 0) {
        const drawer = await drawerBalance(tx, session)
        if (drawer < cashBack) throw conflict(`Dinheiro insuficiente na gaveta para devolver ${formatMoney(cashBack)} (disponível ${formatMoney(drawer)}).`)
      }

      for (const item of current.items) {
        if (item.product.isService) continue
        await moveStock(tx, {
          productId: item.productId,
          variantId: item.variantId,
          type: 'SALE_CANCEL',
          quantityMilli: item.quantityMilli,
          reason: `Cancelamento da venda #${sale.id}: ${data.reason}`,
          referenceType: 'SALE',
          referenceId: String(sale.id),
          idempotencyKey: `SALE_CANCEL:${sale.id}:${item.id}`,
          userId: actor.userId,
          unitCostCents: item.unitCostCents,
          allowNegative: true
        })
      }
      if (session) {
        for (const method of MONEY_METHODS) {
          const sum = current.payments.filter((x) => x.method === method).reduce((a, x) => a + x.amountCents, 0)
          const amount = method === 'CASH' ? sum - current.changeCents : sum
          if (amount === 0) continue
          await tx.cashMovement.create({
            data: {
              cashSessionId: session.id,
              type: 'SALE_CANCEL',
              method,
              amountCents: -amount,
              description: `Cancelamento da venda #${sale.id}`,
              referenceType: 'SALE',
              referenceId: String(sale.id),
              idempotencyKey: `SALE_CANCEL:${sale.id}:${method}`,
              userId: actor.userId
            }
          })
        }
      }
      for (const pay of current.payments) {
        if (pay.method === 'VOUCHER' && pay.voucherReturnId) {
          await tx.saleReturn.update({ where: { id: pay.voucherReturnId }, data: { voucherBalanceCents: { increment: pay.amountCents } } })
        }
      }
      await tx.payment.updateMany({ where: { saleId: sale.id }, data: { status: 'CANCELLED' } })
      await tx.sale.update({
        where: { id: sale.id },
        // Desvincula pedido/orçamento de origem: o documento pode ser vendido novamente
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: authorizer.userId, cancelReason: data.reason, orderId: null, quoteId: null }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'sale.cancel',
        entity: 'Sale',
        entityId: sale.id,
        details: { reason: data.reason, authorizedBy: authorizer.userId, totalCents: current.totalCents, orderId: current.orderId, quoteId: current.quoteId }
      })
    })
    return this.detail(this.db, sale.id)
  }

  // ───────────── Devolução / troca ─────────────

  async returnItems(actorInput: Actor | null, input: unknown): Promise<SaleReturnResult> {
    const actor = requirePermission(actorInput, 'pdv.sell', 'pdv.return')
    const data = saleReturnSchema.parse(input)
    const existing = await this.db.saleReturn.findUnique({ where: { idempotencyKey: data.requestId } })
    if (existing) {
      return { returnId: existing.id, refundMethod: existing.refundMethod, refundCents: existing.refundCents, voucherCode: existing.voucherCode, duplicate: true }
    }
    let authorizer = actor
    if (!actor.permissions.has('pdv.return')) {
      if (!data.authorization) throw forbidden('A devolução precisa da autorização de um supervisor.')
      authorizer = await this.auth.verifyAuthorizer(data.authorization, 'pdv.return', { action: 'sale.return', requestedBy: actor.userId })
    }

    const result = await this.db.$transaction(async (tx) => {
      const race = await tx.saleReturn.findUnique({ where: { idempotencyKey: data.requestId } })
      if (race) return { returnId: race.id, refundMethod: race.refundMethod, refundCents: race.refundCents, voucherCode: race.voucherCode, duplicate: true }

      const sale = await tx.sale.findUnique({ where: { id: data.saleId }, include: { items: { include: { returnItems: true, product: { select: { isService: true } } } }, payments: true } })
      if (!sale) throw notFound('Venda não encontrada.')
      if (sale.status !== 'COMPLETED') throw conflict('Só é possível devolver itens de vendas concluídas.')
      if (data.refundMethod === 'STORE_CREDIT' && !sale.payments.some((p) => p.method === 'STORE_CREDIT')) {
        throw validationError('Abater do crediário só é possível em vendas feitas no crediário.')
      }

      const seen = new Set<number>()
      const lines = data.items.map((r) => {
        if (seen.has(r.saleItemId)) throw validationError('Item repetido na devolução.')
        seen.add(r.saleItemId)
        const item = sale.items.find((i) => i.id === r.saleItemId)
        if (!item) throw validationError('Item não pertence a esta venda.')
        const returnedQty = item.returnItems.reduce((a, x) => a + x.quantityMilli, 0)
        const returnedAmount = item.returnItems.reduce((a, x) => a + x.amountCents, 0)
        const remaining = item.quantityMilli - returnedQty
        if (r.quantityMilli > remaining) throw validationError(`"${item.description}": só é possível devolver mais ${remaining / 1000}.`)
        // Último lote devolvido recebe o restante exato (sem sobra de centavos)
        const amountCents = r.quantityMilli === remaining ? item.totalCents - returnedAmount : Math.round((item.totalCents * r.quantityMilli) / item.quantityMilli)
        return { item, quantityMilli: r.quantityMilli, amountCents }
      })
      const refundCents = data.refundMethod === 'NONE' ? 0 : lines.reduce((a, l) => a + l.amountCents, 0)

      const needsSession = ['CASH', 'PIX', 'CARD'].includes(data.refundMethod) && refundCents > 0
      const session = needsSession ? await requireOpenSession(tx, actor.userId) : null
      if (session && data.refundMethod === 'CASH') {
        const drawer = await drawerBalance(tx, session)
        if (drawer < refundCents) throw conflict(`Dinheiro insuficiente no caixa para o reembolso (${formatMoney(drawer)} disponível).`)
      }

      if (data.refundMethod === 'STORE_CREDIT' && refundCents > 0) await abateInstallments(tx, sale.id, refundCents)

      let voucherCode: string | null = null
      if (data.refundMethod === 'VOUCHER') {
        do voucherCode = 'VT' + randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
        while (await tx.saleReturn.findUnique({ where: { voucherCode } }))
      }

      const ret = await tx.saleReturn.create({
        data: {
          saleId: sale.id,
          userId: actor.userId,
          cashSessionId: session?.id ?? null,
          reason: data.reason,
          refundMethod: data.refundMethod,
          refundCents,
          voucherCode,
          voucherBalanceCents: data.refundMethod === 'VOUCHER' ? refundCents : 0,
          idempotencyKey: data.requestId,
          items: { create: lines.map((l) => ({ saleItemId: l.item.id, quantityMilli: l.quantityMilli, amountCents: l.amountCents })) }
        }
      })
      for (const l of lines) {
        if (l.item.product.isService) continue
        await moveStock(tx, {
          productId: l.item.productId,
          variantId: l.item.variantId,
          type: 'RETURN',
          quantityMilli: l.quantityMilli,
          reason: `Devolução da venda #${sale.id}: ${data.reason}`,
          referenceType: 'RETURN',
          referenceId: String(ret.id),
          idempotencyKey: `RETURN:${ret.id}:${l.item.id}`,
          userId: actor.userId,
          unitCostCents: l.item.unitCostCents,
          allowNegative: true
        })
      }
      if (session) {
        const method: PaymentMethod =
          data.refundMethod === 'CASH'
            ? 'CASH'
            : data.refundMethod === 'PIX'
              ? 'PIX'
              : (sale.payments.find((p) => p.method === 'CREDIT_CARD' || p.method === 'DEBIT_CARD')?.method ?? 'CREDIT_CARD')
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: 'RETURN_REFUND',
            method,
            amountCents: -refundCents,
            description: `Reembolso da devolução #${ret.id} (venda #${sale.id})`,
            referenceType: 'RETURN',
            referenceId: String(ret.id),
            idempotencyKey: `RETURN:${ret.id}`,
            userId: actor.userId
          }
        })
      }
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'sale.return',
        entity: 'Sale',
        entityId: sale.id,
        details: { returnId: ret.id, refundMethod: data.refundMethod, refundCents, authorizedBy: authorizer.userId, reason: data.reason }
      })
      return { returnId: ret.id, refundMethod: ret.refundMethod, refundCents, voucherCode, duplicate: false }
    })
    return result
  }

  async voucher(actorInput: Actor | null, input: unknown): Promise<VoucherDto | null> {
    requirePermission(actorInput, 'pdv.sell')
    const { code } = voucherLookupSchema.parse(input)
    const v = await this.db.saleReturn.findUnique({ where: { voucherCode: code } })
    return v ? { code: v.voucherCode!, balanceCents: v.voucherBalanceCents, saleId: v.saleId, createdAt: v.createdAt.toISOString() } : null
  }

  // ───────────── Consultas ─────────────

  /** Quem não tem relatórios nem cancelamento vê apenas as próprias vendas. */
  private onlyOwn(actor: Actor): boolean {
    return !actor.permissions.has('reports.view') && !actor.permissions.has('pdv.cancel')
  }

  async list(actorInput: Actor | null, input: unknown): Promise<SaleListResult> {
    const actor = requirePermission(actorInput, 'pdv.sell', 'reports.view')
    const q = saleListSchema.parse(input ?? {})
    const and: Prisma.SaleWhereInput[] = []
    if (this.onlyOwn(actor)) and.push({ userId: actor.userId })
    else if (q.userId) and.push({ userId: q.userId })
    if (q.status) and.push({ status: q.status })
    if (q.from) and.push({ createdAt: { gte: fromDateKey(q.from)! } })
    if (q.to) and.push({ createdAt: { lte: fromDateKey(q.to, true)! } })
    if (q.search) {
      const n = Number(q.search.replace('#', ''))
      and.push({
        OR: [
          ...(Number.isInteger(n) && n > 0 ? [{ id: n }] : []),
          { customer: { name: { contains: q.search } } },
          { customerDocument: { contains: q.search.replace(/\D/g, '') || q.search } }
        ]
      })
    }
    const where = { AND: and }
    const [total, rows] = await Promise.all([
      this.db.sale.count({ where }),
      this.db.sale.findMany({
        where,
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true } },
          payments: { select: { method: true } },
          _count: { select: { items: true, returns: true } }
        },
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize
      })
    ])
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        status: s.status,
        totalCents: s.totalCents,
        itemCount: s._count.items,
        operatorName: s.user.name,
        customerName: s.customer?.name ?? null,
        paymentMethods: [...new Set(s.payments.map((p) => p.method))],
        hasReturns: s._count.returns > 0
      }))
    }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<SaleDetail> {
    const actor = requirePermission(actorInput, 'pdv.sell', 'reports.view')
    const id = Number((input as { id?: unknown } | null)?.id)
    if (!Number.isInteger(id) || id <= 0) throw validationError('Venda inválida.')
    const detail = await this.detail(this.db, id)
    const sale = await this.db.sale.findUniqueOrThrow({ where: { id }, select: { userId: true } })
    if (this.onlyOwn(actor) && sale.userId !== actor.userId) throw forbidden('Você só pode consultar as suas vendas.')
    return detail
  }

  async detail(db: DbClient, id: number): Promise<SaleDetail> {
    const s = await db.sale.findUnique({ where: { id }, include: detailInclude })
    if (!s) throw notFound('Venda não encontrada.')
    return toDetail(s)
  }
}
