import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, History, Search, SlidersHorizontal } from 'lucide-react'
import type { StockItem, StockItemStatus } from '@shared/api'
import type { StockOverviewInput } from '@shared/stockSchemas'
import { formatDateTime, formatMoney, formatQuantity } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call } from '@/services/api'

const PAGE_SIZE = 50
const selectClass = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

export const STATUS_BADGE: Record<StockItemStatus, ReactNode> = {
  ok: null,
  low: <Badge tone="warning">Baixo</Badge>,
  out: <Badge tone="danger">Esgotado</Badge>,
  negative: <Badge tone="danger">Negativo</Badge>
}

export function OverviewTab({
  version,
  onAdjust,
  onHistory
}: {
  version: number
  onAdjust?: (item: StockItem) => void
  onHistory(item: StockItem): void
}) {
  const { can } = useAuth()
  const canCost = can('products.cost')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<NonNullable<StockOverviewInput['status']>>('all')
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const query = { search: debounced || undefined, status, categoryId, page, pageSize: PAGE_SIZE }
  const { data, error, loading, reload } = useAsync(() => call(api.stock.overview(query)), [JSON.stringify(query), version])
  const categories = useAsync(() => call(api.categories.list()))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Consultar disponibilidade por nome, código ou código de barras…"
            aria-label="Buscar no estoque"
            className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
          />
        </div>
        <select aria-label="Categoria" className={selectClass} value={categoryId ?? ''} onChange={(e) => { setCategoryId(e.target.value ? Number(e.target.value) : undefined); setPage(1) }}>
          <option value="">Todas as categorias</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
            </option>
          ))}
        </select>
        <select aria-label="Situação do estoque" className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1) }}>
          <option value="all">Todos os itens</option>
          <option value="low">Reposição (baixo ou esgotado)</option>
          <option value="out">Esgotados</option>
          <option value="negative">Negativos</option>
          <option value="stale">Sem movimentação há 90 dias</option>
        </select>
      </div>

      {error && (
        <div className="p-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title="Nenhum item encontrado" />}
      {data && data.items.length > 0 && (
        <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <th className="px-5 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Categoria</th>
                <th className="px-3 py-2.5 text-right font-medium">Estoque</th>
                <th className="px-3 py-2.5 text-right font-medium">Mínimo</th>
                {canCost && <th className="px-3 py-2.5 text-right font-medium">Custo unit.</th>}
                {canCost && <th className="px-3 py-2.5 text-right font-medium">Valor</th>}
                <th className="px-3 py-2.5 font-medium">Última movimentação</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={`${i.productId}:${i.variantId}`} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                  <td className="px-5 py-2.5">
                    <span className="font-medium text-ink">{i.name}</span>
                    {i.variantName && <span className="text-ink-2"> — {i.variantName}</span>}
                    <span className="block text-xs text-muted">
                      #{i.internalCode}
                      {i.barcode && ` · ${i.barcode}`}
                      {!i.active && ' · inativo'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{i.categoryName ?? '—'}</td>
                  <td className="tabular px-3 py-2.5 text-right">
                    <span className={`font-medium ${i.stockMilli < 0 ? 'text-danger' : 'text-ink'}`}>{formatQuantity(i.stockMilli)}</span>{' '}
                    <span className="text-xs text-muted">{i.unit}</span>
                    {STATUS_BADGE[i.status] && <span className="ml-2">{STATUS_BADGE[i.status]}</span>}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{i.minStockMilli ? formatQuantity(i.minStockMilli) : '—'}</td>
                  {canCost && <td className="tabular px-3 py-2.5 text-right text-ink-2">{i.unitCostCents ? formatMoney(i.unitCostCents) : '—'}</td>}
                  {canCost && <td className="tabular px-3 py-2.5 text-right text-ink">{i.stockValueCents ? formatMoney(i.stockValueCents) : '—'}</td>}
                  <td className="px-3 py-2.5 text-ink-2">{i.lastMovementAt ? formatDateTime(i.lastMovementAt) : 'Nunca'}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Histórico de ${i.name}`} icon={<History className="size-3.5" />} onClick={() => onHistory(i)}>
                        Histórico
                      </Button>
                      {onAdjust && (
                        <Button size="sm" variant="ghost" aria-label={`Ajustar ${i.name}${i.variantName ? ' ' + i.variantName : ''}`} icon={<SlidersHorizontal className="size-3.5" />} onClick={() => onAdjust(i)}>
                          Ajustar
                        </Button>
                      )}
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
    </Card>
  )
}
