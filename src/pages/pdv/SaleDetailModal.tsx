import { useState } from 'react'
import { Ban, FileDown, Printer, Undo2 } from 'lucide-react'
import type { SaleDetail } from '@shared/api'
import { formatDocument } from '@shared/documents'
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { REFUND_METHODS, type RefundMethod } from '@shared/salesSchemas'

const INSTALLMENT_STATUS: Record<string, string> = { OPEN: 'em aberto', PARTIAL: 'parcial', PAID: 'paga', CANCELLED: 'cancelada' }
import { AuthorizationFields, type AuthorizationValue } from '@/components/AuthorizationFields'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'
import { useReceipt } from './SaleCompletedModal'

type Mode = 'view' | 'cancel' | 'return'

export function SaleDetailModal({ id, onClose, onChanged }: { id: number; onClose(): void; onChanged(): void }) {
  const { can } = useAuth()
  const toast = useToast()
  const receipt = useReceipt()
  const { data, error, loading, setData } = useAsync(() => call(api.sales.get({ id })), [id])
  const [mode, setMode] = useState<Mode>('view')
  const [reason, setReason] = useState('')
  const [auth, setAuth] = useState<AuthorizationValue>({ username: '', password: '' })
  const [returnQty, setReturnQty] = useState<Record<number, number>>({})
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('VOUCHER')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const startMode = (m: Mode) => {
    setMode(m)
    setReason('')
    setActionError(null)
    setReturnQty({})
    setRequestId(crypto.randomUUID())
  }

  const cancel = async () => {
    setBusy(true)
    setActionError(null)
    try {
      const updated = await call(api.sales.cancel({ saleId: id, reason, ...(can('pdv.cancel') ? {} : { authorization: auth }) }))
      setData(updated)
      setMode('view')
      toast.success(`Venda #${id} cancelada. Estoque e caixa estornados.`)
      onChanged()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const doReturn = async () => {
    setBusy(true)
    setActionError(null)
    try {
      const items = Object.entries(returnQty)
        .filter(([, q]) => q > 0)
        .map(([saleItemId, quantityMilli]) => ({ saleItemId: Number(saleItemId), quantityMilli }))
      const r = await call(api.sales.returnItems({ requestId, saleId: id, items, reason, refundMethod, ...(can('pdv.return') ? {} : { authorization: auth }) }))
      setData(await call(api.sales.get({ id })))
      setMode('view')
      toast.success(r.voucherCode ? `Devolução registrada. Vale-troca ${r.voucherCode} de ${formatMoney(r.refundCents)}.` : `Devolução registrada (${formatMoney(r.refundCents)}).`)
      onChanged()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const footer = (s: SaleDetail) => {
    if (mode === 'cancel')
      return (
        <>
          <Button variant="secondary" onClick={() => setMode('view')} disabled={busy}>
            Voltar
          </Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void cancel()}>
            Confirmar cancelamento
          </Button>
        </>
      )
    if (mode === 'return')
      return (
        <>
          <Button variant="secondary" onClick={() => setMode('view')} disabled={busy}>
            Voltar
          </Button>
          <Button loading={busy} disabled={reason.trim().length < 3 || !Object.values(returnQty).some((q) => q > 0)} onClick={() => void doReturn()}>
            Registrar devolução
          </Button>
        </>
      )
    return (
      <>
        <Button variant="secondary" icon={<Printer className="size-4" />} loading={receipt.busy} onClick={() => void receipt.print(s.id)}>
          Imprimir
        </Button>
        <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={receipt.busy} onClick={() => void receipt.pdf(s.id)}>
          PDF
        </Button>
        {s.status === 'COMPLETED' && (
          <>
            <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => startMode('return')}>
              Devolução / troca
            </Button>
            {s.returns.length === 0 && (
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => startMode('cancel')}>
                Cancelar venda
              </Button>
            )}
          </>
        )}
      </>
    )
  }

  const returnTotal = data
    ? data.items.reduce((a, i) => a + Math.round((i.totalCents * (returnQty[i.id] ?? 0)) / i.quantityMilli), 0)
    : 0

  return (
    <Modal open size="lg" title={`Venda #${id}`} description={data ? `${formatDateTime(data.createdAt)} · operador ${data.operatorName}` : undefined} onClose={onClose} locked={busy} footer={data && footer(data)}>
      {error && <ErrorState message={error} />}
      {!data && loading && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {data.status === 'CANCELLED' ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="success">Concluída</Badge>}
            {data.customer && <Badge>{data.customer.name}</Badge>}
            {data.customerDocument && <Badge>CPF/CNPJ {formatDocument(data.customerDocument)}</Badge>}
            {data.sellerName && <Badge>Vendedor: {data.sellerName}</Badge>}
            {data.discountAuthorizedByName && <Badge tone="warning">Desconto autorizado por {data.discountAuthorizedByName}</Badge>}
          </div>
          {data.status === 'CANCELLED' && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Cancelada em {formatDateTime(data.cancelledAt)} por {data.cancelledByName}: {data.cancelReason}
            </p>
          )}

          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-2 py-2 text-right font-medium">Qtd.</th>
                <th className="px-2 py-2 text-right font-medium">Unitário</th>
                <th className="px-2 py-2 text-right font-medium">Desconto</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                {mode === 'return' && <th className="w-36 px-2 py-2 font-medium">Devolver</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const remaining = i.quantityMilli - i.returnedMilli
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">
                      {i.description}
                      {i.returnedMilli > 0 && <span className="block text-xs text-warning">Devolvido: {formatQuantity(i.returnedMilli)}</span>}
                    </td>
                    <td className="tabular px-2 py-2 text-right text-ink-2">
                      {formatQuantity(i.quantityMilli)} {i.unit}
                    </td>
                    <td className="tabular px-2 py-2 text-right text-ink-2">{formatMoney(i.unitPriceCents)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-2">{i.discountCents ? '-' + formatMoney(i.discountCents) : '—'}</td>
                    <td className="tabular px-3 py-2 text-right text-ink">{formatMoney(i.totalCents)}</td>
                    {mode === 'return' && (
                      <td className="px-2 py-1.5">
                        {remaining > 0 ? (
                          <QuantityField
                            label={`Devolver ${i.description}`}
                            unit={i.unit}
                            value={returnQty[i.id] ?? 0}
                            onChange={(v) => setReturnQty({ ...returnQty, [i.id]: Math.min(v ?? 0, remaining) })}
                            containerClassName="[&_label]:sr-only"
                          />
                        ) : (
                          <span className="text-xs text-muted">Já devolvido</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Pagamentos</p>
              {data.payments.map((p, idx) => (
                <p key={idx} className="flex justify-between text-ink-2">
                  <span>
                    {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                    {p.installments > 1 && ` ${p.installments}x`}
                    {p.voucherCode && ` ${p.voucherCode}`}
                    {p.status === 'CANCELLED' && ' (estornado)'}
                  </span>
                  <span className="tabular">{formatMoney(p.amountCents)}</span>
                </p>
              ))}
              {data.changeCents > 0 && (
                <p className="flex justify-between text-ink-2">
                  <span>Troco</span>
                  <span className="tabular">{formatMoney(data.changeCents)}</span>
                </p>
              )}
            </div>
            <dl className="flex flex-col gap-1">
              <div className="flex justify-between text-ink-2">
                <dt>Subtotal</dt>
                <dd className="tabular">{formatMoney(data.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>Descontos</dt>
                <dd className="tabular">-{formatMoney(data.discountCents)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold text-ink">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(data.totalCents)}</dd>
              </div>
            </dl>
          </div>

          {data.installments.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Parcelas do crediário</p>
              {data.installments.map((i) => (
                <div key={i.id} className="flex items-center justify-between border-t border-line py-1.5 text-sm text-ink-2">
                  <span>
                    {i.number}ª parcela · vence {formatDate(i.dueDate)} · {INSTALLMENT_STATUS[i.status] ?? i.status}
                  </span>
                  <span className="tabular">
                    {formatMoney(i.amountCents)}
                    {i.receivedCents > 0 && i.status !== 'PAID' && <span className="ml-1 text-xs text-muted">(recebido {formatMoney(i.receivedCents)})</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data.returns.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Devoluções</p>
              {data.returns.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-t border-line py-1.5 text-sm text-ink-2">
                  <span>
                    #{r.id} · {formatDateTime(r.createdAt)} · {REFUND_METHODS[r.refundMethod as RefundMethod] ?? r.refundMethod}
                    {r.voucherCode && <strong className="ml-1 text-ink">{r.voucherCode}</strong>} · {r.reason}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatMoney(r.refundCents)}</span>
                    <Button size="sm" variant="ghost" aria-label={`Imprimir devolução ${r.id}`} icon={<Printer className="size-3.5" />} onClick={() => void receipt.print(id, r.id)} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {mode !== 'view' && (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              {actionError && <ErrorState message={actionError} />}
              {mode === 'return' && (
                <div className="flex items-end gap-3">
                  <SelectField
                    label="Reembolso"
                    containerClassName="flex-1"
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
                    options={Object.entries(REFUND_METHODS)
                      .filter(([value]) => value !== 'STORE_CREDIT' || data.installments.length > 0)
                      .map(([value, label]) => ({ value, label }))}
                  />
                  <p className="pb-2 text-sm text-ink-2">
                    Valor: <strong className="tabular text-ink">{formatMoney(refundMethod === 'NONE' ? 0 : returnTotal)}</strong>
                  </p>
                </div>
              )}
              <TextField label={mode === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da devolução'} required value={reason} onChange={(e) => setReason(e.target.value)} />
              {mode === 'cancel' && !can('pdv.cancel') && <AuthorizationFields value={auth} onChange={setAuth} reason="O cancelamento estorna estoque e caixa e precisa de autorização." />}
              {mode === 'return' && !can('pdv.return') && <AuthorizationFields value={auth} onChange={setAuth} reason="Devoluções precisam de autorização." />}
              {mode === 'cancel' && <p className="text-xs text-muted">Os itens voltam ao estoque e os valores são estornados no seu caixa aberto.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
