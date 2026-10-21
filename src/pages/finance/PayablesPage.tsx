import { useState, type FormEvent } from 'react'
import { Banknote, Eye, FileText, Paperclip, Pencil, Plus, Receipt, Search, Trash2, Undo2, XCircle } from 'lucide-react'
import type { PayableDto } from '@shared/api'
import { FINANCE_METHODS, RECURRENCE, type FinanceMethod, type PayableListInput, type RecurrenceKey } from '@shared/financeSchemas'
import { formatDate, formatDateTime, formatMoney, toDateKey } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { InfoRow, Pager } from '../documents/shared'
import { DueCards, FinanceStatusBadge, ReasonModal, inputDate } from './shared'

type StatusFilter = NonNullable<PayableListInput['status']> | ''

export function PayablesPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('PENDING')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const summary = useAsync(() => call(api.payables.summary()))
  const { data, error, loading, reload } = useAsync(
    () => call(api.payables.list({ search: debounced || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 })),
    [debounced, status, from, to, page]
  )
  const [editing, setEditing] = useState<PayableDto | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [paying, setPaying] = useState<PayableDto | null>(null)
  const [version, setVersion] = useState(0)
  const refresh = () => {
    void reload()
    void summary.reload()
  }
  const filter = (s: StatusFilter) => {
    setStatus(s)
    setPage(1)
  }

  return (
    <div className="animate-in">
      <PageHeader
        title="Contas a pagar"
        description="Despesas, vencimentos e pagamentos. O registro indica que a conta foi paga por fora — o sistema não faz pagamentos bancários."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Nova conta
          </Button>
        }
      />
      <DueCards summary={summary.data} settledLabel="Pago no mês" onPick={filter} />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Buscar por descrição, fornecedor, categoria ou documento…"
              aria-label="Buscar contas a pagar"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <SelectField
            label="Situação"
            containerClassName="w-44"
            value={status}
            onChange={(e) => filter(e.target.value as StatusFilter)}
            options={[
              { value: 'PENDING', label: 'Em aberto' },
              { value: 'OVERDUE', label: 'Atrasadas' },
              { value: 'OPEN', label: 'A vencer' },
              { value: 'PAID', label: 'Pagas' },
              { value: 'CANCELLED', label: 'Canceladas' },
              { value: '', label: 'Todas' }
            ]}
          />
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            {status === 'PAID' ? 'Pagas de' : 'Vencimento de'}
            <input type="date" aria-label="Data inicial" className={inputDate} value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            até
            <input type="date" aria-label="Data final" className={inputDate} value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </label>
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.items.length === 0 && <EmptyState icon={<Receipt />} title="Nenhuma conta encontrada" />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Descrição</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pago</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-2.5 text-ink-2">{formatDate(p.dueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-ink">{p.description}</span>
                      {p.receiptName && <Paperclip className="ml-1.5 inline size-3.5 text-muted" aria-label="Com comprovante" />}
                      <span className="block text-xs text-muted">{[p.supplierName, p.category, p.recurrence !== 'NONE' && RECURRENCE[p.recurrence]].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <FinanceStatusBadge kind="payable" status={p.status} daysOverdue={p.daysOverdue} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right font-medium text-ink">{formatMoney(p.amountCents)}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">
                      {p.paidCents !== null ? formatMoney(p.paidCents) : '—'}
                      {p.paidAt && <span className="block text-xs text-muted">{formatDate(p.paidAt)}</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        {(p.status === 'OPEN' || p.status === 'OVERDUE') && (
                          <Button size="sm" variant="secondary" icon={<Banknote className="size-3.5" />} aria-label={`Pagar ${p.description}`} onClick={() => setPaying(p)}>
                            Pagar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} aria-label={`Abrir ${p.description}`} onClick={() => setViewing(p.id)}>
                          Abrir
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2 text-sm">
                  <td className="px-5 py-2.5 text-muted" colSpan={3}>
                    {data.total} conta(s) no filtro
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold text-ink">{formatMoney(data.amountCents)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatMoney(data.paidCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} label="conta(s)" />}
      </Card>

      {editing && (
        <PayableFormModal
          payable={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null)
            refresh()
            setViewing(p.id)
          }}
        />
      )}
      {paying && (
        <PayModal
          payable={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null)
            setVersion((v) => v + 1)
            refresh()
          }}
        />
      )}
      {viewing !== null && (
        <PayableDetailModal
          key={version}
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={(p) => {
            setViewing(null)
            setEditing(p)
          }}
          onPay={(p) => setPaying(p)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function PayableFormModal({ payable, onClose, onSaved }: { payable: PayableDto | null; onClose(): void; onSaved(p: PayableDto): void }) {
  const toast = useToast()
  const suppliers = useAsync(() => call(api.suppliers.list({})))
  const categories = useAsync(() => call(api.payables.categories()))
  const [form, setForm] = useState({
    description: payable?.description ?? '',
    supplierId: payable?.supplierId ?? null,
    category: payable?.category ?? '',
    documentNumber: payable?.documentNumber ?? '',
    amountCents: payable?.amountCents ?? 0,
    dueDate: payable ? toDateKey(payable.dueDate) : toDateKey(),
    recurrence: (payable?.recurrence ?? 'NONE') as RecurrenceKey,
    notes: payable?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const input = { ...form, category: form.category || null, documentNumber: form.documentNumber || null, notes: form.notes || null }
      const saved = payable ? await call(api.payables.update({ ...input, id: payable.id })) : await call(api.payables.create(input))
      toast.success(payable ? 'Conta atualizada.' : 'Conta registrada.')
      onSaved(saved)
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={payable ? 'Editar conta a pagar' : 'Nova conta a pagar'}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="payable-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="payable-form" onSubmit={submit} className="grid grid-cols-6 gap-4" noValidate>
        <TextField label="Descrição" required containerClassName="col-span-6 md:col-span-4" value={form.description} error={errors.description} onChange={(e) => set('description', e.target.value)} />
        <TextField label="Nº do documento" hint="Boleto, nota, fatura…" containerClassName="col-span-6 md:col-span-2" value={form.documentNumber} error={errors.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} />
        <SelectField
          label="Fornecedor"
          containerClassName="col-span-6 md:col-span-3"
          value={form.supplierId ?? ''}
          error={errors.supplierId}
          onChange={(e) => set('supplierId', e.target.value ? Number(e.target.value) : null)}
          options={[{ value: '', label: 'Sem fornecedor' }, ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
        />
        <TextField label="Categoria" list="payable-categories" placeholder="Ex.: Aluguel, Energia, Impostos" containerClassName="col-span-6 md:col-span-3" value={form.category} error={errors.category} onChange={(e) => set('category', e.target.value)} />
        <datalist id="payable-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <MoneyField label="Valor" required containerClassName="col-span-3 md:col-span-2" value={form.amountCents} error={errors.amountCents} onChange={(v) => set('amountCents', v ?? 0)} />
        <TextField label="Vencimento" type="date" required containerClassName="col-span-3 md:col-span-2" value={form.dueDate} error={errors.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        <SelectField
          label="Repetir"
          hint="Ao pagar, a próxima é criada"
          containerClassName="col-span-6 md:col-span-2"
          value={form.recurrence}
          onChange={(e) => set('recurrence', e.target.value as RecurrenceKey)}
          options={Object.entries(RECURRENCE).map(([value, label]) => ({ value, label }))}
        />
        <TextField label="Observações" containerClassName="col-span-6" value={form.notes} error={errors.notes} onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Modal>
  )
}

function PayModal({ payable, onClose, onPaid }: { payable: PayableDto; onClose(): void; onPaid(p: PayableDto): void }) {
  const toast = useToast()
  // Mesmo identificador em reenvios (duplo clique, falha de rede): o pagamento é registrado uma vez
  const [requestId] = useState(() => crypto.randomUUID())
  const [paidCents, setPaidCents] = useState(payable.amountCents)
  const [method, setMethod] = useState<FinanceMethod>('PIX')
  const [paidAt, setPaidAt] = useState(toDateKey())
  const [fromCash, setFromCash] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diff = paidCents - payable.amountCents

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const p = await call(api.payables.pay({ id: payable.id, requestId, paidCents, method, paidAt, fromCash: method === 'CASH' && fromCash }))
      toast.success(p.recurrenceNextId ? 'Pagamento registrado. A próxima conta recorrente foi criada.' : 'Pagamento registrado.')
      onPaid(p)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="sm"
      title="Registrar pagamento"
      description={`${payable.description} · vence ${formatDate(payable.dueDate)} · ${formatMoney(payable.amountCents)}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={paidCents <= 0 || !paidAt} onClick={() => void submit()}>
            Confirmar pagamento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Valor pago" value={paidCents} onChange={(v) => setPaidCents(v ?? 0)} hint={diff > 0 ? `Juros/multa: ${formatMoney(diff)}` : diff < 0 ? `Desconto: ${formatMoney(-diff)}` : undefined} />
          <TextField label="Data do pagamento" type="date" max={toDateKey()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <SelectField label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value as FinanceMethod)} options={FINANCE_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
        {method === 'CASH' && (
          <Checkbox
            label="Retirar o dinheiro da gaveta do caixa aberto"
            description="Registra uma saída no seu caixa. Deixe desmarcado se o pagamento saiu de outro lugar (cofre, conta bancária)."
            checked={fromCash}
            onChange={setFromCash}
          />
        )}
      </div>
    </Modal>
  )
}

function PayableDetailModal({ id, onClose, onEdit, onPay, onChanged }: { id: number; onClose(): void; onEdit(p: PayableDto): void; onPay(p: PayableDto): void; onChanged(): void }) {
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => call(api.payables.get({ id })), [id])
  const [confirm, setConfirm] = useState<'reverse' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<PayableDto | null>, message: string) => {
    setBusy(true)
    try {
      const p = await fn()
      if (p) {
        setData(p)
        toast.success(message)
        onChanged()
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const open = data && (data.status === 'OPEN' || data.status === 'OVERDUE')
  return (
    <Modal open size="lg" title={data ? data.description : 'Conta a pagar'} onClose={onClose} locked={busy}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoRow label="Situação">
              <FinanceStatusBadge kind="payable" status={data.status} daysOverdue={data.daysOverdue} />
            </InfoRow>
            <InfoRow label="Valor">{formatMoney(data.amountCents)}</InfoRow>
            <InfoRow label="Vencimento">{formatDate(data.dueDate)}</InfoRow>
            <InfoRow label="Repetição">{RECURRENCE[data.recurrence]}</InfoRow>
            <InfoRow label="Fornecedor">{data.supplierName ?? '—'}</InfoRow>
            <InfoRow label="Categoria">{data.category ?? '—'}</InfoRow>
            <InfoRow label="Documento">{data.documentNumber ?? '—'}</InfoRow>
            <InfoRow label="Cadastrada">
              {formatDateTime(data.createdAt)}
              {data.createdByName && ` por ${data.createdByName}`}
            </InfoRow>
          </dl>
          {data.status === 'PAID' && (
            <div className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
              Paga em {formatDate(data.paidAt)} · {formatMoney(data.paidCents ?? 0)} em {PAYMENT_METHOD_LABELS[data.paymentMethod ?? ''] ?? data.paymentMethod}
              {data.paidFromCash && ' (saiu da gaveta do caixa)'}
              {data.paidByName && ` · registrado por ${data.paidByName}`}
            </div>
          )}
          {data.cancelledAt && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
              Cancelada em {formatDateTime(data.cancelledAt)}: {data.cancelReason}
            </p>
          )}
          {data.recurrenceNextId && <p className="text-sm text-ink-2">Próxima ocorrência já gerada (conta nº {data.recurrenceNextId}).</p>}
          {data.notes && <p className="text-sm whitespace-pre-line text-ink-2">{data.notes}</p>}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
            <FileText className="size-4 text-muted" aria-hidden />
            <span className="flex-1 text-sm text-ink-2">{data.receiptName ? `Comprovante: ${data.receiptName}` : 'Nenhum comprovante anexado'}</span>
            {data.receiptName && (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => (await call(api.payables.openReceipt({ id })), null), '')}>
                  Abrir
                </Button>
                <Button size="sm" variant="ghost" aria-label="Remover comprovante" icon={<Trash2 className="size-3.5 text-danger" />} disabled={busy} onClick={() => void run(() => call(api.payables.removeReceipt({ id })), 'Comprovante removido.')} />
              </>
            )}
            <Button size="sm" variant="secondary" icon={<Paperclip className="size-3.5" />} disabled={busy} onClick={() => void run(() => call(api.payables.attachReceipt({ id })), 'Comprovante anexado.')}>
              {data.receiptName ? 'Substituir' : 'Anexar comprovante'}
            </Button>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {open && (
              <>
                <Button variant="secondary" icon={<XCircle className="size-4 text-danger" />} onClick={() => setConfirm('cancel')}>
                  Cancelar conta
                </Button>
                <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(data)}>
                  Editar
                </Button>
                <Button icon={<Banknote className="size-4" />} onClick={() => onPay(data)}>
                  Pagar
                </Button>
              </>
            )}
            {data.status === 'PAID' && (
              <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setConfirm('reverse')}>
                Estornar pagamento
              </Button>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <ReasonModal
          title={confirm === 'reverse' ? 'Estornar pagamento' : 'Cancelar conta'}
          description={confirm === 'reverse' ? (data?.paidFromCash ? 'A conta volta a ficar em aberto e o valor retorna à gaveta do seu caixa aberto.' : 'A conta volta a ficar em aberto.') : 'A conta deixa de aparecer como pendente. Fica registrada no histórico.'}
          label="Motivo"
          confirmLabel={confirm === 'reverse' ? 'Estornar' : 'Cancelar conta'}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const p = confirm === 'reverse' ? await call(api.payables.reverse({ id, reason })) : await call(api.payables.cancel({ id, reason }))
            setData(p)
            setConfirm(null)
            toast.success(confirm === 'reverse' ? 'Pagamento estornado.' : 'Conta cancelada.')
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}
