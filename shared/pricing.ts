/**
 * Precificação — funções puras usadas pela calculadora (interface) e pelos serviços.
 *
 * Unidades: valores em centavos inteiros; percentuais em pontos-base (1% = 100 bps).
 *
 * Definições (sempre sobre o preço de venda, exceto o markup):
 *   custo total unitário   = custo de aquisição + frete + embalagem + outros custos
 *   preço sugerido         = custo total / (1 − margem desejada − taxas percentuais)
 *   lucro bruto            = preço − custo total
 *   margem bruta (%)       = lucro bruto / preço
 *   markup (multiplicador) = preço / custo total          (ex.: 1,43×)
 *   markup (%)             = (preço − custo total) / custo total
 *   custos variáveis       = preço × (impostos + taxa de cartão + comissão)
 *   resultado após custos variáveis = lucro bruto − custos variáveis
 *     (não é lucro líquido: não inclui despesas fixas como aluguel e salários)
 */

export const BPS = 10000

export interface CostInput {
  costCents: number
  freightCents?: number | null
  packagingCents?: number | null
  otherCostsCents?: number | null
}

export interface RatesInput {
  taxBps?: number | null
  cardFeeBps?: number | null
  commissionBps?: number | null
}

export function totalUnitCost(c: CostInput): number {
  return c.costCents + (c.freightCents ?? 0) + (c.packagingCents ?? 0) + (c.otherCostsCents ?? 0)
}

export function variableRateBps(r: RatesInput): number {
  return (r.taxBps ?? 0) + (r.cardFeeBps ?? 0) + (r.commissionBps ?? 0)
}

export type SuggestResult = { ok: true; priceCents: number } | { ok: false; reason: string }

/** Preço sugerido = custo total / (1 − margem − taxas). Arredonda para o centavo mais próximo. */
export function suggestPrice(totalCostCents: number, targetMarginBps: number, rates: RatesInput = {}): SuggestResult {
  if (totalCostCents < 0) return { ok: false, reason: 'O custo não pode ser negativo.' }
  if (targetMarginBps < 0) return { ok: false, reason: 'A margem desejada não pode ser negativa.' }
  const denominator = BPS - targetMarginBps - variableRateBps(rates)
  if (denominator <= 0) {
    return { ok: false, reason: 'A soma da margem desejada com as taxas deve ser menor que 100%.' }
  }
  return { ok: true, priceCents: Math.round((totalCostCents * BPS) / denominator) }
}

export interface PriceAnalysis {
  totalCostCents: number
  priceCents: number
  grossProfitCents: number
  /** Margem bruta sobre o preço, em bps. null quando o preço é zero. */
  grossMarginBps: number | null
  /** Markup como multiplicador × 10000 (1,43× = 14300). null quando o custo é zero. */
  markupFactorBps: number | null
  /** Markup percentual sobre o custo, em bps. null quando o custo é zero. */
  markupBps: number | null
  variableCostsCents: number
  resultAfterVariableCents: number
  resultAfterVariableBps: number | null
}

export function analyzePrice(cost: CostInput, priceCents: number, rates: RatesInput = {}): PriceAnalysis {
  const totalCostCents = totalUnitCost(cost)
  const grossProfitCents = priceCents - totalCostCents
  const variableCostsCents = Math.round((priceCents * variableRateBps(rates)) / BPS)
  const resultAfterVariableCents = grossProfitCents - variableCostsCents
  return {
    totalCostCents,
    priceCents,
    grossProfitCents,
    grossMarginBps: priceCents > 0 ? Math.round((grossProfitCents * BPS) / priceCents) : null,
    markupFactorBps: totalCostCents > 0 ? Math.round((priceCents * BPS) / totalCostCents) : null,
    markupBps: totalCostCents > 0 ? Math.round((grossProfitCents * BPS) / totalCostCents) : null,
    variableCostsCents,
    resultAfterVariableCents,
    resultAfterVariableBps: priceCents > 0 ? Math.round((resultAfterVariableCents * BPS) / priceCents) : null
  }
}

/** Promoção vigente na data informada (datas inclusivas; sem datas = vigente enquanto houver preço promocional). */
export function isPromoActive(
  p: { promoPriceCents: number | null; promoStartsAt: Date | string | null; promoEndsAt: Date | string | null },
  now: Date = new Date()
): boolean {
  if (p.promoPriceCents === null || p.promoPriceCents === undefined) return false
  if (p.promoStartsAt && new Date(p.promoStartsAt) > now) return false
  if (p.promoEndsAt && new Date(p.promoEndsAt) < now) return false
  return true
}

/** Preço de varejo vigente: promocional quando ativo, senão o preço de venda. */
export function effectivePrice(
  p: {
    salePriceCents: number
    promoPriceCents: number | null
    promoStartsAt: Date | string | null
    promoEndsAt: Date | string | null
  },
  now: Date = new Date()
): number {
  return isPromoActive(p, now) ? (p.promoPriceCents as number) : p.salePriceCents
}
