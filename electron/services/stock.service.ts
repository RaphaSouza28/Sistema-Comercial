import type {
  StockItem,
  StockItemStatus,
  StockMovementDto,
  StockMovementsResult,
  StockOperationResult,
  StockOverviewResult,
  StockSummary
} from '@shared/api'
import { formatQuantity } from '@shared/format'
import { totalUnitCost } from '@shared/pricing'
import {
  EXIT_REASONS,
  stockAdjustSchema,
  stockEntrySchema,
  stockExitSchema,
  stockMovementsSchema,
  stockOverviewSchema,
  stockSearchSchema
} from '@shared/stockSchemas'
import { normalizeSearch } from '@shared/text'
import type { z } from 'zod'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { addPriceHistory } from '../repositories/product.repository'
import { getSetting } from '../repositories/setting.repository'
import { toCsv } from '../utils/csv'
import { addDays, startOfDay } from '../utils/dates'
import { forbidden, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { fromDateKey } from './product.mappers'
import { SETTINGS } from './setup.service'
import { moveStock } from './stockCore'

const STOCK_VIEW = ['stock.view', 'stock.manage'] as const

export const MOVEMENT_LABELS: Record<StockMovementDto['type'], string> = {
  INITIAL: 'Estoque inicial',
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  SALE: 'Venda',
  SALE_CANCEL: 'Cancelamento de venda',
  RETURN: 'Devolução',
  ADJUSTMENT: 'Ajuste',
  INVENTORY: 'Inventário'
}

const productInclude = {
  category: { select: { name: true } },
  variants: { where: { deletedAt: null }, orderBy: { id: 'asc' } }
} as const satisfies Prisma.ProductInclude
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>

export function statusOf(stockMilli: number, minStockMilli: number): StockItemStatus {
  if (stockMilli < 0) return 'negative'
  if (stockMilli === 0) return 'out'
  if (minStockMilli > 0 && stockMilli <= minStockMilli) return 'low'
  return 'ok'
}

/** Expande produtos em posições de estoque (o próprio produto ou cada variação). */
function toPositions(rows: ProductRow[], lastMovement: Map<string, Date>, canCost: boolean, includeInactive: boolean): StockItem[] {
  const out: StockItem[] = []
  for (const p of rows) {
    const base = {
      productId: p.id,
      internalCode: p.internalCode,
      name: p.name,
      unit: p.unit,
      categoryName: p.category?.name ?? null,
      allowNegativeStock: p.allowNegativeStock
    }
    const value = (stock: number, unitCost: number) => (canCost ? Math.round((Math.max(stock, 0) * unitCost) / 1000) : null)
    if (!p.hasVariants) {
      const unitCost = totalUnitCost(p)
      out.push({
        ...base,
        variantId: null,
        variantName: null,
        sku: p.sku,
        barcode: p.barcode,
        stockMilli: p.stockMilli,
        minStockMilli: p.minStockMilli,
        status: statusOf(p.stockMilli, p.minStockMilli),
        unitCostCents: canCost ? unitCost : null,
        stockValueCents: value(p.stockMilli, unitCost),
        lastMovementAt: lastMovement.get(`${p.id}:`)?.toISOString() ?? null,
        active: p.active
      })
      continue
    }
    for (const v of p.variants) {
      if (!includeInactive && !v.active) continue
      const unitCost = totalUnitCost({ ...p, costCents: v.costCents ?? p.costCents })
      out.push({
        ...base,
        variantId: v.id,
        variantName: v.name,
        sku: v.sku,
        barcode: v.barcode,
        stockMilli: v.stockMilli,
        minStockMilli: v.minStockMilli,
        status: statusOf(v.stockMilli, v.minStockMilli),
        unitCostCents: canCost ? unitCost : null,
        stockValueCents: value(v.stockMilli, unitCost),
        lastMovementAt: lastMovement.get(`${p.id}:${v.id}`)?.toISOString() ?? null,
        active: p.active && v.active
      })
    }
  }
  return out
}

type MovementFilter = z.output<typeof stockMovementsSchema>

export class StockService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ───────────── Consultas ─────────────

  /** Posições de estoque com custo, para o relatório de estoque. */
  async positionsForReport(actorInput: Actor | null, opts: { categoryId?: number; productIds?: number[] }): Promise<StockItem[]> {
    requirePermission(actorInput, 'reports.view')
    return this.loadPositions(true, { includeInactive: false, ...opts })
  }

  private async loadPositions(
    canCost: boolean,
    opts: { search?: string; categoryId?: number; includeInactive: boolean; productIds?: number[] }
  ): Promise<StockItem[]> {
    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null, isService: false }]
    if (!opts.includeInactive) and.push({ active: true })
    for (const term of normalizeSearch(opts.search).split(' ').filter(Boolean)) and.push({ searchText: { contains: term } })
    if (opts.categoryId) and.push({ OR: [{ categoryId: opts.categoryId }, { subcategoryId: opts.categoryId }] })
    if (opts.productIds) and.push({ id: { in: opts.productIds } })
    const rows = await this.db.product.findMany({ where: { AND: and }, include: productInclude, orderBy: { name: 'asc' } })
    const last = await this.db.stockMovement.groupBy({
      by: ['productId', 'variantId'],
      where: { productId: { in: rows.map((r) => r.id) } },
      _max: { createdAt: true }
    })
    const lastMovement = new Map(last.map((l) => [`${l.productId}:${l.variantId ?? ''}`, l._max.createdAt!]))
    return toPositions(rows, lastMovement, canCost, opts.includeInactive)
  }

  async overview(actorInput: Actor | null, input: unknown): Promise<StockOverviewResult> {
    const actor = requirePermission(actorInput, ...STOCK_VIEW)
    const q = stockOverviewSchema.parse(input ?? {})
    const canCost = actor.permissions.has('products.cost')
    const staleSince = addDays(startOfDay(this.now()), -q.staleDays)
    let items = await this.loadPositions(canCost, q)

    if (q.status === 'low') items = items.filter((i) => i.status !== 'ok')
    if (q.status === 'out') items = items.filter((i) => i.stockMilli <= 0)
    if (q.status === 'negative') items = items.filter((i) => i.stockMilli < 0)
    if (q.status === 'stale') items = items.filter((i) => !i.lastMovementAt || new Date(i.lastMovementAt) < staleSince)

    const dir = q.direction === 'asc' ? 1 : -1
    const key = (i: StockItem): string | number =>
      q.sort === 'stock' ? i.stockMilli : q.sort === 'value' ? (i.stockValueCents ?? 0) : q.sort === 'lastMovement' ? (i.lastMovementAt ?? '') : normalizeSearch(`${i.name} ${i.variantName ?? ''}`)
    items.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0))

    const start = (q.page - 1) * q.pageSize
    return { items: items.slice(start, start + q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize }
  }

  async summary(actorInput: Actor | null): Promise<StockSummary> {
    const actor = requirePermission(actorInput, ...STOCK_VIEW)
    const canCost = actor.permissions.has('products.cost')
    const staleDays = 90
    const staleSince = addDays(startOfDay(this.now()), -staleDays)
    const items = await this.loadPositions(canCost, { includeInactive: false })
    return {
      positions: items.length,
      stockValueCents: canCost ? items.reduce((acc, i) => acc + (i.stockValueCents ?? 0), 0) : null,
      lowCount: items.filter((i) => i.status === 'low').length,
      outCount: items.filter((i) => i.status === 'out').length,
      negativeCount: items.filter((i) => i.status === 'negative').length,
      staleCount: items.filter((i) => !i.lastMovementAt || new Date(i.lastMovementAt) < staleSince).length,
      staleDays,
      lowStockAlerts: await getSetting<boolean>(this.db, SETTINGS.lowStockAlerts, true)
    }
  }

  /** Busca para seletores: código exato (leitor de código de barras) ou nome. */
  async search(actorInput: Actor | null, input: unknown): Promise<StockItem[]> {
    const actor = requirePermission(actorInput, 'stock.view', 'stock.manage', 'products.view', 'pdv.sell')
    const { query, limit } = stockSearchSchema.parse(input)
    const canCost = actor.permissions.has('products.cost')
    const exactProducts = await this.db.product.findMany({
      where: {
        deletedAt: null,
        active: true,
        isService: false,
        OR: [
          { barcode: query },
          { sku: query },
          { internalCode: query },
          { variants: { some: { deletedAt: null, OR: [{ barcode: query }, { sku: query }] } } }
        ]
      },
      select: { id: true }
    })
    if (exactProducts.length) {
      const items = await this.loadPositions(canCost, { includeInactive: false, productIds: exactProducts.map((p) => p.id) })
      const exact = items.filter((i) => i.barcode === query || i.sku === query || (i.variantId === null && i.internalCode === query))
      // Código de produto com variações: lista todas as variações dele
      return (exact.length ? exact : items).slice(0, limit)
    }
    return (await this.loadPositions(canCost, { search: query, includeInactive: false })).slice(0, limit)
  }

  private movementWhere(q: MovementFilter): Prisma.StockMovementWhereInput {
    const and: Prisma.StockMovementWhereInput[] = []
    if (q.productId) and.push({ productId: q.productId })
    if (q.variantId) and.push({ variantId: q.variantId })
    if (q.type) and.push({ type: q.type })
    if (q.userId) and.push({ userId: q.userId })
    if (q.from) and.push({ createdAt: { gte: fromDateKey(q.from)! } })
    if (q.to) and.push({ createdAt: { lte: fromDateKey(q.to, true)! } })
    for (const term of normalizeSearch(q.search).split(' ').filter(Boolean)) {
      and.push({ OR: [{ product: { searchText: { contains: term } } }, { documentNumber: { contains: term } }] })
    }
    return { AND: and }
  }

  private async findMovements(q: MovementFilter, canCost: boolean, paginate: boolean) {
    const where = this.movementWhere(q)
    const [total, rows] = await Promise.all([
      this.db.stockMovement.count({ where }),
      this.db.stockMovement.findMany({
        where,
        include: {
          product: { select: { name: true, internalCode: true, unit: true } },
          variant: { select: { name: true } },
          user: { select: { name: true } },
          supplier: { select: { name: true } }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paginate ? (q.page - 1) * q.pageSize : 0,
        take: paginate ? q.pageSize : 50000
      })
    ])
    const items: StockMovementDto[] = rows.map((m) => ({
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      type: m.type,
      productId: m.productId,
      internalCode: m.product.internalCode,
      productName: m.product.name,
      variantName: m.variant?.name ?? null,
      unit: m.product.unit,
      quantityMilli: m.quantityMilli,
      balanceAfterMilli: m.balanceAfterMilli,
      unitCostCents: canCost ? m.unitCostCents : null,
      reason: m.reason,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      documentNumber: m.documentNumber,
      supplierName: m.supplier?.name ?? null,
      userName: m.user?.name ?? null
    }))
    return { total, items }
  }

  async movements(actorInput: Actor | null, input: unknown): Promise<StockMovementsResult> {
    const actor = requirePermission(actorInput, ...STOCK_VIEW)
    const q = stockMovementsSchema.parse(input ?? {})
    const { total, items } = await this.findMovements(q, actor.permissions.has('products.cost'), true)
    return { items, total, page: q.page, pageSize: q.pageSize }
  }

  async exportMovementsCsv(actorInput: Actor | null, input: unknown): Promise<{ csv: string; count: number }> {
    const actor = requirePermission(actorInput, ...STOCK_VIEW)
    const q = stockMovementsSchema.parse(input ?? {})
    const canCost = actor.permissions.has('products.cost')
    const { items } = await this.findMovements(q, canCost, false)
    const dt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
    const rows = items.map((m) => [
      dt.format(new Date(m.createdAt)),
      MOVEMENT_LABELS[m.type],
      m.internalCode,
      m.productName,
      m.variantName ?? '',
      formatQuantity(m.quantityMilli),
      formatQuantity(m.balanceAfterMilli),
      m.unit,
      ...(canCost ? [m.unitCostCents === null ? '' : (m.unitCostCents / 100).toFixed(2).replace('.', ',')] : []),
      m.reason ?? '',
      m.documentNumber ?? '',
      m.supplierName ?? '',
      m.userName ?? ''
    ])
    const header = ['data_hora', 'tipo', 'codigo', 'produto', 'variacao', 'quantidade', 'saldo', 'unidade', ...(canCost ? ['custo_unitario'] : []), 'motivo', 'documento', 'fornecedor', 'usuario']
    await writeAudit(this.db, { userId: actor.userId, action: 'stock.export_movements', details: { count: items.length } })
    return { csv: toCsv([header, ...rows]), count: items.length }
  }

  // ───────────── Operações ─────────────

  /** Entrada de mercadorias (compra), com atualização opcional do custo. */
  async entry(actorInput: Actor | null, input: unknown): Promise<StockOperationResult> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const data = stockEntrySchema.parse(input)
    const canCost = actor.permissions.has('products.cost')
    const informsCost = data.costUpdate !== 'none' || data.items.some((i) => i.unitCostCents !== null)
    if (informsCost && !canCost) throw forbidden('Você não tem permissão para informar ou alterar custos.')
    if (data.costUpdate !== 'none' && data.items.some((i) => i.unitCostCents === null)) {
      throw validationError('Informe o custo unitário de todos os itens para atualizar o custo dos produtos.')
    }

    return this.db.$transaction(async (tx) => {
      if (data.supplierId && !(await tx.supplier.findFirst({ where: { id: data.supplierId, deletedAt: null } }))) {
        throw validationError('Fornecedor inválido.', { supplierId: 'Fornecedor inválido' })
      }
      const warnings: string[] = []
      let movements = 0
      const reason = ['Entrada de mercadoria', data.documentNumber ? `documento ${data.documentNumber}` : null, data.notes]
        .filter(Boolean)
        .join(' — ')
      for (const [index, item] of data.items.entries()) {
        const r = await moveStock(tx, {
          productId: item.productId,
          variantId: item.variantId,
          type: 'ENTRY',
          quantityMilli: item.quantityMilli,
          reason,
          referenceType: 'ENTRY',
          referenceId: data.requestId,
          idempotencyKey: `ENTRY:${data.requestId}:${index}`,
          userId: actor.userId,
          unitCostCents: item.unitCostCents,
          supplierId: data.supplierId,
          documentNumber: data.documentNumber
        })
        if (r.duplicate) continue
        movements++
        if (data.costUpdate !== 'none' && item.unitCostCents !== null) {
          const w = await this.updateCost(tx, actor, item, data.costUpdate, r.balanceBeforeMilli)
          if (w) warnings.push(w)
        }
      }
      if (movements === 0) return { movements: 0, warnings: ['Esta entrada já havia sido registrada.'] }
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'stock.entry',
        entity: 'StockEntry',
        entityId: data.requestId,
        details: { items: data.items.length, supplierId: data.supplierId, documentNumber: data.documentNumber, costUpdate: data.costUpdate }
      })
      return { movements, warnings }
    })
  }

  /** Atualiza o custo de aquisição (último custo ou média ponderada) e registra no histórico de preços. */
  private async updateCost(
    tx: DbClient,
    actor: Actor,
    item: { productId: number; variantId: number | null; quantityMilli: number; unitCostCents: number | null },
    mode: 'last' | 'average',
    variantStockBefore: number
  ): Promise<string | null> {
    const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
    const variant = item.variantId ? await tx.productVariant.findUniqueOrThrow({ where: { id: item.variantId } }) : null
    const ownVariantCost = variant !== null && variant.costCents !== null
    const oldCost = ownVariantCost ? variant!.costCents! : product.costCents
    // Estoque anterior da "fonte" do custo: a própria variação, ou o produto inteiro
    const stockBefore = ownVariantCost ? variantStockBefore : product.stockMilli - item.quantityMilli
    const incoming = item.unitCostCents!
    const base = Math.max(stockBefore, 0)
    const newCost = mode === 'last' || base === 0 ? incoming : Math.round((base * oldCost + item.quantityMilli * incoming) / (base + item.quantityMilli))
    if (newCost === oldCost) return null

    if (ownVariantCost) await tx.productVariant.update({ where: { id: variant!.id }, data: { costCents: newCost } })
    else await tx.product.update({ where: { id: product.id }, data: { costCents: newCost } })
    await addPriceHistory(tx, [
      {
        productId: product.id,
        variantId: ownVariantCost ? variant!.id : null,
        field: 'COST',
        oldCents: oldCost,
        newCents: newCost,
        reason: mode === 'last' ? 'Entrada de mercadoria (último custo)' : 'Entrada de mercadoria (custo médio)',
        userId: actor.userId
      }
    ])
    return product.pricingMode === 'AUTOMATIC'
      ? `O custo de "${product.name}" mudou. O preço automático só será recalculado quando o produto for salvo — revise o preço.`
      : null
  }

  async exit(actorInput: Actor | null, input: unknown): Promise<StockOperationResult> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const data = stockExitSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const reason = [EXIT_REASONS[data.reason], data.notes].filter(Boolean).join(' — ')
      let movements = 0
      for (const [index, item] of data.items.entries()) {
        const r = await moveStock(tx, {
          productId: item.productId,
          variantId: item.variantId,
          type: 'EXIT',
          quantityMilli: -item.quantityMilli,
          reason,
          referenceType: 'EXIT',
          referenceId: data.requestId,
          idempotencyKey: `EXIT:${data.requestId}:${index}`,
          userId: actor.userId
        })
        if (!r.duplicate) movements++
      }
      if (movements === 0) return { movements: 0, warnings: ['Esta saída já havia sido registrada.'] }
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'stock.exit',
        entity: 'StockExit',
        entityId: data.requestId,
        details: { reason: data.reason, items: data.items.length }
      })
      return { movements, warnings: [] }
    })
  }

  /** Ajuste manual: define o saldo para a quantidade informada, registrando a diferença. */
  async adjust(actorInput: Actor | null, input: unknown): Promise<StockOperationResult> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const data = stockAdjustSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const key = `ADJ:${data.requestId}`
      if (await tx.stockMovement.findUnique({ where: { idempotencyKey: key } })) {
        return { movements: 0, warnings: ['Este ajuste já havia sido registrado.'] }
      }
      const product = await tx.product.findFirst({ where: { id: data.productId, deletedAt: null } })
      if (!product) throw notFound('Produto não encontrado.')
      const variant = data.variantId ? await tx.productVariant.findFirst({ where: { id: data.variantId, productId: product.id, deletedAt: null } }) : null
      const current = variant ? variant.stockMilli : product.stockMilli
      const delta = data.newQuantityMilli - current
      if (delta === 0) throw validationError(`O estoque já é ${formatQuantity(current)} ${product.unit}.`)
      await moveStock(tx, {
        productId: data.productId,
        variantId: data.variantId,
        type: 'ADJUSTMENT',
        quantityMilli: delta,
        reason: data.reason,
        referenceType: 'ADJUSTMENT',
        referenceId: data.requestId,
        idempotencyKey: key,
        userId: actor.userId,
        allowNegative: true // o saldo final é a quantidade informada (≥ 0)
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'stock.adjust',
        entity: 'Product',
        entityId: data.productId,
        details: { variantId: data.variantId, from: current, to: data.newQuantityMilli, reason: data.reason }
      })
      return { movements: 1, warnings: [] }
    })
  }
}
