import type { z } from 'zod'
import type { DocumentLineDto } from '@shared/api'
import type { documentItemSchema } from '@shared/commerceSchemas'
import { allocate, lineGross, unitPriceFor } from '@shared/salePricing'
import type { DbClient } from '../database/connection'
import { validationError } from '../utils/errors'
import { discountBps } from './discount'

type ItemInput = z.output<typeof documentItemSchema>

export interface PricedLine {
  index: number
  productId: number | null
  variantId: number | null
  description: string
  isService: boolean
  freeText: boolean
  quantityMilli: number
  unitPriceCents: number
  grossCents: number
  /** Desconto do item + rateio do desconto geral (o que é gravado). */
  discountCents: number
  itemDiscountCents: number
  totalCents: number
}

/**
 * Calcula as linhas de um pedido/orçamento: preço vigente do produto (promoção, atacado,
 * variação) ou preço digitado em linha livre; desconto geral rateado entre os itens.
 */
export async function priceDocumentLines(
  db: DbClient,
  items: ItemInput[],
  documentDiscountCents: number,
  opts: { allowFreeText: boolean; now?: Date }
) {
  const now = opts.now ?? new Date()
  const ids = [...new Set(items.map((i) => i.productId).filter((v): v is number => v !== null))]
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: { variants: true } })
  const byId = new Map(products.map((p) => [p.id, p]))

  const lines = items.map((item, index) => {
    if (item.productId === null) {
      if (!opts.allowFreeText) throw validationError(`Item ${index + 1}: selecione um produto cadastrado.`)
      const gross = lineGross(item.unitPriceCents!, item.quantityMilli)
      if (item.discountCents > gross) throw validationError(`O desconto do item "${item.description}" é maior que o valor do item.`)
      return {
        index,
        productId: null,
        variantId: null,
        description: item.description!,
        isService: true,
        freeText: true,
        quantityMilli: item.quantityMilli,
        unitPriceCents: item.unitPriceCents!,
        grossCents: gross,
        itemDiscountCents: item.discountCents
      }
    }
    const p = byId.get(item.productId)
    if (!p || p.deletedAt || !p.active) throw validationError(`Produto indisponível (item ${index + 1}).`)
    if (p.hasVariants && !item.variantId) throw validationError(`Selecione a variação de "${p.name}".`)
    const v = item.variantId ? p.variants.find((x) => x.id === item.variantId) : null
    if (item.variantId && (!v || v.deletedAt || !v.active)) throw validationError(`Variação indisponível de "${p.name}".`)
    const { unitPriceCents } = unitPriceFor({ ...p, variantPriceCents: v?.salePriceCents ?? null }, item.quantityMilli, now)
    const gross = lineGross(unitPriceCents, item.quantityMilli)
    if (item.discountCents > gross) throw validationError(`O desconto do item "${p.name}" é maior que o valor do item.`)
    return {
      index,
      productId: p.id,
      variantId: v?.id ?? null,
      description: v ? `${p.name} — ${v.name}` : p.name,
      isService: p.isService,
      freeText: false,
      quantityMilli: item.quantityMilli,
      unitPriceCents,
      grossCents: gross,
      itemDiscountCents: item.discountCents
    }
  })

  const subtotalCents = lines.reduce((a, l) => a + l.grossCents, 0)
  const itemsDiscountCents = lines.reduce((a, l) => a + l.itemDiscountCents, 0)
  if (documentDiscountCents > subtotalCents - itemsDiscountCents) throw validationError('O desconto é maior que o valor total.')
  const allocated = allocate(documentDiscountCents, lines.map((l) => l.grossCents - l.itemDiscountCents))
  const priced: PricedLine[] = lines.map((l, i) => {
    const discountCents = l.itemDiscountCents + allocated[i]
    return { ...l, discountCents, totalCents: l.grossCents - discountCents }
  })
  const discountCents = itemsDiscountCents + documentDiscountCents
  const bps = discountBps(discountCents, subtotalCents)
  return {
    lines: priced,
    subtotalCents,
    itemsDiscountCents,
    documentDiscountCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    discountBps: bps.shown,
    requiredBps: bps.required
  }
}

type StoredItem = {
  id: number
  productId: number | null
  variantId: number | null
  description: string
  quantityMilli: number
  unitPriceCents: number
  discountCents: number
  totalCents: number
  product?: { unit: string; isService: boolean } | null
}

export function toLineDto(i: StoredItem): DocumentLineDto {
  return {
    id: i.id,
    productId: i.productId,
    variantId: i.variantId,
    description: i.description,
    unit: i.product?.unit ?? 'UN',
    isService: i.product ? i.product.isService : true,
    freeText: i.productId === null,
    quantityMilli: i.quantityMilli,
    unitPriceCents: i.unitPriceCents,
    discountCents: i.discountCents,
    totalCents: i.totalCents
  }
}
