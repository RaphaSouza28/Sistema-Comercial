import type { CashSummary } from '@shared/api'
import { formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'

const COLUMNS: { key: keyof CashSummary['byMethod'][number]; label: string }[] = [
  { key: 'openingCents', label: 'Abertura' },
  { key: 'salesCents', label: 'Vendas' },
  { key: 'cancelsCents', label: 'Cancel.' },
  { key: 'refundsCents', label: 'Reembolsos' },
  { key: 'suppliesCents', label: 'Suprim.' },
  { key: 'withdrawalsCents', label: 'Sangrias' },
  { key: 'otherInCents', label: 'Outras ent.' },
  { key: 'otherOutCents', label: 'Outras saí.' }
]

/** Esperado por forma de pagamento (e contado/diferença quando o caixa foi fechado). */
export function CashSummaryTable({ summary }: { summary: CashSummary }) {
  const rows = summary.byMethod.filter((m) => m.method === 'CASH' || COLUMNS.some((c) => m[c.key] !== 0) || m.countedCents !== null)
  const showCounted = rows.some((m) => m.countedCents !== null)
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[13px]" aria-label="Resumo por forma de pagamento">
        <thead className="bg-surface-2 text-left text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Forma</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Esperado</th>
            {showCounted && <th className="px-2 py-2 text-right font-medium">Contado</th>}
            {showCounted && <th className="px-3 py-2 text-right font-medium">Diferença</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.method} className="border-t border-line">
              <td className="px-3 py-2 font-medium text-ink">{PAYMENT_METHOD_LABELS[m.method]}</td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="tabular px-2 py-2 text-right whitespace-nowrap text-ink-2">
                  {m[c.key] ? formatMoney(m[c.key] as number) : '—'}
                </td>
              ))}
              <td className="tabular px-3 py-2 text-right font-semibold whitespace-nowrap text-ink">{formatMoney(m.expectedCents)}</td>
              {showCounted && <td className="tabular px-2 py-2 text-right text-ink-2">{m.countedCents === null ? '—' : formatMoney(m.countedCents)}</td>}
              {showCounted && (
                <td className={`tabular px-3 py-2 text-right font-medium ${!m.differenceCents ? 'text-muted' : m.differenceCents > 0 ? 'text-success' : 'text-danger'}`}>
                  {m.differenceCents === null ? '—' : formatMoney(m.differenceCents)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
