import { useEffect, useState } from 'react'
import { ArrowLeft, Lock, UserRound } from 'lucide-react'
import type { SaleDetail, SalePreview, SaleSource } from '@shared/api'
import { formatDocument } from '@shared/documents'
import { formatMoney, formatQuantity } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAsync } from '@/hooks/useAsync'
import { api, call } from '@/services/api'
import { PaymentModal } from './PaymentModal'
import { SaleCompletedModal } from './SaleCompletedModal'

/** Totais do documento no formato do pagamento (o desconto já foi autorizado no pedido/orçamento). */
function previewFromSource(s: SaleSource): SalePreview {
  const itemsDiscountCents = s.lines.reduce((a, l) => a + l.discountCents, 0)
  return {
    lines: s.lines.map((l, index) => ({
      index,
      description: l.description,
      unitPriceCents: l.unitPriceCents,
      priceKind: 'retail',
      grossCents: l.totalCents + l.discountCents,
      discountCents: l.discountCents,
      totalCents: l.totalCents
    })),
    subtotalCents: s.subtotalCents,
    itemsDiscountCents,
    saleDiscountCents: s.discountCents,
    totalCents: s.totalCents,
    discountBps: 0,
    maxDiscountBps: 0,
    requiresAuthorization: false
  }
}

/** Venda de um pedido ou orçamento: itens e preços combinados, sem edição no PDV. */
export function SourceSaleScreen({ source, onExit, onSaleCompleted }: { source: { orderId?: number; quoteId?: number }; onExit(): void; onSaleCompleted(): void }) {
  const { data, error, reload } = useAsync(() => call(api.sales.source(source)), [source.orderId, source.quoteId])
  const sellers = useAsync(() => call(api.sales.sellers()))
  const [sellerId, setSellerId] = useState<number | null>(null)
  const [customerDocument, setCustomerDocument] = useState('')
  const [paying, setPaying] = useState(false)
  const [completed, setCompleted] = useState<SaleDetail | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8' && data && !completed) {
        e.preventDefault()
        setPaying(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, completed])

  const title = source.orderId ? `Pedido #${source.orderId}` : `Orçamento #${source.quoteId}`
  if (error)
    return (
      <div className="flex flex-col gap-3">
        <ErrorState message={error} onRetry={() => void reload()} />
        <Button variant="secondary" className="w-fit" icon={<ArrowLeft className="size-4" />} onClick={onExit}>
          Voltar para venda normal
        </Button>
      </div>
    )
  if (!data) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <Card className="flex min-h-[420px] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Lock className="size-4 text-muted" aria-hidden /> Venda do {title.toLowerCase()} — itens e preços combinados
          </p>
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onExit}>
            Sair sem vender
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-2 py-2 text-right font-medium">Quantidade</th>
              <th className="px-2 py-2 text-right font-medium">Unitário</th>
              <th className="px-2 py-2 text-right font-medium">Desconto</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-4 py-2 text-ink">{l.description}</td>
                <td className="tabular px-2 py-2 text-right text-ink-2">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                <td className="tabular px-2 py-2 text-right text-ink-2">{formatMoney(l.unitPriceCents)}</td>
                <td className="tabular px-2 py-2 text-right text-ink-2">{l.discountCents ? `-${formatMoney(l.discountCents)}` : '—'}</td>
                <td className="tabular px-4 py-2 text-right font-medium text-ink">{formatMoney(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <p className="mb-2 text-[13px] font-medium text-ink-2">Cliente</p>
          {data.customer ? (
            <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <UserRound className="size-4 text-muted" aria-hidden />
              <span className="flex-1 text-sm">
                <span className="block text-ink">{data.customer.name}</span>
                {data.customer.document && <span className="block text-xs text-muted">{formatDocument(data.customer.document)}</span>}
              </span>
            </div>
          ) : (
            <TextField label="CPF/CNPJ na venda (opcional)" inputMode="numeric" value={customerDocument} onChange={(e) => setCustomerDocument(e.target.value)} />
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
              <dt>Subtotal</dt>
              <dd className="tabular">{formatMoney(data.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between text-ink-2">
              <dt>Descontos</dt>
              <dd className="tabular">-{formatMoney(data.subtotalCents - data.totalCents)}</dd>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <dt className="text-base font-medium text-ink">Total</dt>
              <dd className="tabular text-3xl font-semibold text-ink" aria-label="Total da venda">
                {formatMoney(data.totalCents)}
              </dd>
            </div>
          </dl>
          <Button size="lg" className="mt-4 w-full" disabled={!!completed} onClick={() => setPaying(true)}>
            Pagamento (F8)
          </Button>
        </Card>
      </div>

      {paying && (
        <PaymentModal
          preview={previewFromSource(data)}
          customer={data.customer ? { ...data.customer, creditLimitCents: undefined, creditAvailableCents: undefined } : null}
          sale={{
            items: [],
            discountCents: 0,
            customerId: null,
            customerDocument: data.customer ? null : customerDocument || null,
            sellerId,
            orderId: source.orderId ?? null,
            quoteId: source.quoteId ?? null
          }}
          onClose={() => setPaying(false)}
          onCompleted={(sale) => {
            setPaying(false)
            setCompleted(sale)
            onSaleCompleted()
          }}
        />
      )}
      <SaleCompletedModal sale={completed} onClose={() => { setCompleted(null); onExit() }} />
    </div>
  )
}
