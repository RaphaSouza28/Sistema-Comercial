import { useState, type FormEvent } from 'react'
import { HandCoins, Eye, Plus, Printer, Search, Undo2, UserRound, Wallet, X, XCircle } from 'lucide-react'
import type { CustomerLite, ReceivableDetail, ReceivableDto } from '@shared/api'
import { FINANCE_METHODS, type FinanceMethod, type ReceivableListInput } from '@shared/financeSchemas'
import { formatDate, formatDateTime, formatMoney, toDateKey } from '@shared/format'
import { splitInstallments } from '@shared/installments'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { CustomerPickerModal } from '@/components/CustomerPickerModal'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { InfoRow, Pager } from '../documents/shared'
import { DueCards, FinanceStatusBadge, ReasonModal, inputDate } from './shared'

type StatusFilter = NonNullable<ReceivableListInput['status']> | ''

export function ReceivablesPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('PENDING')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const summary = useAsync(() => call(api.receivables.summary()))
  const { data, error, loading, reload } = useAsync(
    () => call(api.receivables.list({ search: debounced || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 })),
    [debounced, status, from, to, page]
  )
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [receiving, setReceiving] = useState<ReceivableDto | null>(null)
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
        title="Contas a receber"
        description="Parcelas do crediário e outros valores a receber, com baixas parciais e histórico."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Novo lançamento
          </Button>
        }
      />
      <DueCards summary={summary.data} settledLabel="Recebido no mês" onPick={filter} />
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
              placeholder="Buscar por cliente, descrição ou nº da venda…"
              aria-label="Buscar contas a receber"
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
              { value: 'PARTIAL', label: 'Parciais a vencer' },
              { value: 'PAID', label: 'Recebidas' },
              { value: 'CANCELLED', label: 'Canceladas' },
              { value: '', label: 'Todas' }
            ]}
          />
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            Vencimento de
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
        {data && data.items.length === 0 && <EmptyState icon={<HandCoins />} title="Nenhum valor encontrado" />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Cliente / descrição</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Em aberto</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-2.5 text-ink-2">{formatDate(r.dueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-ink">{r.customerName ?? 'Sem cliente'}</span>
                      <span className="block text-xs text-muted">{r.description}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <FinanceStatusBadge kind="receivable" status={r.status} daysOverdue={r.daysOverdue} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatMoney(r.amountCents)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-medium text-ink">{formatMoney(r.remainingCents)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        {r.remainingCents > 0 && (
                          <Button size="sm" variant="secondary" icon={<Wallet className="size-3.5" />} aria-label={`Receber ${r.description}`} onClick={() => setReceiving(r)}>
                            Receber
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} aria-label={`Abrir ${r.description}`} onClick={() => setViewing(r.id)}>
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
                    {data.total} lançamento(s) no filtro
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatMoney(data.amountCents)}</td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold text-ink">{formatMoney(data.remainingCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} label="lançamento(s)" />}
      </Card>

      {creating && (
        <ReceivableFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
      {receiving && (
        <ReceiveModal
          receivable={receiving}
          onClose={() => setReceiving(null)}
          onDone={(d) => {
            setReceiving(null)
            setVersion((v) => v + 1)
            refresh()
            setViewing(d.id)
          }}
        />
      )}
      {viewing !== null && <ReceivableDetailModal key={version} id={viewing} onClose={() => setViewing(null)} onReceive={setReceiving} onChanged={refresh} />}
    </div>
  )
}

function ReceivableFormModal({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const toast = useToast()
  const [customer, setCustomer] = useState<CustomerLite | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [amountCents, setAmountCents] = useState(0)
  const [firstDueDate, setFirstDueDate] = useState(toDateKey(new Date(), 30))
  const [installments, setInstallments] = useState(1)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const created = await call(api.receivables.create({ description, customerId: customer?.id ?? null, amountCents, firstDueDate, installments, notes: notes || null }))
      toast.success(created.length > 1 ? `${created.length} parcelas lançadas.` : 'Valor a receber lançado.')
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const parts = amountCents > 0 ? splitInstallments(amountCents, installments) : []
  return (
    <Modal
      open
      size="md"
      title="Novo valor a receber"
      description="Para vendas no crediário as parcelas são geradas automaticamente pelo PDV."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="receivable-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="receivable-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">Cliente</p>
          {customer ? (
            <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <UserRound className="size-4 text-muted" aria-hidden />
              <span className="flex-1 text-ink">{customer.name}</span>
              <Button size="sm" variant="ghost" aria-label="Remover cliente" icon={<X className="size-4" />} onClick={() => setCustomer(null)} />
            </div>
          ) : (
            <Button variant="secondary" icon={<UserRound className="size-4" />} onClick={() => setPickerOpen(true)}>
              Selecionar cliente (opcional)
            </Button>
          )}
        </div>
        <TextField label="Descrição" required containerClassName="col-span-2" value={description} error={errors.description} onChange={(e) => setDescription(e.target.value)} />
        <MoneyField label="Valor total" required value={amountCents} error={errors.amountCents} onChange={(v) => setAmountCents(v ?? 0)} />
        <SelectField label="Parcelas" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: i === 0 ? 'Parcela única' : `${i + 1} parcelas mensais` }))} />
        <TextField label={installments > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'} type="date" required value={firstDueDate} error={errors.firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
        <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {parts.length > 1 && <p className="col-span-2 text-xs text-muted">Parcelas: {parts.map((p) => formatMoney(p)).join(' + ')}</p>}
      </form>
      <CustomerPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(c) => (setCustomer(c), setPickerOpen(false))} />
    </Modal>
  )
}

function ReceiveModal({ receivable, onClose, onDone }: { receivable: ReceivableDto; onClose(): void; onDone(d: ReceivableDetail): void }) {
  const toast = useToast()
  const [requestId] = useState(() => crypto.randomUUID())
  const [amountCents, setAmountCents] = useState(receivable.remainingCents)
  const [interestCents, setInterestCents] = useState(0)
  const [discountCents, setDiscountCents] = useState(0)
  const [method, setMethod] = useState<FinanceMethod>('CASH')
  const [paidAt, setPaidAt] = useState(toDateKey())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settled = amountCents + discountCents
  const left = receivable.remainingCents - settled

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const d = await call(api.receivables.receive({ id: receivable.id, requestId, amountCents, interestCents, discountCents, method, paidAt }))
      toast.success(d.status === 'PAID' ? 'Recebimento registrado. Conta quitada.' : `Recebimento parcial registrado. Restam ${formatMoney(d.remainingCents)}.`)
      onDone(d)
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
      title="Registrar recebimento"
      description={`${receivable.customerName ?? 'Sem cliente'} · ${receivable.description} · em aberto ${formatMoney(receivable.remainingCents)}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={amountCents <= 0 || left < 0 || !paidAt} onClick={() => void submit()}>
            Confirmar recebimento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Valor recebido" hint="Abatido da parcela" value={amountCents} onChange={(v) => setAmountCents(v ?? 0)} />
          <SelectField label="Forma" value={method} onChange={(e) => setMethod(e.target.value as FinanceMethod)} options={FINANCE_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          <MoneyField label="Juros/multa" hint="Recebido além da parcela" value={interestCents} onChange={(v) => setInterestCents(v ?? 0)} />
          <MoneyField label="Desconto concedido" hint="Abate sem receber" value={discountCents} onChange={(v) => setDiscountCents(v ?? 0)} />
          <TextField label="Data do recebimento" type="date" max={toDateKey()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <dl className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex justify-between text-ink-2">
            <dt>Entra no caixa</dt>
            <dd className="tabular font-semibold text-ink">{formatMoney(amountCents + interestCents)}</dd>
          </div>
          <div className="flex justify-between text-ink-2">
            <dt>Saldo após o recebimento</dt>
            <dd className={`tabular ${left < 0 ? 'text-danger' : ''}`}>{left < 0 ? 'Valor maior que o saldo' : formatMoney(left)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          {method === 'CASH' ? 'Dinheiro entra na gaveta do seu caixa (é preciso ter o caixa aberto).' : 'PIX/cartão: registro manual; entra no seu caixa aberto, se houver. Confirme o recebimento no banco/maquininha.'}
        </p>
      </div>
    </Modal>
  )
}

function ReceivableDetailModal({ id, onClose, onReceive, onChanged }: { id: number; onClose(): void; onReceive(r: ReceivableDto): void; onChanged(): void }) {
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => call(api.receivables.get({ id })), [id])
  const [confirm, setConfirm] = useState<{ kind: 'reverse'; paymentId: number } | { kind: 'cancel' } | null>(null)
  const [editingDue, setEditingDue] = useState(false)

  return (
    <Modal open size="lg" title={data ? data.description : 'Conta a receber'} onClose={onClose}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoRow label="Situação">
              <FinanceStatusBadge kind="receivable" status={data.status} daysOverdue={data.daysOverdue} />
            </InfoRow>
            <InfoRow label="Cliente">{data.customerName ?? '—'}</InfoRow>
            <InfoRow label="Vencimento">{formatDate(data.dueDate)}</InfoRow>
            <InfoRow label="Origem">{data.saleId ? `Venda #${data.saleId} · parcela ${data.installmentNumber}/${data.installmentCount}` : 'Lançamento avulso'}</InfoRow>
            <InfoRow label="Valor">{formatMoney(data.amountCents)}</InfoRow>
            <InfoRow label="Recebido">{formatMoney(data.receivedCents)}</InfoRow>
            <InfoRow label="Em aberto">{formatMoney(data.remainingCents)}</InfoRow>
            <InfoRow label="Lançado">
              {formatDateTime(data.createdAt)}
              {data.createdByName && ` por ${data.createdByName}`}
            </InfoRow>
          </dl>
          {data.cancelledAt && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
              Cancelada em {formatDateTime(data.cancelledAt)}: {data.cancelReason}
            </p>
          )}
          {data.notes && <p className="text-sm whitespace-pre-line text-ink-2">{data.notes}</p>}

          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Recebimentos</p>
            {data.payments.length === 0 ? (
              <p className="py-3 text-sm text-muted">Nenhum recebimento registrado.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left text-[12px] text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Forma</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                      <th className="px-3 py-2 text-right font-medium">Juros</th>
                      <th className="px-3 py-2 text-right font-medium">Desconto</th>
                      <th className="px-3 py-2 font-medium">Por</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id} className={`border-t border-line ${p.reversedAt ? 'text-muted line-through' : ''}`}>
                        <td className="px-3 py-2">{formatDateTime(p.paidAt)}</td>
                        <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</td>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(p.amountCents)}</td>
                        <td className="tabular px-3 py-2 text-right">{p.interestCents ? formatMoney(p.interestCents) : '—'}</td>
                        <td className="tabular px-3 py-2 text-right">{p.discountCents ? formatMoney(p.discountCents) : '—'}</td>
                        <td className="px-3 py-2">{p.userName}</td>
                        <td className="px-2 py-1.5">
                          {p.reversedAt ? (
                            <span className="text-xs no-underline" title={p.reverseReason ?? ''}>
                              Estornado
                            </span>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" aria-label={`Imprimir recibo ${p.id}`} icon={<Printer className="size-3.5" />} onClick={() => void call(api.receivables.printReceipt({ paymentId: p.id })).catch((e) => toast.error(errorMessage(e)))} />
                              {data.status !== 'CANCELLED' && (
                                <Button size="sm" variant="ghost" aria-label={`Estornar recebimento ${p.id}`} icon={<Undo2 className="size-3.5" />} onClick={() => setConfirm({ kind: 'reverse', paymentId: p.id })} />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {!data.saleId && data.receivedCents === 0 && data.status !== 'CANCELLED' && (
              <Button variant="secondary" icon={<XCircle className="size-4 text-danger" />} onClick={() => setConfirm({ kind: 'cancel' })}>
                Cancelar lançamento
              </Button>
            )}
            {data.remainingCents > 0 && (
              <>
                <Button variant="secondary" onClick={() => setEditingDue(true)}>
                  Alterar vencimento
                </Button>
                <Button icon={<Wallet className="size-4" />} onClick={() => onReceive(data)}>
                  Receber
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <ReasonModal
          title={confirm.kind === 'reverse' ? 'Estornar recebimento' : 'Cancelar lançamento'}
          description={confirm.kind === 'reverse' ? 'O valor volta a ficar em aberto. Se entrou em um caixa, a saída é registrada no seu caixa aberto.' : undefined}
          label="Motivo"
          confirmLabel={confirm.kind === 'reverse' ? 'Estornar' : 'Cancelar lançamento'}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const d = confirm.kind === 'reverse' ? await call(api.receivables.reverse({ paymentId: confirm.paymentId, reason })) : await call(api.receivables.cancel({ id, reason }))
            setData(d)
            setConfirm(null)
            toast.success(confirm.kind === 'reverse' ? 'Recebimento estornado.' : 'Lançamento cancelado.')
            onChanged()
          }}
        />
      )}
      {editingDue && data && (
        <DueDateModal
          receivable={data}
          onClose={() => setEditingDue(false)}
          onSaved={(d) => {
            setData(d)
            setEditingDue(false)
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}

function DueDateModal({ receivable, onClose, onSaved }: { receivable: ReceivableDetail; onClose(): void; onSaved(d: ReceivableDetail): void }) {
  const toast = useToast()
  const [dueDate, setDueDate] = useState(toDateKey(receivable.dueDate))
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title="Alterar vencimento"
      description="Renegociação registrada na auditoria."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true)
              try {
                const d = await call(api.receivables.update({ id: receivable.id, description: receivable.description, dueDate, notes: receivable.notes }))
                toast.success('Vencimento alterado.')
                onSaved(d)
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <TextField label="Novo vencimento" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
    </Modal>
  )
}
