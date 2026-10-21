import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Pencil,
  Plus,
  Power,
  Search,
  Tag,
  Trash2,
  TriangleAlert,
  Upload,
  Zap
} from 'lucide-react'
import type { ProductListInput } from '@shared/catalogSchemas'
import type { ProductListItem } from '@shared/api'
import { formatMoney, formatPercentBps, formatQuantity } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { LabelsModal } from './LabelsModal'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'
import { ImportModal } from './ImportModal'
import { QuickCreateModal } from './QuickCreateModal'

const PAGE_SIZE = 50
const selectClass = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

export function ProductList() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canManage = can('products.manage')
  const canCost = can('products.cost')

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Omit<ProductListInput, 'search' | 'page'>>({ status: 'active', stock: 'all' })
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const query = { ...filters, search: debounced || undefined, page, pageSize: PAGE_SIZE }
  const { data, error, loading, reload } = useAsync(() => call(api.products.list(query)), [JSON.stringify(query)])
  const categories = useAsync(() => call(api.categories.list()))
  const suppliers = useAsync(() => (canManage ? call(api.suppliers.list({ includeInactive: true })) : Promise.resolve([])))

  const [quickOpen, setQuickOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [removing, setRemoving] = useState<ProductListItem | null>(null)

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  const exportCsv = async () => {
    try {
      const r = await call(api.products.exportCsv())
      if (r) toast.success(`${r.count} produto(s) exportado(s) para ${r.path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const toggleActive = async (p: ProductListItem) => {
    try {
      await call(api.products.setActive({ id: p.id, active: !p.active }))
      toast.success(p.active ? 'Produto desativado.' : 'Produto ativado.')
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

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
            placeholder="Buscar por nome, código, SKU ou código de barras…"
            aria-label="Buscar produtos"
            className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
          />
        </div>
        <select aria-label="Categoria" className={selectClass} value={filters.categoryId ?? ''} onChange={(e) => setFilter('categoryId', e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">Todas as categorias</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
            </option>
          ))}
        </select>
        {canManage && (
          <select aria-label="Fornecedor" className={selectClass} value={filters.supplierId ?? ''} onChange={(e) => setFilter('supplierId', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Todos os fornecedores</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Situação" className={selectClass} value={filters.status} onChange={(e) => setFilter('status', e.target.value as 'active')}>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="all">Todos</option>
        </select>
        <select aria-label="Estoque" className={selectClass} value={filters.stock} onChange={(e) => setFilter('stock', e.target.value as 'all')}>
          <option value="all">Qualquer estoque</option>
          <option value="low">Estoque baixo</option>
          <option value="out">Esgotados</option>
        </select>
        <label className="flex items-center gap-2 px-1 text-sm text-ink-2">
          <input type="checkbox" checked={!!filters.promo} onChange={(e) => setFilter('promo', e.target.checked || undefined)} className="accent-[var(--primary)]" />
          Em promoção
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Tag className="size-4" />} onClick={() => setLabelsOpen(true)}>
            Etiquetas
          </Button>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportCsv()}>
            Exportar
          </Button>
          {canManage && (
            <>
              <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
              <Button variant="secondary" icon={<Zap className="size-4" />} onClick={() => setQuickOpen(true)}>
                Cadastro rápido
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/produtos/novo')}>
                Novo produto
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.items.length === 0 && (
        <EmptyState
          title={debounced || filters.categoryId || filters.stock !== 'all' || filters.promo ? 'Nenhum produto encontrado com estes filtros' : 'Nenhum produto cadastrado'}
          description={canManage ? 'Cadastre produtos um a um, pelo cadastro rápido ou importando uma planilha.' : undefined}
        />
      )}
      {data && data.items.length > 0 && (
        <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <th className="w-14 px-4 py-2.5" />
                <th className="px-2 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Categoria</th>
                <th className="px-3 py-2.5 text-right font-medium">Preço</th>
                {canCost && <th className="px-3 py-2.5 text-right font-medium">Custo · Margem</th>}
                <th className="px-3 py-2.5 text-right font-medium">Estoque</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                  <td className="px-4 py-2">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="size-10 rounded-md border border-line object-cover" />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-md bg-surface-2 text-muted">
                        <ImageOff className="size-4" aria-hidden />
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => navigate(`/produtos/${p.id}`)} className="text-left font-medium text-ink hover:text-primary">
                      {p.name}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="selectable">#{p.internalCode}</span>
                      {p.sku && <span className="selectable">SKU {p.sku}</span>}
                      {p.barcode && <span className="selectable">EAN {p.barcode}</span>}
                      {p.hasVariants && <Badge>{p.variantCount} variações</Badge>}
                      {p.pricingMode === 'AUTOMATIC' && <Badge tone="primary">Preço automático</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {p.categoryName ?? '—'}
                    {p.subcategoryName && <span className="block text-xs text-muted">{p.subcategoryName}</span>}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {p.promoActive ? (
                      <>
                        <span className="block font-medium text-success">{formatMoney(p.effectivePriceCents)}</span>
                        <span className="text-xs text-muted line-through">{formatMoney(p.salePriceCents)}</span>
                      </>
                    ) : (
                      <span className="font-medium text-ink">{formatMoney(p.salePriceCents)}</span>
                    )}
                  </td>
                  {canCost && (
                    <td className="tabular px-3 py-2 text-right text-ink-2">
                      {p.totalCostCents !== null && p.totalCostCents > 0 ? formatMoney(p.totalCostCents) : '—'}
                      <span className="block text-xs">
                        {p.grossMarginBps !== null && p.totalCostCents ? (
                          p.lowMargin ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <TriangleAlert className="size-3" aria-hidden /> {formatPercentBps(p.grossMarginBps)}
                            </span>
                          ) : (
                            <span className="text-muted">{formatPercentBps(p.grossMarginBps)}</span>
                          )
                        ) : null}
                      </span>
                    </td>
                  )}
                  <td className="tabular px-3 py-2 text-right">
                    <span className="text-ink">
                      {formatQuantity(p.stockMilli)} <span className="text-xs text-muted">{p.unit}</span>
                    </span>
                    {p.stockStatus !== 'ok' && (
                      <span className="mt-0.5 block">
                        <Badge tone={p.stockStatus === 'out' ? 'danger' : 'warning'}>{p.stockStatus === 'out' ? 'Esgotado' : 'Baixo'}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{p.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => navigate(`/produtos/${p.id}`)}>
                        {canManage ? 'Editar' : 'Ver'}
                      </Button>
                      {canManage && (
                        <>
                          <Button size="sm" variant="ghost" title={p.active ? 'Desativar' : 'Ativar'} aria-label={p.active ? `Desativar ${p.name}` : `Ativar ${p.name}`} icon={<Power className="size-3.5" />} onClick={() => void toggleActive(p)} />
                          <Button size="sm" variant="ghost" title="Excluir" aria-label={`Excluir ${p.name}`} icon={<Trash2 className="size-3.5 text-danger" />} onClick={() => setRemoving(p)} />
                        </>
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

      <QuickCreateModal
        open={quickOpen}
        categories={categories.data ?? []}
        onClose={() => setQuickOpen(false)}
        onCreated={() => void reload()}
      />
      {labelsOpen && <LabelsModal onClose={() => setLabelsOpen(false)} />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void reload()} />
      <ConfirmModal
        open={!!removing}
        danger
        title="Excluir produto"
        confirmLabel="Excluir"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await call(api.products.remove({ id: removing.id }))
            toast.success('Produto excluído.')
            setRemoving(null)
            void reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        <p>
          Excluir <strong className="text-ink">{removing?.name}</strong>? O produto deixa de aparecer nas listas e o SKU e o
          código de barras ficam livres para reutilização. O histórico de vendas e movimentações é preservado.
        </p>
        <p className="mt-2 text-muted">Produtos com estoque não podem ser excluídos — desative-os.</p>
      </ConfirmModal>
    </Card>
  )
}
