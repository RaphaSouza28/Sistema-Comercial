import { useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { formatDateTime, formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call } from '@/services/api'
import { SaleDetailModal } from './SaleDetailModal'

const PAGE_SIZE = 50
const inputClass = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

export function SalesHistory({ onChanged }: { onChanged(): void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'COMPLETED' | 'CANCELLED'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const debounced = useDebounced(search)
  const query = { search: debounced || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }
  const { data, error, loading, reload } = useAsync(() => call(api.sales.list(query)), [JSON.stringify(query)])
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const reset = () => setPage(1)

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); reset() }} placeholder="Nº da venda, cliente ou CPF…" aria-label="Buscar vendas" className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted" />
        </div>
        <select aria-label="Situação da venda" className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); reset() }}>
          <option value="">Todas</option>
          <option value="COMPLETED">Concluídas</option>
          <option value="CANCELLED">Canceladas</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          De <input type="date" aria-label="Data inicial" className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); reset() }} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          até <input type="date" aria-label="Data final" className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); reset() }} />
        </label>
      </div>
      {error && (
        <div className="p-4">
          <ErrorState message={error} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title="Nenhuma venda encontrada" />}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <th className="px-5 py-2.5 font-medium">Venda</th>
                <th className="px-3 py-2.5 font-medium">Data</th>
                <th className="px-3 py-2.5 font-medium">Cliente</th>
                <th className="px-3 py-2.5 font-medium">Pagamento</th>
                <th className="px-3 py-2.5 font-medium">Operador</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-5 py-2.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-hover/60" onClick={() => setOpenId(s.id)}>
                  <td className="px-5 py-2.5">
                    <button type="button" className="font-medium text-ink hover:text-primary" onClick={() => setOpenId(s.id)}>
                      #{s.id}
                    </button>
                    <span className="block text-xs text-muted">{s.itemCount} item(ns)</span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-ink-2">{formatDateTime(s.createdAt)}</td>
                  <td className="px-3 py-2.5 text-ink-2">{s.customerName ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-2">{s.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(' + ')}</td>
                  <td className="px-3 py-2.5 text-ink-2">{s.operatorName}</td>
                  <td className={`tabular px-3 py-2.5 text-right font-medium ${s.status === 'CANCELLED' ? 'text-muted line-through' : 'text-ink'}`}>{formatMoney(s.totalCents)}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex gap-1">
                      {s.status === 'CANCELLED' ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="success">Concluída</Badge>}
                      {s.hasReturns && <Badge tone="warning">Devolução</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} de {data.total}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Próxima <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      {openId !== null && (
        <SaleDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            void reload()
            onChanged()
          }}
        />
      )}
    </Card>
  )
}
