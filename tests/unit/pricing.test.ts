import { describe, expect, it } from 'vitest'
import { analyzePrice, effectivePrice, isPromoActive, suggestPrice, totalUnitCost } from '../../shared/pricing'

describe('precificação', () => {
  it('exemplo da especificação: camiseta com custo total R$ 47,00 e margem 30% → R$ 67,14', () => {
    const cost = { costCents: 4000, freightCents: 500, packagingCents: 200 }
    expect(totalUnitCost(cost)).toBe(4700)
    expect(suggestPrice(4700, 3000)).toEqual({ ok: true, priceCents: 6714 })
  })

  it('inclui taxas percentuais no denominador', () => {
    // 47,00 / (1 − 0,30 − 0,06 − 0,04) = 78,33
    expect(suggestPrice(4700, 3000, { taxBps: 600, cardFeeBps: 400 })).toEqual({ ok: true, priceCents: 7833 })
  })

  it('recusa denominador menor ou igual a zero', () => {
    const r = suggestPrice(4700, 9000, { taxBps: 1000 })
    expect(r.ok).toBe(false)
    expect(suggestPrice(4700, 10000).ok).toBe(false)
    expect(suggestPrice(4700, -1).ok).toBe(false)
  })

  it('diferencia margem, markup, lucro bruto e resultado após custos variáveis', () => {
    const a = analyzePrice({ costCents: 4700 }, 6714, { cardFeeBps: 300 })
    expect(a.grossProfitCents).toBe(2014)
    expect(a.grossMarginBps).toBe(3000) // 30,00% sobre o preço
    expect(a.markupBps).toBe(4285) // 42,85% sobre o custo
    expect(a.markupFactorBps).toBe(14285) // 1,4285×
    expect(a.variableCostsCents).toBe(201) // 3% de 67,14
    expect(a.resultAfterVariableCents).toBe(1813)
  })

  it('trata preço e custo zerados sem dividir por zero', () => {
    const a = analyzePrice({ costCents: 0 }, 0)
    expect(a.grossMarginBps).toBeNull()
    expect(a.markupBps).toBeNull()
    expect(analyzePrice({ costCents: 1000 }, 800).grossProfitCents).toBe(-200)
  })

  it('aplica preço promocional apenas dentro da vigência', () => {
    const p = {
      salePriceCents: 5000,
      promoPriceCents: 3990,
      promoStartsAt: new Date(2026, 9, 10),
      promoEndsAt: new Date(2026, 9, 20, 23, 59, 59)
    }
    expect(effectivePrice(p, new Date(2026, 9, 15))).toBe(3990)
    expect(effectivePrice(p, new Date(2026, 9, 9))).toBe(5000)
    expect(effectivePrice(p, new Date(2026, 9, 21))).toBe(5000)
    expect(isPromoActive({ promoPriceCents: null, promoStartsAt: null, promoEndsAt: null })).toBe(false)
  })
})
