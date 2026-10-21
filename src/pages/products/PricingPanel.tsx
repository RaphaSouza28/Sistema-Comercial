import { Info, TriangleAlert } from 'lucide-react'
import { formatMoney, formatPercentBps } from '@shared/format'
import { analyzePrice, suggestPrice, totalUnitCost, type CostInput, type RatesInput } from '@shared/pricing'
import { Button } from '@/components/ui/Button'

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-ink-2">
        {label}
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </dt>
      <dd className={`tabular text-right ${strong ? 'text-base font-semibold text-ink' : 'text-sm text-ink'}`}>{value}</dd>
    </div>
  )
}

/** Calculadora de preço: custo total, preço sugerido e análise do preço praticado. */
export function PricingPanel({
  cost,
  rates,
  targetMarginBps,
  priceCents,
  minMarginBps,
  automatic,
  canApply,
  onApplySuggested
}: {
  cost: CostInput
  rates: RatesInput
  targetMarginBps: number | null
  priceCents: number
  minMarginBps: number
  automatic: boolean
  canApply: boolean
  onApplySuggested(priceCents: number): void
}) {
  const total = totalUnitCost(cost)
  const suggestion = targetMarginBps !== null ? suggestPrice(total, targetMarginBps, rates) : null
  const a = analyzePrice(cost, priceCents, rates)
  const pct = (bps: number | null) => (bps === null ? '—' : formatPercentBps(bps))
  const lowMargin = total > 0 && priceCents > 0 && a.grossMarginBps !== null && a.grossMarginBps < minMarginBps

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4" aria-label="Calculadora de preço">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Calculadora</p>
      <dl className="mt-2 divide-y divide-line">
        <Row label="Custo total unitário" hint="Custo + frete + embalagem + outros" value={formatMoney(total)} />
        <div className="py-2">
          <Row
            label="Preço sugerido"
            hint={targetMarginBps !== null ? `Custo ÷ (1 − ${pct(targetMarginBps)} margem − taxas)` : 'Informe a margem desejada'}
            value={suggestion?.ok ? formatMoney(suggestion.priceCents) : '—'}
            strong
          />
          {suggestion && !suggestion.ok && <p className="text-xs text-danger">{suggestion.reason}</p>}
          {suggestion?.ok && !automatic && canApply && suggestion.priceCents !== priceCents && (
            <Button size="sm" variant="secondary" className="mt-1 w-full" onClick={() => onApplySuggested(suggestion.priceCents)}>
              Usar preço sugerido
            </Button>
          )}
        </div>
      </dl>

      <p className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">Com o preço de {formatMoney(priceCents)}</p>
      <dl className="mt-1 divide-y divide-line">
        <Row label="Lucro bruto" hint="Preço − custo total" value={formatMoney(a.grossProfitCents)} />
        <Row label="Margem bruta" hint="Lucro bruto ÷ preço" value={pct(a.grossMarginBps)} />
        <Row
          label="Markup"
          hint="Preço ÷ custo"
          value={a.markupFactorBps === null ? '—' : `${(a.markupFactorBps / 10000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}× (${pct(a.markupBps)})`}
        />
        <Row label="Custos variáveis" hint="Impostos + cartão + comissão" value={formatMoney(a.variableCostsCents)} />
        <Row
          label="Resultado após custos variáveis"
          hint="Não é lucro líquido: não inclui despesas fixas"
          value={`${formatMoney(a.resultAfterVariableCents)} (${pct(a.resultAfterVariableBps)})`}
          strong
        />
      </dl>

      {lowMargin && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Margem abaixo do mínimo configurado ({formatPercentBps(minMarginBps)}).
        </p>
      )}
      {a.grossProfitCents < 0 && priceCents > 0 && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Preço abaixo do custo: cada venda dá prejuízo.
        </p>
      )}
      {automatic && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Precificação automática: o preço de venda é recalculado pela margem desejada sempre que o produto é salvo.
        </p>
      )}
    </div>
  )
}
