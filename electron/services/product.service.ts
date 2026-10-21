import type { z } from 'zod'
import type {
  CategoryPricingPreview,
  PriceHistoryEntry,
  ProductDetail,
  ProductListResult,
  ProductLookupResult
} from '@shared/api'
import {
  categoryPricingApplySchema,
  categoryPricingPreviewSchema,
  idSchema,
  productCreateSchema,
  productListSchema,
  productQuickCreateSchema,
  productUpdateSchema,
  setActiveSchema
} from '@shared/catalogSchemas'
import { analyzePrice, suggestPrice, totalUnitCost } from '@shared/pricing'
import { normalizeSearch, searchTextOf } from '@shared/text'
import { isFractionalUnit } from '@shared/units'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import {
  addPriceHistory,
  findCodeOwners,
  findProduct,
  findProductForList,
  productListInclude,
  type ProductDetailRow
} from '../repositories/product.repository'
import { getSetting, setSetting } from '../repositories/setting.repository'
import { recordInitialStock } from '../repositories/stock.repository'
import { AppError, conflict, forbidden, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { fromDateKey, parseJson, toDetail, toListItem, toVariantDto } from './product.mappers'
import { readPricingSettings } from './settings.service'

type CreateData = z.output<typeof productCreateSchema>
type UpdateData = z.output<typeof productUpdateSchema>
type VariantData = CreateData['variants'][number]

/** Estado final de um produto após aplicar a entrada sobre o registro existente (ou os padrões). */
interface ProductState {
  internalCode: string | null
  sku: string | null
  barcode: string | null
  name: string
  description: string | null
  categoryId: number | null
  subcategoryId: number | null
  brand: string | null
  supplierId: number | null
  unit: string
  costCents: number
  freightCents: number
  packagingCents: number
  otherCostsCents: number
  taxBps: number | null
  cardFeeBps: number | null
  commissionBps: number | null
  targetMarginBps: number | null
  pricingMode: 'MANUAL' | 'AUTOMATIC'
  salePriceCents: number
  promoPriceCents: number | null
  promoStartsAt: Date | null
  promoEndsAt: Date | null
  wholesalePriceCents: number | null
  wholesaleMinMilli: number | null
  minStockMilli: number
  allowNegativeStock: boolean
  isService: boolean
  ncm: string | null
  cest: string | null
  cfop: string | null
  taxOrigin: string | null
  taxCode: string | null
  active: boolean
  hasVariants: boolean
  variantOptions: { name: string; values: string[] }[]
}

interface VariantState {
  id: number | null
  attributes: Record<string, string>
  name: string
  sku: string | null
  barcode: string | null
  costCents: number | null
  salePriceCents: number | null
  minStockMilli: number
  initialStockMilli: number
  active: boolean
}

const COST_FIELDS = [
  'costCents',
  'freightCents',
  'packagingCents',
  'otherCostsCents',
  'taxBps',
  'cardFeeBps',
  'commissionBps',
  'targetMarginBps'
] as const
const PRICE_FIELDS = ['pricingMode', 'salePriceCents', 'promoPriceCents', 'wholesalePriceCents', 'wholesaleMinMilli'] as const

const DEFAULTS = {
  costCents: 0,
  freightCents: 0,
  packagingCents: 0,
  otherCostsCents: 0,
  taxBps: null,
  cardFeeBps: null,
  commissionBps: null,
  targetMarginBps: null,
  pricingMode: 'MANUAL',
  salePriceCents: 0,
  promoPriceCents: null,
  wholesalePriceCents: null,
  wholesaleMinMilli: null
} as const

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

function variantName(attributes: Record<string, string>, options: { name: string }[]): string {
  return options.map((o) => attributes[o.name]).filter(Boolean).join(' / ')
}

export class ProductService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ───────────── Consultas ─────────────

  async list(actorInput: Actor | null, input: unknown): Promise<ProductListResult> {
    const actor = requirePermission(actorInput, 'products.view', 'products.manage')
    const q = productListSchema.parse(input ?? {})
    const now = this.now()
    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }]

    if (q.status !== 'all') and.push({ active: q.status === 'active' })
    for (const term of normalizeSearch(q.search).split(' ').filter(Boolean)) {
      and.push({ searchText: { contains: term } })
    }
    if (q.categoryId) and.push({ OR: [{ categoryId: q.categoryId }, { subcategoryId: q.categoryId }] })
    if (q.supplierId) and.push({ supplierId: q.supplierId })
    if (q.stock === 'out') and.push({ stockMilli: { lte: 0 } })
    if (q.stock === 'low') {
      and.push({
        OR: [
          { stockMilli: { lte: 0 } },
          { hasVariants: false, minStockMilli: { gt: 0 }, stockMilli: { lte: this.db.product.fields.minStockMilli } },
          {
            hasVariants: true,
            variants: {
              some: {
                deletedAt: null,
                active: true,
                OR: [
                  { stockMilli: { lte: 0 } },
                  { minStockMilli: { gt: 0 }, stockMilli: { lte: this.db.productVariant.fields.minStockMilli } }
                ]
              }
            }
          }
        ]
      })
    }
    if (q.promo) {
      and.push({
        promoPriceCents: { not: null },
        OR: [{ promoStartsAt: null }, { promoStartsAt: { lte: now } }],
        AND: [{ OR: [{ promoEndsAt: null }, { promoEndsAt: { gte: now } }] }]
      })
    }

    const sortField = { name: 'name', code: 'internalCode', price: 'salePriceCents', stock: 'stockMilli', createdAt: 'createdAt' }[q.sort]
    const where = { AND: and }
    const [total, rows, pricing] = await Promise.all([
      this.db.product.count({ where }),
      this.db.product.findMany({
        where,
        include: productListInclude,
        orderBy: [{ [sortField]: q.direction }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize
      }),
      readPricingSettings(this.db)
    ])
    const opts = { canSeeCost: actor.permissions.has('products.cost'), minMarginBps: pricing.minMarginBps, now }
    return { items: rows.map((p) => toListItem(p, opts)), total, page: q.page, pageSize: q.pageSize }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<ProductDetail> {
    const actor = requirePermission(actorInput, 'products.view', 'products.manage')
    const { id } = idSchema.parse(input)
    const p = await findProduct(this.db, id)
    if (!p) throw notFound('Produto não encontrado.')
    return toDetail(p, actor.permissions.has('products.cost'))
  }

  /** Busca exata por código de barras, SKU ou código interno (produto ou variação). */
  async lookup(actorInput: Actor | null, input: unknown): Promise<ProductLookupResult | null> {
    const actor = requirePermission(actorInput, 'products.view', 'pdv.sell')
    const code = String((input as { code?: unknown } | null)?.code ?? '').trim()
    if (!code || code.length > 50) return null
    const pricing = await readPricingSettings(this.db)
    const opts = { canSeeCost: actor.permissions.has('products.cost'), minMarginBps: pricing.minMarginBps, now: this.now() }

    const product = await this.db.product.findFirst({
      where: { deletedAt: null, OR: [{ barcode: code }, { sku: code }, { internalCode: code }] },
      include: productListInclude
    })
    if (product) return { product: toListItem(product, opts), variant: null }

    const variant = await this.db.productVariant.findFirst({
      where: { deletedAt: null, product: { deletedAt: null }, OR: [{ barcode: code }, { sku: code }] }
    })
    if (!variant) return null
    const parent = await findProductForList(this.db, variant.productId)
    return parent ? { product: toListItem(parent, opts), variant: toVariantDto(variant, opts.canSeeCost) } : null
  }

  async priceHistory(actorInput: Actor | null, input: unknown): Promise<PriceHistoryEntry[]> {
    const actor = requirePermission(actorInput, 'products.view', 'products.manage')
    const { id } = idSchema.parse(input)
    const canSeeCost = actor.permissions.has('products.cost')
    const rows = await this.db.priceHistory.findMany({
      where: { productId: id, ...(canSeeCost ? {} : { field: { not: 'COST' } }) },
      include: { user: { select: { name: true } }, variant: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500
    })
    return rows.map((r) => ({
      id: r.id,
      field: r.field,
      variantName: r.variant?.name ?? null,
      oldCents: r.oldCents,
      newCents: r.newCents,
      reason: r.reason,
      userName: r.user?.name ?? null,
      createdAt: r.createdAt.toISOString()
    }))
  }

  // ───────────── Cadastro ─────────────

  async create(actorInput: Actor | null, input: unknown): Promise<ProductDetail> {
    const actor = requirePermission(actorInput, 'products.manage')
    const data = productCreateSchema.parse(input)
    const id = await this.db.$transaction((tx) => this.createInTx(tx, actor, data, 'Cadastro do produto'))
    return this.get(actor, { id })
  }

  /** Cadastro rápido: nome, categoria, custo, preço e quantidade inicial. */
  async quickCreate(actorInput: Actor | null, input: unknown): Promise<ProductDetail> {
    const actor = requirePermission(actorInput, 'products.manage')
    const q = productQuickCreateSchema.parse(input)
    const data = productCreateSchema.parse({
      name: q.name,
      categoryId: q.categoryId,
      unit: q.unit,
      salePriceCents: q.salePriceCents,
      initialStockMilli: q.initialStockMilli,
      ...(q.costCents !== undefined ? { costCents: q.costCents } : {})
    })
    const id = await this.db.$transaction((tx) => this.createInTx(tx, actor, data, 'Cadastro rápido'))
    return this.get(actor, { id })
  }

  /** Usado também pela importação (dentro da transação dela). */
  async createInTx(tx: DbClient, actor: Actor, data: CreateData, reason: string): Promise<number> {
    const state = this.resolveState(actor, null, data)
    const variants = this.resolveVariants(actor, state, null, data.variants)
    if (state.isService && data.initialStockMilli > 0) throw validationError('Serviços não têm estoque.', { initialStockMilli: 'Serviços não têm estoque' })
    if (!state.hasVariants && data.initialStockMilli > 0) this.assertQuantity(state.unit, data.initialStockMilli, 'initialStockMilli')
    await this.validateReferences(tx, state)
    await this.assertCodesAvailable(tx, state, variants, null)
    const internalCode = state.internalCode ?? (await this.nextInternalCode(tx))
    state.internalCode = internalCode

    const initialProductStock = state.hasVariants ? 0 : data.initialStockMilli
    const variantStock = variants.reduce((acc, v) => acc + v.initialStockMilli, 0)
    const product = await tx.product.create({
      data: {
        ...this.productData(state, variants),
        internalCode,
        stockMilli: state.hasVariants ? variantStock : initialProductStock
      }
    })

    const history: Prisma.PriceHistoryCreateManyInput[] = []
    const entry = (field: 'COST' | 'SALE' | 'PROMO' | 'WHOLESALE', newCents: number | null, variantId: number | null = null) => {
      if (newCents !== null && newCents !== 0) {
        history.push({ productId: product.id, variantId, field, oldCents: null, newCents, reason, userId: actor.userId })
      }
    }
    entry('COST', state.costCents)
    entry('SALE', state.salePriceCents)
    entry('PROMO', state.promoPriceCents)
    entry('WHOLESALE', state.wholesalePriceCents)

    const unitCost = totalUnitCost(state)
    if (initialProductStock > 0) {
      await recordInitialStock(tx, { productId: product.id, quantityMilli: initialProductStock, unitCostCents: unitCost, userId: actor.userId })
    }
    for (const v of variants) {
      const created = await tx.productVariant.create({ data: { productId: product.id, ...this.variantData(v), stockMilli: v.initialStockMilli } })
      entry('COST', v.costCents, created.id)
      entry('SALE', v.salePriceCents, created.id)
      if (v.initialStockMilli > 0) {
        await recordInitialStock(tx, {
          productId: product.id,
          variantId: created.id,
          quantityMilli: v.initialStockMilli,
          unitCostCents: v.costCents !== null ? totalUnitCost({ ...state, costCents: v.costCents }) : unitCost,
          userId: actor.userId
        })
      }
    }
    await addPriceHistory(tx, history)
    await writeAudit(tx, {
      userId: actor.userId,
      action: 'product.create',
      entity: 'Product',
      entityId: product.id,
      details: { name: state.name, internalCode, variants: variants.length, initialStockMilli: initialProductStock + variantStock, reason }
    })
    return product.id
  }

  async update(actorInput: Actor | null, input: unknown): Promise<ProductDetail> {
    const actor = requirePermission(actorInput, 'products.manage')
    const data = productUpdateSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const existing = await findProduct(tx, data.id)
      if (!existing) throw notFound('Produto não encontrado.')
      await this.updateInTx(tx, actor, existing, data, data.priceChangeReason ?? 'Alteração no cadastro')
    })
    return this.get(actor, { id: data.id })
  }

  async updateInTx(tx: DbClient, actor: Actor, existing: ProductDetailRow, data: UpdateData | CreateData, reason: string): Promise<void> {
    const state = this.resolveState(actor, existing, data)
    const variants = this.resolveVariants(actor, state, existing, data.variants)
    await this.validateReferences(tx, state)
    await this.assertCodesAvailable(tx, state, variants, existing.id)

    // Transições de variações: o estoque só muda por movimentação (Fase 3), então
    // ligar/desligar variações exige estoque zerado.
    if (state.isService && !existing.isService && existing.stockMilli !== 0) {
      throw validationError('Para transformar em serviço, o estoque atual precisa estar zerado.', { isService: 'Estoque diferente de zero' })
    }
    if (state.hasVariants && !existing.hasVariants && existing.stockMilli !== 0) {
      throw validationError('Para trabalhar com variações, o estoque atual do produto precisa estar zerado.', {
        hasVariants: 'Estoque atual diferente de zero'
      })
    }
    const keptIds = new Set(variants.filter((v) => v.id !== null).map((v) => v.id))
    const removed = existing.variants.filter((v) => !keptIds.has(v.id))
    for (const v of removed) {
      if (v.stockMilli !== 0) throw validationError(`A variação "${v.name}" possui estoque e não pode ser removida. Desative-a.`)
    }

    const history: Prisma.PriceHistoryCreateManyInput[] = []
    const diff = (field: 'COST' | 'SALE' | 'PROMO' | 'WHOLESALE', oldCents: number | null, newCents: number | null, variantId: number | null = null) => {
      if (oldCents !== newCents) history.push({ productId: existing.id, variantId, field, oldCents, newCents, reason, userId: actor.userId })
    }
    diff('COST', existing.costCents, state.costCents)
    diff('SALE', existing.salePriceCents, state.salePriceCents)
    diff('PROMO', existing.promoPriceCents, state.promoPriceCents)
    diff('WHOLESALE', existing.wholesalePriceCents, state.wholesalePriceCents)

    const now = new Date()
    // 1) variações removidas: exclusão lógica, liberando os códigos para reutilização
    for (const v of removed) {
      await tx.productVariant.update({ where: { id: v.id }, data: { deletedAt: now, active: false, sku: null, barcode: null } })
    }
    // 2) libera códigos das variações mantidas (permite trocar códigos entre elas)
    const kept = variants.filter((v) => v.id !== null)
    if (kept.length) {
      await tx.productVariant.updateMany({ where: { id: { in: kept.map((v) => v.id!) } }, data: { sku: null, barcode: null } })
    }
    // 3) atualiza mantidas e 4) cria novas
    const unitCost = totalUnitCost(state)
    for (const v of variants) {
      if (v.id !== null) {
        const before = existing.variants.find((e) => e.id === v.id)!
        diff('COST', before.costCents, v.costCents, v.id)
        diff('SALE', before.salePriceCents, v.salePriceCents, v.id)
        await tx.productVariant.update({ where: { id: v.id }, data: this.variantData(v) })
      } else {
        const created = await tx.productVariant.create({
          data: { productId: existing.id, ...this.variantData(v), stockMilli: v.initialStockMilli }
        })
        diff('COST', null, v.costCents, created.id)
        diff('SALE', null, v.salePriceCents, created.id)
        if (v.initialStockMilli > 0) {
          await recordInitialStock(tx, {
            productId: existing.id,
            variantId: created.id,
            quantityMilli: v.initialStockMilli,
            unitCostCents: v.costCents !== null ? totalUnitCost({ ...state, costCents: v.costCents }) : unitCost,
            userId: actor.userId
          })
        }
      }
    }

    const stockMilli = state.hasVariants
      ? (await tx.productVariant.aggregate({ where: { productId: existing.id, deletedAt: null }, _sum: { stockMilli: true } }))._sum
          .stockMilli ?? 0
      : existing.stockMilli
    await tx.product.update({
      where: { id: existing.id },
      data: { ...this.productData(state, variants), internalCode: state.internalCode ?? existing.internalCode, stockMilli }
    })
    await addPriceHistory(tx, history)

    const changed = (Object.keys(state) as (keyof ProductState)[]).filter((k) => {
      const before = (existing as unknown as Record<string, unknown>)[k]
      const after = state[k]
      if (after instanceof Date || before instanceof Date) return !sameTime(after as Date | null, before as Date | null)
      if (k === 'variantOptions') return JSON.stringify(after) !== JSON.stringify(parseJson(existing.variantOptions, []))
      return k !== 'internalCode' && before !== after
    })
    await writeAudit(tx, {
      userId: actor.userId,
      action: 'product.update',
      entity: 'Product',
      entityId: existing.id,
      details: { changed, variantsRemoved: removed.length, pricesChanged: history.length, reason }
    })
  }

  async setActive(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'products.manage')
    const { id, active } = setActiveSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const p = await findProduct(tx, id)
      if (!p) throw notFound('Produto não encontrado.')
      await tx.product.update({ where: { id }, data: { active } })
      await writeAudit(tx, { userId: actor.userId, action: active ? 'product.activate' : 'product.deactivate', entity: 'Product', entityId: id })
    })
  }

  /**
   * Exclusão lógica: o produto deixa de aparecer, mas permanece no banco para o
   * histórico de vendas e movimentações. SKU e código de barras são liberados.
   */
  async remove(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'products.manage')
    const { id } = idSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const p = await findProduct(tx, id)
      if (!p) throw notFound('Produto não encontrado.')
      if (p.stockMilli !== 0 || p.variants.some((v) => v.stockMilli !== 0)) {
        throw conflict('O produto possui estoque. Zere o estoque ou apenas desative o produto.')
      }
      const now = new Date()
      await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null },
        data: { deletedAt: now, active: false, sku: null, barcode: null }
      })
      await tx.product.update({ where: { id }, data: { deletedAt: now, active: false, sku: null, barcode: null } })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'product.delete',
        entity: 'Product',
        entityId: id,
        details: { name: p.name, internalCode: p.internalCode, sku: p.sku, barcode: p.barcode }
      })
    })
  }

  /** Define o arquivo de imagem já salvo pelo processo principal; devolve o anterior para remoção. */
  async setImage(actorInput: Actor | null, id: number, fileName: string | null): Promise<string | null> {
    const actor = requirePermission(actorInput, 'products.manage')
    return this.db.$transaction(async (tx) => {
      const p = await findProduct(tx, id)
      if (!p) throw notFound('Produto não encontrado.')
      await tx.product.update({ where: { id }, data: { imagePath: fileName } })
      await writeAudit(tx, { userId: actor.userId, action: fileName ? 'product.image_set' : 'product.image_removed', entity: 'Product', entityId: id })
      return p.imagePath
    })
  }

  // ───────────── Precificação por categoria ─────────────

  async categoryPricingPreview(actorInput: Actor | null, input: unknown): Promise<CategoryPricingPreview> {
    const actor = requirePermission(actorInput, 'products.price')
    requirePermission(actor, 'products.cost')
    const q = categoryPricingPreviewSchema.parse(input)
    const category = await this.db.category.findUnique({ where: { id: q.categoryId } })
    if (!category) throw notFound('Categoria não encontrada.')
    const marginBps = q.marginBps ?? category.defaultMarginBps
    if (marginBps === null || marginBps === undefined) {
      throw validationError('Defina a margem padrão da categoria ou informe a margem desejada.', { marginBps: 'Informe a margem' })
    }
    const products = await this.db.product.findMany({
      where: { deletedAt: null, OR: [{ categoryId: category.id }, { subcategoryId: category.id }] },
      orderBy: { name: 'asc' }
    })
    return {
      categoryId: category.id,
      categoryName: category.name,
      marginBps,
      items: products.map((p) => {
        const totalCostCents = totalUnitCost(p)
        const suggestion = suggestPrice(totalCostCents, marginBps, p)
        const problem = totalCostCents === 0 ? 'Produto sem custo informado' : suggestion.ok ? null : suggestion.reason
        return {
          productId: p.id,
          internalCode: p.internalCode,
          name: p.name,
          totalCostCents,
          currentPriceCents: p.salePriceCents,
          currentMarginBps: analyzePrice(p, p.salePriceCents).grossMarginBps,
          suggestedPriceCents: suggestion.ok && !problem ? suggestion.priceCents : null,
          problem
        }
      })
    }
  }

  /** Aplica a margem somente aos produtos confirmados pelo usuário (nenhum preço muda sem autorização). */
  async categoryPricingApply(actorInput: Actor | null, input: unknown): Promise<{ updated: number }> {
    const actor = requirePermission(actorInput, 'products.price')
    requirePermission(actor, 'products.cost')
    const q = categoryPricingApplySchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id: q.categoryId } })
      if (!category) throw notFound('Categoria não encontrada.')
      const products = await tx.product.findMany({
        where: { id: { in: q.productIds }, deletedAt: null, OR: [{ categoryId: category.id }, { subcategoryId: category.id }] }
      })
      if (products.length !== new Set(q.productIds).size) {
        throw validationError('Algum produto selecionado não pertence à categoria ou foi excluído.')
      }
      const reason = `Precificação por categoria (${category.name}, margem ${(q.marginBps / 100).toLocaleString('pt-BR')}%)`
      let updated = 0
      for (const p of products) {
        const cost = totalUnitCost(p)
        const s = suggestPrice(cost, q.marginBps, p)
        if (!s.ok || cost === 0) throw validationError(`Não foi possível calcular o preço de "${p.name}".`)
        await tx.product.update({ where: { id: p.id }, data: { salePriceCents: s.priceCents, targetMarginBps: q.marginBps } })
        if (s.priceCents !== p.salePriceCents) {
          await addPriceHistory(tx, [
            { productId: p.id, field: 'SALE', oldCents: p.salePriceCents, newCents: s.priceCents, reason, userId: actor.userId }
          ])
          updated++
        }
      }
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'product.category_pricing',
        entity: 'Category',
        entityId: category.id,
        details: { marginBps: q.marginBps, products: q.productIds, updated }
      })
      return { updated }
    })
  }

  // ───────────── Regras internas ─────────────

  /** Combina entrada + registro existente, verificando permissões de custo e preço por campo. */
  private resolveState(actor: Actor, existing: ProductDetailRow | null, data: CreateData | UpdateData): ProductState {
    const canCost = actor.permissions.has('products.cost')
    const canPrice = actor.permissions.has('products.price')
    const current = (field: string): unknown =>
      existing ? (existing as unknown as Record<string, unknown>)[field] : (DEFAULTS as Record<string, unknown>)[field]
    const pick = <T>(field: string, value: T | undefined): T => (value !== undefined ? value : (current(field) as T))

    const costs = {} as Record<(typeof COST_FIELDS)[number], number | null>
    for (const f of COST_FIELDS) {
      const value = pick(f, data[f])
      if (value !== current(f) && !canCost) throw forbidden('Você não tem permissão para alterar custos e margens.')
      costs[f] = value as number | null
    }

    const state: ProductState = {
      internalCode: data.internalCode ?? (existing ? existing.internalCode : null),
      sku: data.sku,
      barcode: data.barcode,
      name: data.name,
      description: data.description,
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId,
      brand: data.brand,
      supplierId: data.supplierId,
      unit: data.unit,
      costCents: costs.costCents ?? 0,
      freightCents: costs.freightCents ?? 0,
      packagingCents: costs.packagingCents ?? 0,
      otherCostsCents: costs.otherCostsCents ?? 0,
      taxBps: costs.taxBps,
      cardFeeBps: costs.cardFeeBps,
      commissionBps: costs.commissionBps,
      targetMarginBps: costs.targetMarginBps,
      pricingMode: pick('pricingMode', data.pricingMode),
      salePriceCents: pick('salePriceCents', data.salePriceCents),
      promoPriceCents: pick('promoPriceCents', data.promoPriceCents),
      promoStartsAt: data.promoStartsAt !== undefined ? fromDateKey(data.promoStartsAt) : (existing?.promoStartsAt ?? null),
      promoEndsAt: data.promoEndsAt !== undefined ? fromDateKey(data.promoEndsAt, true) : (existing?.promoEndsAt ?? null),
      wholesalePriceCents: pick('wholesalePriceCents', data.wholesalePriceCents),
      wholesaleMinMilli: pick('wholesaleMinMilli', data.wholesaleMinMilli ?? undefined),
      minStockMilli: data.minStockMilli,
      allowNegativeStock: data.allowNegativeStock,
      // Não informado = mantém o atual (evita transformar serviço em produto sem querer)
      isService: data.isService ?? existing?.isService ?? false,
      ncm: data.ncm,
      cest: data.cest,
      cfop: data.cfop,
      taxOrigin: data.taxOrigin,
      taxCode: data.taxCode,
      active: data.active,
      hasVariants: data.hasVariants,
      variantOptions: data.hasVariants ? data.variantOptions : []
    }

    if (state.pricingMode === 'AUTOMATIC') {
      if (state.targetMarginBps === null) {
        throw validationError('Informe a margem desejada para usar a precificação automática.', { targetMarginBps: 'Informe a margem' })
      }
      const s = suggestPrice(totalUnitCost(state), state.targetMarginBps, state)
      if (!s.ok) throw validationError(s.reason, { targetMarginBps: s.reason })
      state.salePriceCents = s.priceCents
    }

    const priceChanged =
      PRICE_FIELDS.some((f) => state[f] !== current(f)) ||
      !sameTime(state.promoStartsAt, existing?.promoStartsAt ?? null) ||
      !sameTime(state.promoEndsAt, existing?.promoEndsAt ?? null)
    if (priceChanged && !canPrice) throw forbidden('Você não tem permissão para alterar preços.')

    this.validateRules(state)
    return state
  }

  private resolveVariants(actor: Actor, state: ProductState, existing: ProductDetailRow | null, input: VariantData[]): VariantState[] {
    if (!state.hasVariants) {
      if (input.length > 0) throw validationError('Ative as variações para cadastrá-las.')
      return []
    }
    if (state.variantOptions.length === 0) {
      throw validationError('Defina ao menos um tipo de variação (ex.: Cor, Tamanho).', { variantOptions: 'Obrigatório' })
    }
    if (input.length === 0) throw validationError('Cadastre ao menos uma variação.', { variants: 'Obrigatório' })

    const optionNames = state.variantOptions.map((o) => normalizeSearch(o.name))
    if (new Set(optionNames).size !== optionNames.length) throw validationError('Há tipos de variação repetidos.')
    for (const o of state.variantOptions) {
      const values = o.values.map(normalizeSearch)
      if (new Set(values).size !== values.length) throw validationError(`Há valores repetidos em "${o.name}".`)
    }

    const canCost = actor.permissions.has('products.cost')
    const canPrice = actor.permissions.has('products.price')
    const combos = new Set<string>()
    return input.map((v) => {
      const before = v.id ? existing?.variants.find((e) => e.id === v.id) : undefined
      if (v.id && !before) throw validationError('Variação não pertence a este produto.')
      for (const o of state.variantOptions) {
        const value = v.attributes[o.name]
        if (!value || !o.values.includes(value)) throw validationError(`Escolha um valor válido de "${o.name}" em todas as variações.`)
      }
      if (Object.keys(v.attributes).length !== state.variantOptions.length) throw validationError('Variação com atributos desconhecidos.')
      const name = variantName(v.attributes, state.variantOptions)
      const combo = normalizeSearch(name)
      if (combos.has(combo)) throw validationError(`A variação "${name}" está repetida.`)
      combos.add(combo)

      // Sem permissão de custo, o custo da variação não é exibido nem alterado.
      const costCents = canCost ? v.costCents : (before?.costCents ?? null)
      let salePriceCents = v.salePriceCents
      if (state.pricingMode === 'AUTOMATIC') {
        salePriceCents = null
        if (costCents !== null) {
          const s = suggestPrice(totalUnitCost({ ...state, costCents }), state.targetMarginBps!, state)
          if (!s.ok) throw validationError(s.reason)
          salePriceCents = s.priceCents
        }
      }
      if (salePriceCents !== (before?.salePriceCents ?? null) && !canPrice) {
        throw forbidden('Você não tem permissão para alterar preços.')
      }
      this.assertQuantity(state.unit, v.minStockMilli, 'variants')
      if (!before) this.assertQuantity(state.unit, v.initialStockMilli, 'variants')
      return {
        id: v.id,
        attributes: Object.fromEntries(state.variantOptions.map((o) => [o.name, v.attributes[o.name]])),
        name,
        sku: v.sku,
        barcode: v.barcode,
        costCents,
        salePriceCents,
        minStockMilli: v.minStockMilli,
        initialStockMilli: before ? 0 : v.initialStockMilli,
        active: v.active
      }
    })
  }

  private assertQuantity(unit: string, milli: number | null, field: string): void {
    if (milli !== null && !isFractionalUnit(unit) && milli % 1000 !== 0) {
      throw validationError(`A unidade ${unit} não aceita quantidades fracionadas.`, { [field]: 'Use números inteiros' })
    }
  }

  private validateRules(s: ProductState): void {
    const fields: Record<string, string> = {}
    if (s.isService && s.hasVariants) fields.isService = 'Serviços não têm variações'
    if (s.isService && s.minStockMilli > 0) fields.minStockMilli = 'Serviços não têm estoque mínimo'
    if (s.subcategoryId !== null && s.categoryId === null) fields.subcategoryId = 'Escolha a categoria antes da subcategoria'
    if (s.promoPriceCents !== null) {
      if (s.promoPriceCents <= 0) fields.promoPriceCents = 'Informe um preço promocional maior que zero'
      else if (s.promoPriceCents >= s.salePriceCents) fields.promoPriceCents = 'O preço promocional deve ser menor que o preço de venda'
    } else if (s.promoStartsAt || s.promoEndsAt) {
      fields.promoPriceCents = 'Informe o preço promocional'
    }
    if (s.promoStartsAt && s.promoEndsAt && s.promoEndsAt < s.promoStartsAt) fields.promoEndsAt = 'O fim deve ser depois do início'
    if (s.wholesalePriceCents !== null) {
      if (!s.wholesaleMinMilli) fields.wholesaleMinMilli = 'Informe a quantidade mínima para o preço de atacado'
      if (s.wholesalePriceCents > s.salePriceCents) fields.wholesalePriceCents = 'O preço de atacado não pode ser maior que o de varejo'
    }
    if (Object.keys(fields).length) throw validationError(Object.values(fields)[0], fields)
    this.assertQuantity(s.unit, s.minStockMilli, 'minStockMilli')
    this.assertQuantity(s.unit, s.wholesaleMinMilli, 'wholesaleMinMilli')
  }

  private async validateReferences(tx: DbClient, s: ProductState): Promise<void> {
    if (s.categoryId !== null) {
      const c = await tx.category.findUnique({ where: { id: s.categoryId } })
      if (!c || c.parentId !== null) throw validationError('Categoria inválida.', { categoryId: 'Categoria inválida' })
    }
    if (s.subcategoryId !== null) {
      const sub = await tx.category.findUnique({ where: { id: s.subcategoryId } })
      if (!sub || sub.parentId !== s.categoryId) {
        throw validationError('A subcategoria não pertence à categoria escolhida.', { subcategoryId: 'Subcategoria inválida' })
      }
    }
    if (s.supplierId !== null) {
      const sup = await tx.supplier.findFirst({ where: { id: s.supplierId, deletedAt: null } })
      if (!sup) throw validationError('Fornecedor inválido.', { supplierId: 'Fornecedor inválido' })
    }
  }

  /** SKU, código de barras e código interno são únicos entre todos os produtos e variações. */
  private async assertCodesAvailable(tx: DbClient, s: ProductState, variants: VariantState[], productId: number | null) {
    const codes: { value: string; label: string; field: string }[] = []
    const add = (value: string | null, label: string, field: string) => value && codes.push({ value, label, field })
    add(s.internalCode, 'código interno', 'internalCode')
    add(s.sku, 'SKU', 'sku')
    add(s.barcode, 'código de barras', 'barcode')
    for (const v of variants) {
      add(v.sku, `SKU da variação ${v.name}`, 'variants')
      add(v.barcode, `código de barras da variação ${v.name}`, 'variants')
    }
    const seen = new Map<string, string>()
    for (const c of codes) {
      const prev = seen.get(c.value)
      if (prev) throw validationError(`O código "${c.value}" foi usado mais de uma vez (${prev} e ${c.label}).`, { [c.field]: 'Código repetido' })
      seen.set(c.value, c.label)
    }
    const owners = await findCodeOwners(tx, codes.map((c) => c.value), productId)
    const taken = [
      ...owners.products.flatMap((p) => [p.sku, p.barcode, p.internalCode].map((code) => ({ code, owner: `produto "${p.name}"` }))),
      ...owners.variants.flatMap((v) => [v.sku, v.barcode].map((code) => ({ code, owner: `variação "${v.product.name} — ${v.name}"` })))
    ]
    for (const c of codes) {
      const hit = taken.find((t) => t.code === c.value)
      if (hit) throw new AppError('CONFLICT', `O ${c.label} "${c.value}" já está em uso pelo ${hit.owner}.`, { [c.field]: 'Código já utilizado' })
    }
  }

  /** Próximo código interno numérico sequencial (000001, 000002...). */
  private async nextInternalCode(tx: DbClient): Promise<string> {
    let next = await getSetting<number>(tx, 'products.nextCode', 1)
    for (;;) {
      const code = String(next).padStart(6, '0')
      next++
      const owners = await findCodeOwners(tx, [code], null)
      if (owners.products.length === 0 && owners.variants.length === 0) {
        await setSetting(tx, 'products.nextCode', next)
        return code
      }
    }
  }

  private productData(s: ProductState, variants: VariantState[]) {
    return {
      sku: s.sku,
      barcode: s.barcode,
      name: s.name,
      description: s.description,
      categoryId: s.categoryId,
      subcategoryId: s.subcategoryId,
      brand: s.brand,
      supplierId: s.supplierId,
      unit: s.unit,
      costCents: s.costCents,
      freightCents: s.freightCents,
      packagingCents: s.packagingCents,
      otherCostsCents: s.otherCostsCents,
      taxBps: s.taxBps,
      cardFeeBps: s.cardFeeBps,
      commissionBps: s.commissionBps,
      targetMarginBps: s.targetMarginBps,
      pricingMode: s.pricingMode,
      salePriceCents: s.salePriceCents,
      promoPriceCents: s.promoPriceCents,
      promoStartsAt: s.promoStartsAt,
      promoEndsAt: s.promoEndsAt,
      wholesalePriceCents: s.wholesalePriceCents,
      wholesaleMinMilli: s.wholesaleMinMilli,
      minStockMilli: s.hasVariants ? 0 : s.minStockMilli,
      allowNegativeStock: s.allowNegativeStock,
      isService: s.isService,
      ncm: s.ncm,
      cest: s.cest,
      cfop: s.cfop,
      taxOrigin: s.taxOrigin,
      taxCode: s.taxCode,
      active: s.active,
      hasVariants: s.hasVariants,
      variantOptions: s.hasVariants ? JSON.stringify(s.variantOptions) : null,
      searchText: searchTextOf(
        s.name,
        s.internalCode,
        s.sku,
        s.barcode,
        s.brand,
        ...variants.flatMap((v) => [v.name, v.sku, v.barcode])
      )
    }
  }

  private variantData(v: VariantState) {
    return {
      name: v.name,
      attributes: JSON.stringify(v.attributes),
      sku: v.sku,
      barcode: v.barcode,
      costCents: v.costCents,
      salePriceCents: v.salePriceCents,
      minStockMilli: v.minStockMilli,
      active: v.active
    }
  }
}
