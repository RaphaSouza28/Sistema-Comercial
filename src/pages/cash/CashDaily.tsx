import { useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Ban, Scale, ShoppingBag, Undo2 } from 'lucide-react'
import { formatDateTime, formatInteger, formatMoney, toDateKey } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { StatTile } from '@/components/dashboard/StatTile'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAsync } from '@/hooks/useAsync'
import { api, call } from '@/services/api'
import { DifferenceBadge } from './CashHistory'

const todayKey = () => toDateKey()

export function CashDaily() {
  const [date, setDate] = useState(todayKey())
  const { data, error, loading } = useAsync(() => call(api.cash.daily({ date })), [date])

  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-fit items-center gap-2 text-sm text-ink-2">
        Dia
        <input type="date" aria-label="Dia do relatório" value={date} max={todayKey()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink" />
      </label>
      {error && <ErrorState message={error} />}
      {!data && loading && <Spinner />}
      {data && (
        <>
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-3" aria-label="Totais do dia" role="region">
            <StatTile label="Vendas do dia" value={formatMoney(data.salesTotalCents)} hint={`${formatInteger(data.salesCount)} venda(s)`} icon={<ShoppingBag />} />
            <StatTile label="Cancelamentos" value={formatMoney(data.cancelledTotalCents)} hint={`${formatInteger(data.cancelledCount)} venda(s)`} icon={<Ban />} />
            <StatTile label="Reembolsos de devoluções" value={formatMoney(data.refundsCents)} icon={<Undo2 />} />
            <StatTile label="Suprimentos" value={formatMoney(data.suppliesCents)} icon={<ArrowDownCircle />} />
            <StatTile label="Sangrias" value={formatMoney(data.withdrawalsCents)} icon={<ArrowUpCircle />} />
            <StatTile label="Diferenças de caixa" value={formatMoney(data.differenceTotalCents)} hint="Caixas fechados no dia" icon={<Scale />} />
          </section>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
            <Card>
              <CardHeader title="Movimento líquido por forma" />
              {data.byMethod.length === 0 ? (
                <EmptyState title="Sem movimentação" />
              ) : (
                <dl className="px-5 pb-4 text-sm">
                  {data.byMethod.map((m) => (
                    <div key={m.method} className="flex justify-between border-t border-line py-2">
                      <dt className="text-ink-2">{PAYMENT_METHOD_LABELS[m.method] ?? m.method}</dt>
                      <dd className="tabular font-medium text-ink">{formatMoney(m.netCents)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
            <Card>
              <CardHeader title="Caixas abertos no dia" />
              {data.sessions.length === 0 ? (
                <EmptyState title="Nenhum caixa aberto neste dia" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                      <th className="px-5 py-2 font-medium">Caixa</th>
                      <th className="px-3 py-2 font-medium">Operador</th>
                      <th className="px-3 py-2 font-medium">Abertura</th>
                      <th className="px-3 py-2 text-right font-medium">Vendas</th>
                      <th className="px-5 py-2 font-medium">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2 font-medium text-ink">#{s.id} {s.status === 'OPEN' && <span className="text-xs text-primary">(aberto)</span>}</td>
                        <td className="px-3 py-2 text-ink-2">{s.userName}</td>
                        <td className="tabular px-3 py-2 text-ink-2">{formatDateTime(s.openedAt)}</td>
                        <td className="tabular px-3 py-2 text-right text-ink-2">{formatMoney(s.salesTotalCents)}</td>
                        <td className="px-5 py-2">
                          <DifferenceBadge cents={s.differenceCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
