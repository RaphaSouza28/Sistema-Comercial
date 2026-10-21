import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle, CalendarDays, FileDown, History, Lock, Printer, Wallet } from 'lucide-react'
import type { CashSessionDto } from '@shared/api'
import { MANUAL_MOVEMENTS, type CashMethod, type ManualMovementType } from '@shared/cashSchemas'
import { formatDateTime, formatInteger, formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { StatTile } from '@/components/dashboard/StatTile'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { CashCloseModal } from './CashCloseModal'
import { CashDaily } from './CashDaily'
import { CashHistory, MOVEMENT_TYPE_LABEL } from './CashHistory'
import { CashSummaryTable } from './CashSummaryTable'
import { useCashReport } from './useCashReport'
import { OpenCash } from './OpenCash'

type Tab = 'mine' | 'history' | 'daily'

export function CashPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>(can('cash.operate') ? 'mine' : 'history')
  const tabs = [
    ...(can('cash.operate') ? [{ key: 'mine' as const, label: 'Meu caixa', icon: Wallet }] : []),
    { key: 'history' as const, label: 'Histórico de caixas', icon: History },
    ...(can('cash.manage', 'reports.view') ? [{ key: 'daily' as const, label: 'Relatório do dia', icon: CalendarDays }] : [])
  ]
  return (
    <div className="animate-in">
      <PageHeader title="Caixa" description="Abertura, suprimentos, sangrias, conferência e fechamento." />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'mine' && <MyCash />}
      {tab === 'history' && <CashHistory />}
      {tab === 'daily' && <CashDaily />}
    </div>
  )
}

function MyCash() {
  const session = useAsync(() => call(api.cash.current()))
  const [version, setVersion] = useState(0)
  // O modal de fechamento fica neste nível: após fechar, o resultado (imprimir/PDF) continua visível
  const [closingId, setClosingId] = useState<number | null>(null)
  const refresh = () => {
    void session.reload()
    setVersion((v) => v + 1)
  }
  const closeModal = closingId !== null && (
    <CashCloseModal
      sessionId={closingId}
      onClose={() => {
        setClosingId(null)
        refresh()
      }}
      onClosed={() => undefined}
    />
  )
  if (session.loading && !session.data) return <Spinner />
  if (session.error) return <ErrorState message={session.error} onRetry={() => void session.reload()} />
  if (!session.data) return <OpenCash onOpened={() => void session.reload()} />
  return (
    <>
      <OpenSession key={version} session={session.data} onChanged={refresh} onClose={() => setClosingId(session.data!.id)} />
      {closeModal}
    </>
  )
}

function OpenSession({ session, onChanged, onClose }: { session: CashSessionDto; onChanged(): void; onClose(): void }) {
  const detail = useAsync(() => call(api.cash.get({ sessionId: session.id })), [session.id])
  const report = useCashReport()
  const [movement, setMovement] = useState<ManualMovementType | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Resumo do caixa" role="region">
        <StatTile emphasis label="Dinheiro na gaveta" value={formatMoney(session.cashBalanceCents)} hint="Esperado agora" icon={<Wallet />} />
        <StatTile label="Vendas" value={formatMoney(session.salesTotalCents)} hint={`${formatInteger(session.salesCount)} venda(s)`} icon={<ArrowUpCircle />} />
        <StatTile label="Abertura" value={formatMoney(session.openingCents)} hint={formatDateTime(session.openedAt)} icon={<ArrowDownCircle />} />
        <StatTile label="Caixa" value={`#${session.id}`} hint={session.userName} icon={<Lock />} />
      </section>

      <Card>
        <CardHeader
          title="Movimentações"
          description="Suprimentos e sangrias são sempre em dinheiro. Vendas entram automaticamente pelo PDV."
          actions={
            <>
              <Button variant="secondary" onClick={() => setMovement('SUPPLY')}>
                Suprimento
              </Button>
              <Button variant="secondary" onClick={() => setMovement('WITHDRAWAL')}>
                Sangria
              </Button>
              <Button variant="secondary" onClick={() => setMovement('OTHER_IN')}>
                Outra entrada
              </Button>
              <Button variant="secondary" onClick={() => setMovement('OTHER_OUT')}>
                Outra saída
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-4 px-5 pb-5">
          {detail.data && <CashSummaryTable summary={detail.data.summary} />}
          {detail.data && detail.data.movements.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Hora</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Forma</th>
                    <th className="px-3 py-2 font-medium">Descrição</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.data.movements].reverse().map((m) => (
                    <tr key={m.id} className="border-t border-line">
                      <td className="tabular px-3 py-1.5 text-ink-2">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-1.5"><Badge tone={m.amountCents >= 0 ? 'success' : 'neutral'}>{MOVEMENT_TYPE_LABEL[m.type] ?? m.type}</Badge></td>
                      <td className="px-3 py-1.5 text-ink-2">{PAYMENT_METHOD_LABELS[m.method]}</td>
                      <td className="px-3 py-1.5 text-ink-2">{m.description}</td>
                      <td className={`tabular px-3 py-1.5 text-right font-medium ${m.amountCents >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(m.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" icon={<Printer className="size-4" />} loading={report.busy} onClick={() => void report.print(session.id)}>
              Relatório parcial
            </Button>
            <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={report.busy} onClick={() => void report.pdf(session.id)}>
              PDF
            </Button>
            <Button icon={<Lock className="size-4" />} onClick={onClose}>
              Fechar caixa
            </Button>
          </div>
        </div>
      </Card>

      <MovementModal type={movement} onClose={() => setMovement(null)} onDone={onChanged} />
    </div>
  )
}

function MovementModal({ type, onClose, onDone }: { type: ManualMovementType | null; onClose(): void; onDone(): void }) {
  const toast = useToast()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<CashMethod>('CASH')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (type) {
      setRequestId(crypto.randomUUID())
      setAmount(0)
      setMethod('CASH')
      setDescription(type === 'SUPPLY' ? 'Reforço de troco' : type === 'WITHDRAWAL' ? 'Recolhimento ao cofre' : '')
      setErrors({})
      setError(null)
    }
  }, [type])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!type) return
    setSaving(true)
    setError(null)
    try {
      await call(api.cash.addMovement({ requestId, type, amountCents: amount, method, description }))
      toast.success(`${MANUAL_MOVEMENTS[type]} de ${formatMoney(amount)} registrado.`)
      onDone()
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const other = type === 'OTHER_IN' || type === 'OTHER_OUT'
  return (
    <Modal
      open={!!type}
      size="sm"
      title={type ? MANUAL_MOVEMENTS[type] : ''}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="cash-movement" loading={saving} disabled={amount <= 0}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="cash-movement" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorState message={error} />}
        <MoneyField label="Valor" value={amount} onChange={(v) => setAmount(v ?? 0)} error={errors.amountCents} />
        {other && (
          <SelectField
            label="Forma"
            value={method}
            onChange={(e) => setMethod(e.target.value as CashMethod)}
            options={(['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] as const).map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
          />
        )}
        <TextField label="Descrição" required value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      </form>
    </Modal>
  )
}
