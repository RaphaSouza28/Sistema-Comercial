import { effectivePrice, isPromoActive } from './pricing'

/** Dados de preço de um produto/variação usados no PDV. */
export interface PriceSource {
  salePriceCents: number
  promoPriceCents: number | null
  promoStartsAt: Date | string | null
  promoEndsAt: Date | string | null
  wholesalePriceCents: number | null
  wholesaleMinMilli: number | null
  /** Preço próprio da variação (substitui o do produto, sem promoção/atacado). */
  variantPriceCents?: number | null
}

export type PriceKind = 'retail' | 'promo' | 'wholesale' | 'variant'

/**
 * Preço unitário vigente para a quantidade informada:
 *  - variação com preço próprio → preço da variação;
 *  - atacado quando a quantidade atinge o mínimo e é mais barato que o varejo vigente;
 *  - senão, promoção vigente ou preço de venda.
 */
export function unitPriceFor(p: PriceSource, quantityMilli: number, now: Date = new Date()): { unitPriceCents: number; kind: PriceKind } {
  if (p.variantPriceCents !== null && p.variantPriceCents !== undefined) return { unitPriceCents: p.variantPriceCents, kind: 'variant' }
  const retail = effectivePrice(p, now)
  if (
    p.wholesalePriceCents !== null &&
    p.wholesaleMinMilli !== null &&
    p.wholesaleMinMilli > 0 &&
    quantityMilli >= p.wholesaleMinMilli &&
    p.wholesalePriceCents < retail
  ) {
    return { unitPriceCents: p.wholesalePriceCents, kind: 'wholesale' }
  }
  return { unitPriceCents: retail, kind: isPromoActive(p, now) ? 'promo' : 'retail' }
}

/** Valor bruto de uma linha (preço × quantidade em milésimos), arredondado ao centavo. */
export function lineGross(unitPriceCents: number, quantityMilli: number): number {
  return Math.round((unitPriceCents * quantityMilli) / 1000)
}

/** Distribui um valor entre linhas proporcionalmente aos pesos (maiores restos), somando exatamente o total. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (total === 0 || sum === 0) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sum)
  const floor = raw.map(Math.floor)
  let rest = total - floor.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - floor[i] })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (rest <= 0) break
    floor[i]++
    rest--
  }
  return floor
}
