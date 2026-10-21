import { useEffect, useState } from 'react'
import { Plus, Search, Trash2, TriangleAlert, UserRound, X } from 'lucide-react'
import type { CustomerLite, DocumentPreview, PdvItem } from '@shared/api'
import type { DocumentItemInput } from '@shared/commerceSchemas'
import { formatDocument } from '@shared/documents'
import { formatMoney, formatPercentBps } from '@shared/format'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'
import { CustomerPickerModal } from './CustomerPickerModal'
import { Button } from './ui/Button'
import { TextField } from './ui/Field'
import { MoneyField, QuantityField } from './ui/NumberFields'

export interface EditorLine {
  key: string
  productId: number | null
  variantId: number | null
  description: string
  unit: string
  quantityMilli: number
  discountCents: number
  /** Somente em linhas livres (texto). */
  unitPriceCents: number | null
}

export interface DocumentValue {
  customer: CustomerLite | null
  lines: EditorLine[]
  discountCents: number
}

let seq = 0
export const newLineKey = () => `l${++seq}`

export function toItemsInput(lines: EditorLine[]): DocumentItemInput[] {
  return lines.map((l) =>
    l.productId !== null
      ? { productId: l.productId, variantId: l.variantId, quantityMilli: l.quantityMilli, discountCents: l.discountCents }
      : { description: l.description, unitPriceCents: l.unitPriceCents ?? 0, quantityMilli: l.quantityMilli, discountCents: l.discountCents }
  )
}

/** Itens, cliente e descontos de pedidos/orçamentos, com totais calculados pelo servidor. */
export function DocumentEditor({
  value,
  onChange,
  allowFreeText,
  onPreview
}: {
  value: DocumentValue
  onChange(v: DocumentValue): void
  allowFreeText: boolean
  onPreview(p: DocumentPreview | null): void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PdvItem[]>([])
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const debouncedQuery = useDebounced(query, 200)
  const key = JSON.stringify({ items: toItemsInput(value.lines), discountCents: value.discountCents })
  const debouncedKey = useDebounced(key, 150)

  useEffect(() => {
    if (!debouncedQuery.trim()) return setResults([])
    let alive = true
    call(api.sales.searchItems({ query: debouncedQuery }))
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]))
    return () => {
      alive = false
    }
  }, [debouncedQuery])

  useEffect(() => {
    const input = JSON.parse(debouncedKey) as { items: DocumentItemInput[]; discountCents: number }
    if (input.items.length === 0) {
      setPreview(null)
      onPreview(null)
      setError(null)
      return
    }
    let alive = true
    call(api.documents.preview(input))
      .then((p) => {
        if (!alive) return
        // Só vale para os itens atuais (evita exibir totais de uma versão anterior)
        const current = debouncedKey === key ? p : null
        setPreview(current)
        onPreview(current)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setPreview(null)
        onPreview(null)
        setError(errorMessage(e))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey])

  const set = (patch: Partial<DocumentValue>) => onChange({ ...value, ...patch })
  const update = (k: string, patch: Partial<EditorLine>) => set({ lines: value.lines.map((l) => (l.key === k ? { ...l, ...patch } : l)) })
  const addProduct = (i: PdvItem) => {
    setQuery('')
    setResults([])
    const existing = value.lines.find((l) => l.productId === i.productId && l.variantId === i.variantId)
    if (existing) return update(existing.key, { quantityMilli: existing.quantityMilli + 1000 })
    set({
      lines: [
        ...value.lines,
        { key: newLineKey(), productId: i.productId, variantId: i.variantId, description: i.variantName ? `${i.name} — ${i.variantName}` : i.name, unit: i.unit, quantityMilli: 1000, discountCents: 0, unitPriceCents: null }
      ]
    })
  }
  const addFree = () =>
    set({ lines: [...value.lines, { key: newLineKey(), productId: null, variantId: null, description: '', unit: 'UN', quantityMilli: 1000, discountCents: 0, unitPriceCents: 0 }] })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink-2">Cliente</p>
        {value.customer ? (
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
            <UserRound className="size-4 text-muted" aria-hidden />
            <span className="flex-1 text-sm">
              <span className="text-ink">{value.customer.name}</span>
              {value.customer.document && <span className="ml-2 text-xs text-muted">{formatDocument(value.customer.document)}</span>}
            </span>
            <Button size="sm" variant="ghost" aria-label="Remover cliente" icon={<X className="size-4" />} onClick={() => set({ customer: null })} />
          </div>
        ) : (
          <Button variant="secondary" icon={<UserRound className="size-4" />} onClick={() => setCustomerOpen(true)}>
            Selecionar cliente
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Adicionar produto ou serviço (nome ou código)…"
          aria-label="Adicionar produto ao documento"
          className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
        />
        {results.length > 0 && query && (
          <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
            {results.map((r) => (
              <li key={`${r.productId}:${r.variantId}`} role="option" aria-selected={false}>
                <button type="button" onClick={() => addProduct(r)} className="flex w-full justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-primary-soft">
                  <span className="text-ink">{r.variantName ? `${r.name} — ${r.variantName}` : r.name}</span>
                  <span className="text-xs text-muted">#{r.internalCode}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {value.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="w-32 px-2 py-2 font-medium">Qtd.</th>
                <th className="w-32 px-2 py-2 font-medium">Unitário</th>
                <th className="w-32 px-2 py-2 font-medium">Desconto</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {value.lines.map((l, index) => {
                const pl = preview?.lines[index]
                const name = l.description || `item ${index + 1}`
                return (
                  <tr key={l.key} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      {l.productId === null ? (
                        <TextField label={`Descrição do item ${index + 1}`} placeholder="Descrição (texto livre)" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} containerClassName="[&_label]:sr-only" />
                      ) : (
                        <span className="text-ink">{l.description}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <QuantityField label={`Quantidade ${name}`} unit={l.unit} value={l.quantityMilli} onChange={(v) => v && v > 0 && update(l.key, { quantityMilli: v })} containerClassName="[&_label]:sr-only" />
                    </td>
                    <td className="px-2 py-1.5">
                      {l.productId === null ? (
                        <MoneyField label={`Preço ${name}`} value={l.unitPriceCents ?? 0} onChange={(v) => update(l.key, { unitPriceCents: v ?? 0 })} containerClassName="[&_label]:sr-only" />
                      ) : (
                        <span className="tabular text-ink-2">{pl ? formatMoney(pl.unitPriceCents) : '…'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <MoneyField label={`Desconto ${name}`} value={l.discountCents} onChange={(v) => update(l.key, { discountCents: v ?? 0 })} containerClassName="[&_label]:sr-only" />
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-medium text-ink">{pl ? formatMoney(pl.totalCents) : '…'}</td>
                    <td className="px-1">
                      <Button size="sm" variant="ghost" aria-label={`Remover ${name}`} icon={<Trash2 className="size-4 text-danger" />} onClick={() => set({ lines: value.lines.filter((x) => x.key !== l.key) })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {allowFreeText && (
        <Button size="sm" variant="ghost" className="w-fit" icon={<Plus className="size-4" />} onClick={addFree}>
          Adicionar item de texto livre
        </Button>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <MoneyField label="Desconto geral" containerClassName="w-48" value={value.discountCents} onChange={(v) => set({ discountCents: v ?? 0 })} />
        <dl className="min-w-64 text-sm">
          <div className="flex justify-between gap-6 text-ink-2">
            <dt>Subtotal</dt>
            <dd className="tabular">{formatMoney(preview?.subtotalCents ?? 0)}</dd>
          </div>
          <div className="flex justify-between gap-6 text-ink-2">
            <dt>Descontos {preview && preview.discountBps > 0 && <span className="text-xs text-muted">({formatPercentBps(preview.discountBps)})</span>}</dt>
            <dd className="tabular">-{formatMoney((preview?.itemsDiscountCents ?? 0) + (preview?.documentDiscountCents ?? 0))}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-6 border-t border-line pt-2 text-base font-semibold text-ink">
            <dt>Total</dt>
            <dd className="tabular" aria-label="Total do documento">
              {formatMoney(preview?.totalCents ?? 0)}
            </dd>
          </div>
        </dl>
      </div>
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      {preview?.requiresAuthorization && (
        <p className="flex items-center gap-2 text-xs text-warning">
          <TriangleAlert className="size-3.5" aria-hidden /> Desconto acima do seu limite: será pedida a autorização do supervisor ao salvar.
        </p>
      )}
      <CustomerPickerModal open={customerOpen} onClose={() => setCustomerOpen(false)} onSelect={(c) => { set({ customer: c }); setCustomerOpen(false) }} />
    </div>
  )
}
