import type { DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'

export const productDetailInclude = {
  variants: { where: { deletedAt: null }, orderBy: { id: 'asc' } }
} as const satisfies Prisma.ProductInclude

export const productListInclude = {
  category: { select: { name: true } },
  subcategory: { select: { name: true } },
  variants: { where: { deletedAt: null }, select: { stockMilli: true, minStockMilli: true, active: true } }
} as const satisfies Prisma.ProductInclude

export type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>
export type ProductListRow = Prisma.ProductGetPayload<{ include: typeof productListInclude }>

export function findProduct(db: DbClient, id: number) {
  return db.product.findFirst({ where: { id, deletedAt: null }, include: productDetailInclude })
}

export function findProductForList(db: DbClient, id: number) {
  return db.product.findFirst({ where: { id, deletedAt: null }, include: productListInclude })
}

/** Produtos e variações (não excluídos) que já usam algum dos códigos informados. */
export async function findCodeOwners(db: DbClient, codes: string[], excludeProductId: number | null) {
  if (codes.length === 0) return { products: [], variants: [] }
  const notSelf = excludeProductId ? { not: excludeProductId } : undefined
  const [products, variants] = await Promise.all([
    db.product.findMany({
      where: { id: notSelf, OR: [{ sku: { in: codes } }, { barcode: { in: codes } }, { internalCode: { in: codes } }] },
      select: { id: true, name: true, sku: true, barcode: true, internalCode: true }
    }),
    db.productVariant.findMany({
      where: { productId: notSelf, deletedAt: null, OR: [{ sku: { in: codes } }, { barcode: { in: codes } }] },
      select: { id: true, name: true, sku: true, barcode: true, product: { select: { name: true } } }
    })
  ])
  return { products, variants }
}

export function addPriceHistory(db: DbClient, entries: Prisma.PriceHistoryCreateManyInput[]) {
  if (entries.length === 0) return Promise.resolve({ count: 0 })
  return db.priceHistory.createMany({ data: entries })
}
