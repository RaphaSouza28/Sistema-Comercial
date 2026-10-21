import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react'
import type { StockItem, StockMovementDto } from '@shared/api'
import { formatDateTime, formatMoney, formatQuantity } from '@shared/format'
import { MOVEMENT_TYPES } from '@shared/stockSchemas'
import { stockItemLabel } from '@/components/StockItemPicker'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { STOCK_MOVEMENT_LABELS } from '@shared/labels'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'

export const MOVEMENT_LABEL: Record<StockMovementDto['type'], string> = STOCK_MOVEMENT_LABELS

const PAGE_SIZE = 50
const inputClass = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

export function MovementsTab({ version, item, onClearItem }: { version: number; item: StockItem | null; onClearItem(): void }) {
  const { can } = useAuth()
  const toast = useToast()
  const canCost = can('products.cost')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<StockMovementDto['type'] | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const filter = {
    search: debounced || undefined,
    type: type || undefined,
    from: from || undefined,
    to: to || undefined,
    productId: item?.productId,
    variantId: item?.variantId ?? undefined
  }
  const query = { ...filter, page, pageSize: PAGE_SIZE }
  const { data, error, loading } = useAsync(() => call(api.stock.movements(query)), [JSON.stringify(query), version])
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const reset = () => setPage(1)

  const exportCsv = async () => {
    try {
      const r = await call(api.stock.exportMovements(filter))
      if (r) toast.success(`${r.count} movimentação(ões) exportada(s) para ${r.path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        {item ? (
          <span className="flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-sm text-ink">
            {stockItemLabel(item)}
            <button type="button" onClick={onClearItem} aria-label="Remover filtro de produto" className="text-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); reset() }}
              placeholder="Produto ou nº do documento…"
              aria-label="Buscar movimentações"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
        )}
        <select aria-label="Tipo de movimentação" className={inputClass} value={type} onChange={(e) => { setType(e.target.value as typeof type); reset() }}>
          <option value="">Todos os tipos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          De <input type="date" aria-label="Data inicial" className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); reset() }} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          até <input type="date" aria-label="Data final" className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); reset() }} />
        </label>
        <Button className="ml-auto" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportCsv()}>
          Exportar CSV
        </Button>
      </div>

      {error && (
        <div className="p-4">
          <ErrorState message={error} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title="Nenhuma movimentação encontrada" />}
      {data && data.items.length > 0 && (
        <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <th className="px-5 py-2.5 font-medium">Data e hora</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 text-right font-medium">Quantidade</th>
                <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                {canCost && <th className="px-3 py-2.5 text-right font-medium">Custo unit.</th>}
                <th className="px-3 py-2.5 font-medium">Motivo / referência</th>
                <th className="px-5 py-2.5 font-medium">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="tabular px-5 py-2.5 whitespace-nowrap text-ink-2">{formatDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={m.quantityMilli > 0 ? 'success' : 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink">
                    {m.productName}
                    {m.variantName && <span className="text-ink-2"> — {m.variantName}</span>}
                    <span className="block text-xs text-muted">#{m.internalCode}</span>
                  </td>
                  <td className={`tabular px-3 py-2.5 text-right font-medium ${m.quantityMilli > 0 ? 'text-success' : 'text-danger'}`}>
                    {m.quantityMilli > 0 ? '+' : ''}
                    {formatQuantity(m.quantityMilli)} <span className="text-xs font-normal text-muted">{m.unit}</span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatQuantity(m.balanceAfterMilli)}</td>
                  {canCost && <td className="tabular px-3 py-2.5 text-right text-ink-2">{m.unitCostCents !== null ? formatMoney(m.unitCostCents) : '—'}</td>}
                  <td className="max-w-80 px-3 py-2.5 text-ink-2">
                    {m.reason ?? '—'}
                    {(m.supplierName || m.documentNumber) && (
                      <span className="block text-xs text-muted">{[m.supplierName, m.documentNumber && `Doc. ${m.documentNumber}`].filter(Boolean).join(' · ')}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-ink-2">{m.userName ?? '—'}</td>
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
    </Card>
  )
}
