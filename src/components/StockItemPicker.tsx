import { useEffect, useRef, useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import type { StockItem } from '@shared/api'
import { formatQuantity } from '@shared/format'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'

export const stockItemLabel = (i: Pick<StockItem, 'name' | 'variantName'>) => (i.variantName ? `${i.name} — ${i.variantName}` : i.name)

/**
 * Busca de produto/variação por nome ou código. Leitores de código de barras USB
 * "digitam" o código e enviam Enter: se houver um único resultado, ele é selecionado.
 */
export function StockItemPicker({
  onSelect,
  placeholder = 'Buscar produto ou ler código de barras…',
  autoFocus,
  label = 'Adicionar produto'
}: {
  onSelect(item: StockItem): void
  placeholder?: string
  autoFocus?: boolean
  label?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockItem[]>([])
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const debounced = useDebounced(query, 200)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const blurTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  const search = async (q: string) => {
    const id = ++seq.current
    if (!q.trim()) {
      setResults([])
      return []
    }
    try {
      const r = await call(api.stock.search({ query: q.trim() }))
      if (id === seq.current) {
        setResults(r)
        setIndex(0)
        setMessage(r.length ? null : 'Nenhum produto encontrado')
      }
      return r
    } catch (e) {
      if (id === seq.current) {
        setResults([])
        setMessage(errorMessage(e))
      }
      return []
    }
  }

  useEffect(() => {
    void search(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const choose = (item: StockItem, clear = true) => {
    onSelect(item)
    if (clear) setQuery('')
    setResults([])
    setOpen(false)
    setMessage(null)
    inputRef.current?.focus()
  }

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const code = query.trim()
      if (!code) return
      // Lista já carregada para o texto digitado: escolhe o item destacado
      if (debounced === query && results.length > 0) return choose(results.length === 1 ? results[0] : results[index])
      // Leitor de código: libera o campo na hora, para a próxima leitura não ser apagada
      // quando esta busca terminar (leitores USB enviam vários códigos em sequência rápida).
      setQuery('')
      const list = await search(code)
      if (list.length === 1) choose(list[0], false)
      else {
        // Nenhum ou vários resultados: devolve o código ao campo (se nada novo foi digitado) para o usuário ver/escolher
        setQuery((q) => q || code)
        setOpen(true)
      }
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      <label className="sr-only" htmlFor="stock-picker">
        {label}
      </label>
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="stock-picker"
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            // Cancela um fechamento agendado por um blur anterior (senão a lista some logo após reabrir)
            window.clearTimeout(blurTimer.current)
            setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150)
          }}
          onKeyDown={(e) => void onKeyDown(e)}
          className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="stock-picker-list"
        />
      </div>
      {open && query && (results.length > 0 || message) && (
        <ul id="stock-picker-list" role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.productId}:${r.variantId}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${i === index ? 'bg-primary-soft' : ''}`}
              >
                <span>
                  <span className="block text-ink">{stockItemLabel(r)}</span>
                  <span className="block text-xs text-muted">
                    #{r.internalCode}
                    {r.barcode && ` · ${r.barcode}`}
                    {r.sku && ` · ${r.sku}`}
                  </span>
                </span>
                <span className="tabular text-xs text-ink-2">
                  {formatQuantity(r.stockMilli)} {r.unit}
                </span>
              </button>
            </li>
          ))}
          {message && results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{message}</li>}
        </ul>
      )}
    </div>
  )
}
