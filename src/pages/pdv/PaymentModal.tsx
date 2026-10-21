import { useEffect, useRef, useState } from 'react'
import { Banknote, CreditCard, Gift, NotebookPen, QrCode, Trash2, Wallet } from 'lucide-react'
import type { CustomerLite, SaleDetail, SalePreview } from '@shared/api'
import type { SalePreviewInput } from '@shared/salesSchemas'
import { formatMoney, formatPercentBps, toDateKey } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import type { SalePaymentMethod } from '@shared/salesSchemas'
import { CARD_BRANDS } from '@shared/integrationSchemas'
import { AuthorizationFields, type AuthorizationValue } from '@/components/AuthorizationFields'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { api, call, errorMessage } from '@/services/api'

interface PaymentLine {
  method: SalePaymentMethod
  amountCents: number
  installments: number
  label: string | null
  voucherCode: string | null
  firstDueDate: string | null
  nsu: string | null
  authorizationCode: string | null
  cardBrand: (typeof CARD_BRANDS)[number] | null
}

const METHODS: { method: SalePaymentMethod; icon: typeof Banknote }[] = [
  { method: 'CASH', icon: Banknote },
  { method: 'PIX', icon: QrCode },
  { method: 'DEBIT_CARD', icon: CreditCard },
  { method: 'CREDIT_CARD', icon: CreditCard },
  { method: 'STORE_CREDIT', icon: NotebookPen },
  { method: 'VOUCHER', icon: Gift },
  { method: 'OTHER', icon: Wallet }
]

export function PaymentModal({
  preview,
  sale,
  customer,
  onClose,
  onCompleted
}: {
  preview: SalePreview
  /** Cliente identificado (crediário exige cliente com limite). */
  customer: CustomerLite | null
  /** Venda de pedido/orçamento: orderId/quoteId e itens vazios (os do documento valem). */
  sale: SalePreviewInput & { customerId: number | null; customerDocument: string | null; sellerId: number | null; orderId?: number | null; quoteId?: number | null }
  onClose(): void
  onCompleted(sale: SaleDetail): void
}) {
  // Um identificador por tentativa de pagamento: reenvio (duplo clique, falha de rede) devolve a mesma venda
  const [requestId] = useState(() => crypto.randomUUID())
  const total = preview.totalCents
  const [payments, setPayments] = useState<PaymentLine[]>([])
  const [method, setMethod] = useState<SalePaymentMethod>('CASH')
  const [amount, setAmount] = useState<number>(total)
  const [installments, setInstallments] = useState(1)
  const [label, setLabel] = useState('')
  const [voucherCode, setVoucherCode] = useState('')
  const [voucherInfo, setVoucherInfo] = useState<string | null>(null)
  const [firstDueDate, setFirstDueDate] = useState(() => toDateKey(new Date(), 30))
  const [nsu, setNsu] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [brand, setBrand] = useState('')
  const isCard = method === 'DEBIT_CARD' || method === 'CREDIT_CARD'
  const [auth, setAuth] = useState<AuthorizationValue>({ username: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const finalizeRef = useRef<HTMLButtonElement>(null)

  const paid = payments.reduce((a, p) => a + p.amountCents, 0)
  const nonCash = payments.filter((p) => p.method !== 'CASH').reduce((a, p) => a + p.amountCents, 0)
  const remaining = Math.max(total - paid, 0)
  const change = nonCash <= total ? Math.max(paid - total, 0) : 0
  const ready = paid >= total && nonCash <= total

  useEffect(() => setAmount(remaining), [remaining])

  const add = () => {
    setError(null)
    if (amount <= 0) return setError('Informe o valor.')
    if (method !== 'CASH' && nonCash + amount > total) return setError('Somente o dinheiro pode ultrapassar o total (troco).')
    if (method === 'VOUCHER' && !voucherCode.trim()) return setError('Informe o código do vale-troca.')
    if (isCard && nsu && !/^\d{1,12}$/.test(nsu)) return setError('NSU: até 12 dígitos (nunca digite o número do cartão).')
    if (isCard && authCode && !/^[A-Za-z0-9]{1,12}$/.test(authCode)) return setError('Autorização: até 12 letras ou números.')
    if (method === 'STORE_CREDIT') {
      if (!customer) return setError('Identifique o cliente para vender no crediário.')
      if (customer.creditLimitCents === null) return setError('Este cliente não tem crediário liberado.')
      if (payments.some((p) => p.method === 'STORE_CREDIT')) return setError('Use uma única linha de crediário.')
      if (customer.creditAvailableCents != null && amount > customer.creditAvailableCents) return setError(`Limite insuficiente: disponível ${formatMoney(customer.creditAvailableCents)}.`)
      if (!firstDueDate) return setError('Informe o vencimento da 1ª parcela.')
    }
    setPayments((p) => [
      ...p,
      {
        method,
        amountCents: amount,
        installments: method === 'CREDIT_CARD' || method === 'STORE_CREDIT' ? installments : 1,
        label: method === 'OTHER' ? label || null : null,
        voucherCode: method === 'VOUCHER' ? voucherCode.trim().toUpperCase() : null,
        firstDueDate: method === 'STORE_CREDIT' ? firstDueDate : null,
        nsu: isCard ? nsu || null : null,
        authorizationCode: isCard ? authCode.toUpperCase() || null : null,
        cardBrand: isCard && brand ? (brand as (typeof CARD_BRANDS)[number]) : null
      }
    ])
    setVoucherCode('')
    setVoucherInfo(null)
    setLabel('')
    setInstallments(1)
    setNsu('')
    setAuthCode('')
    setBrand('')
    setTimeout(() => finalizeRef.current?.focus(), 0)
  }

  const checkVoucher = async () => {
    try {
      const v = await call(api.sales.voucher({ code: voucherCode }))
      setVoucherInfo(v ? `Saldo disponível: ${formatMoney(v.balanceCents)}` : 'Vale-troca não encontrado.')
      if (v) setAmount(Math.min(v.balanceCents, remaining))
    } catch (e) {
      setVoucherInfo(errorMessage(e))
    }
  }

  const finalize = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await call(
        api.sales.finalize({
          ...sale,
          requestId,
          payments: payments.map((p) => ({ ...p })),
          ...(preview.requiresAuthorization ? { authorization: auth } : {})
        })
      )
      onCompleted(result)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault()
        void finalize()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal
      open
      size="lg"
      title="Pagamento"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar ao carrinho
          </Button>
          <Button ref={finalizeRef} size="lg" loading={saving} disabled={!ready} onClick={() => void finalize()}>
            Finalizar venda (F9)
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {METHODS.map(({ method: m, icon: Icon }) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-[13px] ${method === m ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink-2 hover:bg-surface-hover'}`}
              >
                <Icon className="size-5" aria-hidden />
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <MoneyField label={`Valor em ${PAYMENT_METHOD_LABELS[method].toLowerCase()}`} value={amount} onChange={(v) => setAmount(v ?? 0)} />
            {method === 'CREDIT_CARD' && (
              <SelectField label="Parcelas" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: i === 0 ? 'À vista' : `${i + 1}x` }))} />
            )}
            {method === 'STORE_CREDIT' && (
              <SelectField label="Parcelas" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: i === 0 ? '1 parcela' : `${i + 1} parcelas mensais` }))} />
            )}
            {method === 'STORE_CREDIT' && <TextField label="Vencimento da 1ª parcela" type="date" min={toDateKey()} value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />}
            {method === 'OTHER' && <TextField label="Descrição" placeholder="Ex.: transferência" value={label} onChange={(e) => setLabel(e.target.value)} />}
            {method === 'VOUCHER' && (
              <div className="flex items-end gap-2">
                <TextField label="Código do vale" containerClassName="flex-1" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
                <Button variant="secondary" onClick={() => void checkVoucher()} disabled={!voucherCode.trim()}>
                  Saldo
                </Button>
              </div>
            )}
          </div>
          {voucherInfo && method === 'VOUCHER' && <p className="text-xs text-ink-2">{voucherInfo}</p>}
          {method === 'STORE_CREDIT' && (
            <p className="text-xs text-ink-2" role="status">
              {!customer
                ? 'Identifique o cliente no carrinho para vender no crediário.'
                : customer.creditLimitCents === null
                  ? `${customer.name} não tem crediário liberado (defina o limite no cadastro do cliente).`
                  : customer.creditAvailableCents != null
                    ? `Crediário de ${customer.name}: disponível ${formatMoney(customer.creditAvailableCents)} de ${formatMoney(customer.creditLimitCents ?? 0)}. As parcelas vão para Contas a receber.`
                    : `Crediário de ${customer.name}: o limite é conferido ao finalizar. As parcelas vão para Contas a receber.`}
            </p>
          )}
          {(method === 'PIX' || method === 'DEBIT_CARD' || method === 'CREDIT_CARD') && (
            <p className="text-xs text-muted">Registro manual (sem TEF integrado): confirme o recebimento na maquininha/aplicativo do banco antes de finalizar. A conferência é feita em TEF → Conciliação.</p>
          )}
          {isCard && (
            <div className="grid grid-cols-3 gap-3">
              <TextField label="NSU (opcional)" inputMode="numeric" maxLength={12} value={nsu} onChange={(e) => setNsu(e.target.value.replace(/\D/g, ''))} />
              <TextField label="Autorização (opcional)" maxLength={12} value={authCode} onChange={(e) => setAuthCode(e.target.value)} />
              <SelectField label="Bandeira" value={brand} onChange={(e) => setBrand(e.target.value)} options={[{ value: '', label: '—' }, ...CARD_BRANDS.map((b) => ({ value: b, label: b === 'OUTRA' ? 'Outra' : b }))]} />
            </div>
          )}
          <Button variant="secondary" onClick={add} disabled={remaining === 0 && method !== 'CASH'}>
            Adicionar pagamento
          </Button>

          {payments.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-ink">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.installments > 1 && ` · ${p.installments}x`}
                    {p.voucherCode && ` · ${p.voucherCode}`}
                    {p.label && ` · ${p.label}`}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular font-medium text-ink">{formatMoney(p.amountCents)}</span>
                    <Button size="sm" variant="ghost" aria-label={`Remover pagamento ${i + 1}`} icon={<Trash2 className="size-3.5 text-danger" />} onClick={() => setPayments(payments.filter((_, j) => j !== i))} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {preview.requiresAuthorization && (
            <AuthorizationFields
              value={auth}
              onChange={setAuth}
              reason={`Desconto de ${formatPercentBps(preview.discountBps)} acima do seu limite (${formatPercentBps(preview.maxDiscountBps)}).`}
            />
          )}
        </div>

        <dl className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 text-sm">
          <div className="flex justify-between text-ink-2">
            <dt>Total da venda</dt>
            <dd className="tabular font-medium text-ink">{formatMoney(total)}</dd>
          </div>
          <div className="flex justify-between text-ink-2">
            <dt>Pago</dt>
            <dd className="tabular">{formatMoney(paid)}</dd>
          </div>
          <div className="flex justify-between text-ink-2">
            <dt>Falta</dt>
            <dd className={`tabular ${remaining ? 'font-medium text-danger' : ''}`}>{formatMoney(remaining)}</dd>
          </div>
          <div className="mt-2 border-t border-line pt-3">
            <dt className="text-ink-2">Troco</dt>
            <dd className="tabular text-3xl font-semibold text-success" aria-label="Troco">
              {formatMoney(change)}
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  )
}
