import type { CatalogData, CatalogProduct } from '@shared/api'
import { catalogSchema } from '@shared/commerceSchemas'
import { effectivePrice, isPromoActive } from '@shared/pricing'
import { normalizeSearch } from '@shared/text'
import type { Db } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { requirePermission, type Actor } from './context'
import { productImageUrl } from './product.mappers'

/** Catálogo digital: dados vêm diretamente do cadastro de produtos (somente ativos). */
export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  async data(actorInput: Actor | null, input: unknown): Promise<CatalogData & { imagePaths: Map<number, string> }> {
    requirePermission(actorInput, 'catalog.view', 'products.view')
    const q = catalogSchema.parse(input ?? {})
    const now = this.now()
    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null, active: true }]
    if (q.categoryIds.length) and.push({ OR: [{ categoryId: { in: q.categoryIds } }, { subcategoryId: { in: q.categoryIds } }] })
    for (const t of normalizeSearch(q.search).split(' ').filter(Boolean)) and.push({ searchText: { contains: t } })
    if (q.inStockOnly) and.push({ OR: [{ isService: true }, { stockMilli: { gt: 0 } }] })
    if (q.promoOnly) {
      and.push({
        promoPriceCents: { not: null },
        OR: [{ promoStartsAt: null }, { promoStartsAt: { lte: now } }],
        AND: [{ OR: [{ promoEndsAt: null }, { promoEndsAt: { gte: now } }] }]
      })
    }
    const rows = await this.db.product.findMany({
      where: { AND: and },
      include: { category: { select: { name: true } }, variants: { where: { deletedAt: null, active: true }, orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' }
    })
    const groups = new Map<string, CatalogProduct[]>()
    const imagePaths = new Map<number, string>()
    for (const p of rows) {
      if (p.imagePath) imagePaths.set(p.id, p.imagePath)
      const product: CatalogProduct = {
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: productImageUrl(p.imagePath),
        unit: p.unit,
        priceCents: effectivePrice(p, now),
        regularPriceCents: p.salePriceCents,
        promo: isPromoActive(p, now),
        inStock: p.isService || p.stockMilli > 0,
        variants: p.variants.map((v) => v.name)
      }
      const key = p.category?.name ?? 'Outros produtos'
      groups.set(key, [...(groups.get(key) ?? []), product])
    }
    const categories = [...groups]
      .sort(([a], [b]) => (a === 'Outros produtos' ? 1 : b === 'Outros produtos' ? -1 : a.localeCompare(b, 'pt-BR')))
      .map(([name, products]) => ({ name, products }))
    return {
      generatedAt: now.toISOString(),
      title: q.title ?? 'Catálogo de produtos',
      showPrices: q.showPrices,
      categories,
      productCount: rows.length,
      imagePaths
    }
  }
}
