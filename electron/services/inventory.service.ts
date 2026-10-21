import type { InventoryDetail, InventorySummaryDto } from '@shared/api'
import { inventoryCountsSchema, inventoryCreateSchema, inventoryIdSchema } from '@shared/stockSchemas'
import { isFractionalUnit } from '@shared/units'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { moveStock } from './stockCore'

const summaryInclude = {
  category: { select: { name: true } },
  createdBy: { select: { name: true } },
  appliedBy: { select: { name: true } },
  _count: { select: { items: true } }
} as const satisfies Prisma.InventoryCountInclude

type SummaryRow = Prisma.InventoryCountGetPayload<{ include: typeof summaryInclude }>

/**
 * Inventário (contagem física): cria a lista com o saldo do sistema, recebe as
 * quantidades contadas (em uma ou várias etapas) e, ao aplicar, lança a diferença
 * entre o contado e o estoque atual como movimentação do tipo INVENTORY.
 */
export class InventoryService {
  constructor(private readonly db: Db) {}

  private async counted(db: DbClient, ids: number[]) {
    const rows = await db.inventoryCountItem.groupBy({
      by: ['inventoryId'],
      where: { inventoryId: { in: ids }, countedMilli: { not: null } },
      _count: { _all: true }
    })
    return new Map(rows.map((r) => [r.inventoryId, r._count._all]))
  }

  private toSummary(i: SummaryRow, countedCount: number): InventorySummaryDto {
    return {
      id: i.id,
      name: i.name,
      status: i.status,
      categoryName: i.category?.name ?? null,
      itemCount: i._count.items,
      countedCount,
      createdAt: i.createdAt.toISOString(),
      createdByName: i.createdBy.name,
      appliedAt: i.appliedAt?.toISOString() ?? null,
      appliedByName: i.appliedBy?.name ?? null
    }
  }

  async list(actor: Actor | null): Promise<InventorySummaryDto[]> {
    requirePermission(actor, 'stock.view', 'stock.manage')
    const rows = await this.db.inventoryCount.findMany({ include: summaryInclude, orderBy: { createdAt: 'desc' }, take: 200 })
    const counted = await this.counted(this.db, rows.map((r) => r.id))
    return rows.map((r) => this.toSummary(r, counted.get(r.id) ?? 0))
  }

  async get(actor: Actor | null, input: unknown): Promise<InventoryDetail> {
    requirePermission(actor, 'stock.view', 'stock.manage')
    const { inventoryId } = inventoryIdSchema.parse(input)
    return this.detail(this.db, inventoryId)
  }

  private async detail(db: DbClient, id: number): Promise<InventoryDetail> {
    const inv = await db.inventoryCount.findUnique({ where: { id }, include: summaryInclude })
    if (!inv) throw notFound('Inventário não encontrado.')
    const items = await db.inventoryCountItem.findMany({
      where: { inventoryId: id },
      include: {
        product: { select: { internalCode: true, name: true, unit: true, stockMilli: true, barcode: true } },
        variant: { select: { name: true, stockMilli: true, barcode: true } }
      },
      orderBy: [{ product: { name: 'asc' } }, { variantId: 'asc' }]
    })
    const countedCount = items.filter((i) => i.countedMilli !== null).length
    return {
      ...this.toSummary(inv, countedCount),
      notes: inv.notes,
      items: items.map((i) => {
        const currentMilli = i.variant ? i.variant.stockMilli : i.product.stockMilli
        return {
          id: i.id,
          productId: i.productId,
          variantId: i.variantId,
          internalCode: i.product.internalCode,
          name: i.product.name,
          variantName: i.variant?.name ?? null,
          barcode: i.variant ? i.variant.barcode : i.product.barcode,
          unit: i.product.unit,
          expectedMilli: i.expectedMilli,
          currentMilli,
          countedMilli: i.countedMilli,
          differenceMilli: i.countedMilli === null ? null : i.countedMilli - currentMilli,
          appliedDeltaMilli: i.appliedDeltaMilli
        }
      })
    }
  }

  async create(actorInput: Actor | null, input: unknown): Promise<InventoryDetail> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const data = inventoryCreateSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      if (await tx.inventoryCount.findFirst({ where: { status: 'OPEN' } })) {
        throw conflict('Já existe um inventário em andamento. Aplique ou cancele-o antes de iniciar outro.')
      }
      if (data.categoryId && !(await tx.category.findUnique({ where: { id: data.categoryId } }))) {
        throw validationError('Categoria inválida.', { categoryId: 'Categoria inválida' })
      }
      const products = await tx.product.findMany({
        where: {
          deletedAt: null,
          active: true,
          isService: false,
          ...(data.categoryId ? { OR: [{ categoryId: data.categoryId }, { subcategoryId: data.categoryId }] } : {})
        },
        include: { variants: { where: { deletedAt: null, active: true } } }
      })
      const items = products.flatMap((p): { productId: number; variantId: number | null; expectedMilli: number }[] =>
        p.hasVariants
          ? p.variants.map((v) => ({ productId: p.id, variantId: v.id, expectedMilli: v.stockMilli }))
          : [{ productId: p.id, variantId: null, expectedMilli: p.stockMilli }]
      )
      if (items.length === 0) throw validationError('Não há produtos ativos neste escopo para inventariar.')
      const inv = await tx.inventoryCount.create({
        data: { name: data.name, categoryId: data.categoryId, notes: data.notes, createdById: actor.userId }
      })
      await tx.inventoryCountItem.createMany({ data: items.map((i) => ({ ...i, inventoryId: inv.id })) })
      await writeAudit(tx, { userId: actor.userId, action: 'inventory.create', entity: 'InventoryCount', entityId: inv.id, details: { name: data.name, items: items.length } })
      return this.detail(tx, inv.id)
    })
  }

  async saveCounts(actorInput: Actor | null, input: unknown): Promise<InventoryDetail> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const data = inventoryCountsSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const inv = await this.requireOpen(tx, data.inventoryId)
      const items = await tx.inventoryCountItem.findMany({
        where: { inventoryId: inv.id, id: { in: data.counts.map((c) => c.itemId) } },
        include: { product: { select: { unit: true, name: true } } }
      })
      const byId = new Map(items.map((i) => [i.id, i]))
      for (const c of data.counts) {
        const item = byId.get(c.itemId)
        if (!item) throw validationError('Item não pertence a este inventário.')
        if (c.countedMilli !== null && !isFractionalUnit(item.product.unit) && c.countedMilli % 1000 !== 0) {
          throw validationError(`A unidade ${item.product.unit} de "${item.product.name}" não aceita quantidades fracionadas.`)
        }
        if (item.countedMilli !== c.countedMilli) {
          await tx.inventoryCountItem.update({ where: { id: item.id }, data: { countedMilli: c.countedMilli } })
        }
      }
      await tx.inventoryCount.update({ where: { id: inv.id }, data: { updatedAt: new Date() } })
      await writeAudit(tx, { userId: actor.userId, action: 'inventory.count', entity: 'InventoryCount', entityId: inv.id, details: { items: data.counts.length } })
      return this.detail(tx, inv.id)
    })
  }

  async apply(actorInput: Actor | null, input: unknown): Promise<InventoryDetail> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const { inventoryId } = inventoryIdSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const inv = await this.requireOpen(tx, inventoryId)
      const items = await tx.inventoryCountItem.findMany({
        where: { inventoryId, countedMilli: { not: null } },
        include: { product: true, variant: true }
      })
      if (items.length === 0) throw validationError('Nenhum item foi contado ainda.')
      let adjusted = 0
      for (const item of items) {
        // Produto ou variação excluídos depois da criação do inventário são ignorados
        if (item.product.deletedAt || (item.variantId && (!item.variant || item.variant.deletedAt))) continue
        const current = item.variant ? item.variant.stockMilli : item.product.stockMilli
        const delta = item.countedMilli! - current
        if (delta !== 0) {
          await moveStock(tx, {
            productId: item.productId,
            variantId: item.variantId,
            type: 'INVENTORY',
            quantityMilli: delta,
            reason: `Inventário: ${inv.name}`,
            referenceType: 'INVENTORY',
            referenceId: String(inv.id),
            idempotencyKey: `INV:${inv.id}:${item.id}`,
            userId: actor.userId,
            allowNegative: true
          })
          adjusted++
        }
        await tx.inventoryCountItem.update({ where: { id: item.id }, data: { appliedDeltaMilli: delta } })
      }
      await tx.inventoryCount.update({
        where: { id: inv.id },
        data: { status: 'APPLIED', appliedAt: new Date(), appliedById: actor.userId }
      })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'inventory.apply',
        entity: 'InventoryCount',
        entityId: inv.id,
        details: { counted: items.length, adjusted }
      })
      return this.detail(tx, inv.id)
    })
  }

  async cancel(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'stock.manage')
    const { inventoryId } = inventoryIdSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const inv = await this.requireOpen(tx, inventoryId)
      await tx.inventoryCount.update({ where: { id: inv.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await writeAudit(tx, { userId: actor.userId, action: 'inventory.cancel', entity: 'InventoryCount', entityId: inv.id })
    })
  }

  private async requireOpen(tx: DbClient, id: number) {
    const inv = await tx.inventoryCount.findUnique({ where: { id } })
    if (!inv) throw notFound('Inventário não encontrado.')
    if (inv.status !== 'OPEN') throw conflict('Este inventário já foi aplicado ou cancelado.')
    return inv
  }
}
