import type { ProductDetail, ProductListItem, StockStatus, VariantDto } from '@shared/api'
import { analyzePrice, effectivePrice, isPromoActive } from '@shared/pricing'
import type { ProductDetailRow, ProductListRow } from '../repositories/product.repository'

export const MEDIA_SCHEME = 'sc-media'

export function productImageUrl(imagePath: string | null): string | null {
  return imagePath ? `${MEDIA_SCHEME}://products/${imagePath}` : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Date -> "AAAA-MM-DD" no horário local. */
export function toDateKey(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null
}

/** "AAAA-MM-DD" -> início ou fim do dia no horário local. */
export function fromDateKey(key: string | null, endOfDay = false): Date | null {
  if (!key) return null
  const [y, m, d] = key.split('-').map(Number)
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)
}

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function stockStatusOf(p: {
  stockMilli: number
  minStockMilli: number
  hasVariants: boolean
  variants: { stockMilli: number; minStockMilli: number; active: boolean }[]
}): StockStatus {
  if (p.stockMilli <= 0) return 'out'
  if (p.hasVariants) {
    return p.variants.some((v) => v.active && (v.stockMilli <= 0 || (v.minStockMilli > 0 && v.stockMilli <= v.minStockMilli)))
      ? 'low'
      : 'ok'
  }
  return p.minStockMilli > 0 && p.stockMilli <= p.minStockMilli ? 'low' : 'ok'
}

export function toListItem(p: ProductListRow, opts: { canSeeCost: boolean; minMarginBps: number; now: Date }): ProductListItem {
  const analysis = analyzePrice(p, effectivePrice(p, opts.now), p)
  const margin = opts.canSeeCost ? analysis.grossMarginBps : null
  return {
    id: p.id,
    internalCode: p.internalCode,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    categoryName: p.category?.name ?? null,
    subcategoryName: p.subcategory?.name ?? null,
    brand: p.brand,
    unit: p.unit,
    salePriceCents: p.salePriceCents,
    promoPriceCents: p.promoPriceCents,
    promoActive: isPromoActive(p, opts.now),
    effectivePriceCents: effectivePrice(p, opts.now),
    totalCostCents: opts.canSeeCost ? analysis.totalCostCents : null,
    grossMarginBps: margin,
    lowMargin: margin !== null && analysis.totalCostCents > 0 && margin < opts.minMarginBps,
    stockMilli: p.stockMilli,
    minStockMilli: p.minStockMilli,
    stockStatus: p.isService ? 'ok' : stockStatusOf(p),
    active: p.active,
    hasVariants: p.hasVariants,
    variantCount: p.variants.length,
    imageUrl: productImageUrl(p.imagePath),
    pricingMode: p.pricingMode,
    isService: p.isService
  }
}

export function toVariantDto(v: ProductDetailRow['variants'][number], canSeeCost: boolean): VariantDto {
  return {
    id: v.id,
    name: v.name,
    attributes: parseJson<Record<string, string>>(v.attributes, {}),
    sku: v.sku,
    barcode: v.barcode,
    costCents: canSeeCost ? v.costCents : null,
    salePriceCents: v.salePriceCents,
    stockMilli: v.stockMilli,
    minStockMilli: v.minStockMilli,
    active: v.active
  }
}

export function toDetail(p: ProductDetailRow, canSeeCost: boolean): ProductDetail {
  const cost = <T>(v: T): T | null => (canSeeCost ? v : null)
  return {
    id: p.id,
    internalCode: p.internalCode,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    subcategoryId: p.subcategoryId,
    brand: p.brand,
    supplierId: p.supplierId,
    unit: p.unit,
    imageUrl: productImageUrl(p.imagePath),
    costCents: cost(p.costCents),
    freightCents: cost(p.freightCents),
    packagingCents: cost(p.packagingCents),
    otherCostsCents: cost(p.otherCostsCents),
    taxBps: cost(p.taxBps),
    cardFeeBps: cost(p.cardFeeBps),
    commissionBps: cost(p.commissionBps),
    targetMarginBps: cost(p.targetMarginBps),
    costVisible: canSeeCost,
    pricingMode: p.pricingMode,
    salePriceCents: p.salePriceCents,
    promoPriceCents: p.promoPriceCents,
    promoStartsAt: toDateKey(p.promoStartsAt),
    promoEndsAt: toDateKey(p.promoEndsAt),
    wholesalePriceCents: p.wholesalePriceCents,
    wholesaleMinMilli: p.wholesaleMinMilli,
    stockMilli: p.stockMilli,
    minStockMilli: p.minStockMilli,
    allowNegativeStock: p.allowNegativeStock,
    isService: p.isService,
    ncm: p.ncm,
    cest: p.cest,
    cfop: p.cfop,
    taxOrigin: p.taxOrigin,
    taxCode: p.taxCode,
    active: p.active,
    hasVariants: p.hasVariants,
    variantOptions: parseJson(p.variantOptions, []),
    variants: p.variants.map((v) => toVariantDto(v, canSeeCost)),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  }
}
