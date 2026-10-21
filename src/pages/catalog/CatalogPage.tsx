import { useState } from 'react'
import { BookOpen, ImageOff, Search } from 'lucide-react'
import type { CatalogInput } from '@shared/commerceSchemas'
import { formatMoney } from '@shared/format'
import { Card, PageHeader } from '@/components/ui/Card'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call } from '@/services/api'
import { PrintButtons } from '../documents/shared'

export function CatalogPage() {
  const categories = useAsync(() => call(api.categories.list()))
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [inStockOnly, setInStockOnly] = useState(true)
  const [promoOnly, setPromoOnly] = useState(false)
  const [showPrices, setShowPrices] = useState(true)
  const [title, setTitle] = useState('')
  const debouncedSearch = useDebounced(search)
  const debouncedTitle = useDebounced(title)
  const input: CatalogInput = {
    search: debouncedSearch || undefined,
    categoryIds: categoryId ? [Number(categoryId)] : [],
    inStockOnly,
    promoOnly,
    showPrices,
    title: debouncedTitle || null
  }
  const { data, error, loading } = useAsync(() => call(api.catalog.data(input)), [JSON.stringify(input)])

  return (
    <div className="animate-in">
      <PageHeader
        title="Catálogo"
        description="Vitrine dos produtos ativos com imagens e preços atuais, pronta para imprimir ou enviar em PDF."
        actions={<PrintButtons print={() => api.catalog.print(input)} savePdf={() => api.catalog.savePdf(input)} />}
      />
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar produtos…"
              aria-label="Filtrar produtos do catálogo"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <SelectField
            label="Categoria"
            containerClassName="w-52"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[{ value: '', label: 'Todas' }, ...(categories.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} › ${c.name}` : c.name }))]}
          />
          <TextField label="Título" placeholder="Catálogo de produtos" containerClassName="w-60" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-6 border-t border-line px-4 py-3">
          <Checkbox label="Somente com estoque" checked={inStockOnly} onChange={setInStockOnly} />
          <Checkbox label="Somente em promoção" checked={promoOnly} onChange={setPromoOnly} />
          <Checkbox label="Mostrar preços" checked={showPrices} onChange={setShowPrices} />
        </div>
      </Card>

      {error && <ErrorState message={error} />}
      {!data && loading && <Spinner />}
      {data && data.productCount === 0 && (
        <Card>
          <EmptyState icon={<BookOpen />} title="Nenhum produto para exibir" description="Ajuste os filtros ou cadastre produtos ativos." />
        </Card>
      )}
      {data && data.productCount > 0 && (
        <div className={`flex flex-col gap-6 ${loading ? 'opacity-60' : ''}`}>
          <p className="text-sm text-muted">{data.productCount} produto(s)</p>
          {data.categories.map((cat) => (
            <section key={cat.name} aria-label={cat.name}>
              <h2 className="mb-3 text-[15px] font-semibold text-ink">{cat.name}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
                {cat.products.map((p) => (
                  <Card key={p.id} className="flex flex-col overflow-hidden">
                    <div className="flex aspect-square items-center justify-center bg-surface-2">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <ImageOff className="size-8 text-muted" aria-hidden />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <p className="text-sm font-medium text-ink">{p.name}</p>
                      {p.variants.length > 0 && <p className="text-xs text-muted">{p.variants.join(' · ')}</p>}
                      {p.description && <p className="line-clamp-2 text-xs text-ink-2">{p.description}</p>}
                      <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-2">
                        {data.showPrices && (
                          <>
                            <span className="tabular text-base font-semibold text-ink">{formatMoney(p.priceCents)}</span>
                            {p.promo && <span className="tabular text-xs text-muted line-through">{formatMoney(p.regularPriceCents)}</span>}
                            <span className="text-xs text-muted">/{p.unit}</span>
                          </>
                        )}
                        {p.promo && <Badge tone="success">Promoção</Badge>}
                        {!p.inStock && <Badge>Sem estoque</Badge>}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
