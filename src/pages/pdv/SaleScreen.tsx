import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Minus, Percent, Plus, ScanBarcode, Trash2, TriangleAlert, UserPlus, UserRound, X } from 'lucide-react'
import type { CustomerLite, PdvItem, SaleDetail, SalePreview } from '@shared/api'
import { formatDocument } from '@shared/documents'
import { formatMoney, formatPercentBps, formatQuantity } from '@shared/format'
import { lineGross, unitPriceFor } from '@shared/salePricing'
import { isFractionalUnit, parseQuantity } from '@shared/units'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField, PercentField, QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'
import { CustomerPickerModal as CustomerModal } from '@/components/CustomerPickerModal'
import { PaymentModal } from './PaymentModal'
import { SaleCompletedModal } from './SaleCompletedModal'

export interface CartLine {
  key: string
  item: PdvItem
  quantityMilli: number
  discountCents: number
}

const keyOf = (i: PdvItem) => `${i.productId}:${i.variantId ?? ''}`
const label = (i: PdvItem) => (i.variantName ? `${i.name} — ${i.variantName}` : i.name)
const KIND_BADGE = { promo: <Badge tone="success">Promoção</Badge>, wholesale: <Badge tone="primary">Atacado</Badge>, variant: null, retail: null }

export function SaleScreen({ onSaleCompleted }: { onSaleCompleted(): void }) {
  const toast = useToast()
  const { can } = useAuth()
  const [cart, setCart] = useState<CartLine[]>([])
  const [saleDiscount, setSaleDiscount] = useState(0)
  const [customer, setCustomer] = useState<CustomerLite | null>(null)
  const [customerDocument, setCustomerDocument] = useState('')
  const [sellerId, setSellerId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PdvItem[]>([])
  // Totais do servidor + a qual carrinho eles pertencem (evita usar totais de um carrinho anterior)
  const [preview, setPreview] = useState<{ key: string; data: SalePreview } | null>(null)
  const [payPending, setPayPending] = useState(false)
  // Leituras de código ainda sendo buscadas no servidor (F8 espera por elas)
  const [scanning, setScanning] = useState(0)
  const scanningRef = useRef(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [completed, setCompleted] = useState<SaleDetail | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sellers = useAsync(() => call(api.sales.sellers()))

  // Totais oficiais vêm do servidor (preço vigente, atacado, descontos)
  const previewInput = {
    items: cart.map((l) => ({ productId: l.item.productId, variantId: l.item.variantId, quantityMilli: l.quantityMilli, discountCents: l.discountCents })),
    discountCents: saleDiscount
  }
  const previewKey = JSON.stringify(previewInput)
  const fresh = preview && preview.key === previewKey ? preview.data : null
  const debouncedInput = useDebounced(previewKey, 120)
  useEffect(() => {
    if (cart.length === 0) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    let alive = true
    call(api.sales.preview(JSON.parse(debouncedInput)))
      .then((p) => alive && (setPreview({ key: debouncedInput, data: p }), setPreviewError(null)))
      .catch((e) => alive && setPreviewError(errorMessage(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput])

  // Atalhos: F2 busca, F8 pagamento
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'F8') {
        e.preventDefault()
        // Sempre marca como pendente: o efeito abaixo decide com o estado já atualizado do carrinho
        // (o F8 pode chegar entre o item lido e a nova renderização).
        setPayPending(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length])

  // F8 antes do cálculo terminar: abre o pagamento assim que os totais atuais chegarem
  useEffect(() => {
    if (!payPending) return
    if (scanning > 0) return // aguarda os itens lidos entrarem no carrinho
    if (previewError || cart.length === 0) setPayPending(false)
    else if (fresh) {
      setPayPending(false)
      setPaying(true)
    }
  })

  const add = (item: PdvItem, quantityMilli = 1000, clear = true) => {
    setCart((c) => {
      const k = keyOf(item)
      const existing = c.find((l) => l.key === k)
      if (existing) return c.map((l) => (l.key === k ? { ...l, quantityMilli: l.quantityMilli + quantityMilli } : l))
      return [...c, { key: k, item, quantityMilli, discountCents: 0 }]
    })
    if (clear) setQuery('')
    setResults([])
    searchRef.current?.focus()
  }

  // "3*7891234" = quantidade 3 do código lido
  const parseQuery = (q: string) => {
    const m = q.match(/^(\d+(?:[.,]\d{1,3})?)\s*\*\s*(.+)$/)
    return m ? { qty: parseQuantity(m[1]) ?? 1000, term: m[2].trim() } : { qty: 1000, term: q.trim() }
  }
  const debouncedQuery = useDebounced(query, 200)
  useEffect(() => {
    const { term } = parseQuery(debouncedQuery)
    if (!term) return setResults([])
    let alive = true
    call(api.sales.searchItems({ query: term }))
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]))
    return () => {
      alive = false
    }
  }, [debouncedQuery])

  const onSearchSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const typed = query
    const { qty, term } = parseQuery(typed)
    if (!term) return
    // Libera o campo na hora: leituras rápidas em sequência não se apagam umas às outras
    setQuery('')
    scanningRef.current++
    setScanning(scanningRef.current)
    try {
      const r = await call(api.sales.searchItems({ query: term }))
      if (r.length === 1) {
        if (!isFractionalUnit(r[0].unit) && qty % 1000 !== 0) return toast.error(`${r[0].unit} não aceita quantidade fracionada.`)
        add(r[0], qty, false)
      } else if (r.length === 0) toast.warning(`Nenhum produto encontrado para "${term}".`)
      else {
        setQuery((q) => q || typed)
        setResults(r)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      scanningRef.current--
      setScanning(scanningRef.current)
    }
  }

  const update = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setCart((c) => c.filter((l) => l.key !== key))
  const reset = () => {
    setCart([])
    setSaleDiscount(0)
    setCustomer(null)
    setCustomerDocument('')
    setPreview(null)
    searchRef.current?.focus()
  }

  // Valor local apenas enquanto o servidor recalcula
  const localTotal = cart.reduce((a, l) => {
    const { unitPriceCents } = unitPriceFor({ ...l.item }, l.quantityMilli)
    return a + lineGross(unitPriceCents, l.quantityMilli) - l.discountCents
  }, 0) - saleDiscount
  const total = fresh?.totalCents ?? localTotal

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <Card className="flex min-h-[560px] flex-col">
        <form onSubmit={onSearchSubmit} className="relative border-b border-line p-4">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-7 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Código de barras, código ou nome do produto  (F2)  —  use 3*código para quantidade"
            aria-label="Buscar produto no PDV"
            className="h-12 w-full rounded-lg border border-line-strong bg-surface pr-4 pl-11 text-base text-ink placeholder:text-muted"
          />
          {results.length > 0 && query && (
            <ul role="listbox" aria-label="Resultados" className="absolute right-4 left-4 z-30 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
              {results.map((r) => {
                const { unitPriceCents } = unitPriceFor(r, 1000)
                return (
                  <li key={keyOf(r)} role="option" aria-selected={false}>
                    <button type="button" onClick={() => add(r, parseQuery(query).qty)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-primary-soft">
                      {r.imageUrl ? <img src={r.imageUrl} alt="" className="size-9 rounded object-cover" /> : <span className="size-9 rounded bg-surface-2" />}
                      <span className="flex-1">
                        <span className="block text-sm text-ink">{label(r)}</span>
                        <span className="block text-xs text-muted">
                          #{r.internalCode}
                          {r.barcode && ` · ${r.barcode}`} · estoque {formatQuantity(r.stockMilli)} {r.unit}
                        </span>
                      </span>
                      <span className="tabular text-sm font-medium text-ink">{formatMoney(unitPriceCents)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </form>

        <div className="flex-1 overflow-auto">
          {cart.length === 0 ? (
            <EmptyState icon={<ScanBarcode />} title="Carrinho vazio" description="Leia o código de barras ou busque o produto pelo nome." />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="w-44 px-2 py-2 font-medium">Quantidade</th>
                  <th className="px-2 py-2 text-right font-medium">Unitário</th>
                  <th className="w-32 px-2 py-2 font-medium">Desconto</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {cart.map((l, index) => {
                  const pl = fresh?.lines[index]
                  const step = isFractionalUnit(l.item.unit) ? 100 : 1000
                  const short = !l.item.allowNegativeStock && l.quantityMilli > l.item.stockMilli
                  const name = label(l.item)
                  return (
                    <tr key={l.key} className="border-t border-line">
                      <td className="px-4 py-2">
                        <span className="text-ink">{name}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          #{l.item.internalCode}
                          {pl && KIND_BADGE[pl.priceKind]}
                          {short && (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <TriangleAlert className="size-3" aria-hidden /> estoque {formatQuantity(l.item.stockMilli)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Diminuir ${name}`} icon={<Minus className="size-3.5" />} disabled={l.quantityMilli <= step} onClick={() => update(l.key, { quantityMilli: l.quantityMilli - step })} />
                          <QuantityField label={`Quantidade ${name}`} unit={l.item.unit} value={l.quantityMilli} onChange={(v) => v && v > 0 && update(l.key, { quantityMilli: v })} containerClassName="w-24 [&_label]:sr-only" />
                          <Button size="sm" variant="ghost" aria-label={`Aumentar ${name}`} icon={<Plus className="size-3.5" />} onClick={() => update(l.key, { quantityMilli: l.quantityMilli + step })} />
                        </div>
                      </td>
                      <td className="tabular px-2 py-2 text-right text-ink-2">{pl ? formatMoney(pl.unitPriceCents) : '…'}</td>
                      <td className="px-2 py-2">
                        <MoneyField label={`Desconto ${name}`} value={l.discountCents} onChange={(v) => update(l.key, { discountCents: v ?? 0 })} containerClassName="[&_label]:sr-only" />
                      </td>
                      <td className="tabular px-2 py-2 text-right font-medium text-ink">{pl ? formatMoney(pl.totalCents) : '…'}</td>
                      <td className="px-1">
                        <Button size="sm" variant="ghost" aria-label={`Remover ${name}`} icon={<Trash2 className="size-4 text-danger" />} onClick={() => remove(l.key)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <p className="mb-2 text-[13px] font-medium text-ink-2">Cliente</p>
          {customer ? (
            <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <UserRound className="size-4 text-muted" aria-hidden />
              <span className="flex-1 text-sm">
                <span className="block text-ink">{customer.name}</span>
                {customer.document && <span className="block text-xs text-muted">{formatDocument(customer.document)}</span>}
              </span>
              <Button size="sm" variant="ghost" aria-label="Remover cliente" icon={<X className="size-4" />} onClick={() => setCustomer(null)} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <TextField label="CPF/CNPJ na venda (opcional)" inputMode="numeric" value={customerDocument} onChange={(e) => setCustomerDocument(e.target.value)} />
              <Button size="sm" variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setCustomerOpen(true)}>
                Identificar cliente
              </Button>
            </div>
          )}
          <SelectField
            label="Vendedor"
            containerClassName="mt-3"
            value={sellerId ?? ''}
            onChange={(e) => setSellerId(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: '', label: 'O próprio operador' }, ...(sellers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Card>

        <Card className="p-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between text-ink-2">
              <dt>Subtotal ({cart.length} item(ns))</dt>
              <dd className="tabular">{formatMoney(fresh?.subtotalCents ?? 0)}</dd>
            </div>
            <div className="flex justify-between text-ink-2">
              <dt>
                Descontos
                {fresh && fresh.discountBps > 0 && <span className="ml-1 text-xs text-muted">({formatPercentBps(fresh.discountBps)})</span>}
              </dt>
              <dd className="tabular">-{formatMoney((fresh?.itemsDiscountCents ?? 0) + (fresh?.saleDiscountCents ?? saleDiscount))}</dd>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <dt className="text-base font-medium text-ink">Total</dt>
              <dd className="tabular text-3xl font-semibold text-ink" aria-label="Total da venda">
                {formatMoney(Math.max(total, 0))}
              </dd>
            </div>
          </dl>
          {fresh?.requiresAuthorization && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Desconto acima do seu limite ({formatPercentBps(fresh.maxDiscountBps)}). Será pedida a autorização de um supervisor no pagamento.
            </p>
          )}
          {previewError && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{previewError}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<Percent className="size-4" />} disabled={cart.length === 0} onClick={() => setDiscountOpen(true)}>
              Desconto
            </Button>
            <Button variant="secondary" disabled={cart.length === 0} onClick={() => setClearing(true)}>
              Cancelar venda
            </Button>
            <Button size="lg" className="col-span-2" disabled={cart.length === 0 || !!previewError} loading={payPending} onClick={() => setPayPending(true)}>
              Pagamento (F8)
            </Button>
          </div>
          {!can('pdv.discount') && <p className="mt-2 text-center text-xs text-muted">Descontos exigem autorização do supervisor.</p>}
        </Card>
      </div>

      {paying && fresh && (
        <PaymentModal
          preview={fresh}
          sale={{ ...previewInput, customerId: customer?.id ?? null, customerDocument: customer ? null : customerDocument || null, sellerId }}
          customer={customer}
          onClose={() => setPaying(false)}
          onCompleted={(sale) => {
            setPaying(false)
            setCompleted(sale)
            reset()
            onSaleCompleted()
          }}
        />
      )}
      <SaleCompletedModal sale={completed} onClose={() => { setCompleted(null); searchRef.current?.focus() }} />
      <DiscountModal
        open={discountOpen}
        subtotalCents={(fresh?.subtotalCents ?? 0) - (fresh?.itemsDiscountCents ?? 0)}
        value={saleDiscount}
        onClose={() => setDiscountOpen(false)}
        onApply={(v) => {
          setSaleDiscount(v)
          setDiscountOpen(false)
        }}
      />
      <CustomerModal open={customerOpen} onClose={() => setCustomerOpen(false)} onSelect={(c) => { setCustomer(c); setCustomerOpen(false) }} />
      <ConfirmModal open={clearing} danger title="Cancelar venda" confirmLabel="Limpar carrinho" onClose={() => setClearing(false)} onConfirm={() => { reset(); setClearing(false) }}>
        Remover todos os itens do carrinho? Nada foi registrado ainda.
      </ConfirmModal>
    </div>
  )
}

function DiscountModal({ open, subtotalCents, value, onClose, onApply }: { open: boolean; subtotalCents: number; value: number; onClose(): void; onApply(v: number): void }) {
  const [mode, setMode] = useState<'value' | 'percent'>('value')
  const [cents, setCents] = useState(value)
  const [bps, setBps] = useState<number | null>(null)
  useEffect(() => {
    if (open) {
      setCents(value)
      setBps(null)
      setMode('value')
    }
  }, [open, value])
  const result = mode === 'value' ? cents : Math.round((subtotalCents * (bps ?? 0)) / 10000)
  return (
    <Modal
      open={open}
      size="sm"
      title="Desconto na venda"
      description={`Sobre ${formatMoney(subtotalCents)}. Acima do seu limite, será pedida autorização.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onApply(0)}>
            Remover desconto
          </Button>
          <Button onClick={() => onApply(Math.min(result, subtotalCents))}>Aplicar {formatMoney(Math.min(result, subtotalCents))}</Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2" role="radiogroup">
        {(['value', 'percent'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md border px-3 py-1.5 text-[13px] ${mode === m ? 'border-primary bg-primary-soft' : 'border-line text-ink-2'}`}>
            {m === 'value' ? 'Valor (R$)' : 'Percentual (%)'}
          </button>
        ))}
      </div>
      {mode === 'value' ? <MoneyField label="Desconto em reais" value={cents} onChange={(v) => setCents(v ?? 0)} /> : <PercentField label="Desconto em %" nullable value={bps} onChange={setBps} />}
    </Modal>
  )
}
