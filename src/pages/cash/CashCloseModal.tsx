import { useState } from 'react'
import { Calculator } from 'lucide-react'
import type { CashSessionDetail } from '@shared/api'
import type { CashMethod } from '@shared/cashSchemas'
import { formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'
import { CashSummaryTable } from './CashSummaryTable'
import { useCashReport } from './useCashReport'

/** Cédulas e moedas em circulação (centavos). */
const DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5]

export function CashCloseModal({ sessionId, onClose, onClosed }: { sessionId: number; onClose(): void; onClosed(): void }) {
  const toast = useToast()
  const report = useCashReport()
  const summary = useAsync(() => call(api.cash.summary({ sessionId })), [sessionId])
  const [useCounter, setUseCounter] = useState(false)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [typed, setTyped] = useState<number | null>(null)
  const [others, setOthers] = useState<Partial<Record<CashMethod, number | null>>>({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [closed, setClosed] = useState<CashSessionDetail | null>(null)

  const counterTotal = DENOMINATIONS.reduce((acc, d) => acc + d * (Number(counts[d]) || 0), 0)
  const counted = useCounter ? counterTotal : typed
  const expected = summary.data?.expectedCashCents ?? 0
  const diff = counted === null ? null : counted - expected
  const otherMethods = summary.data?.byMethod.filter((m) => m.method !== 'CASH' && m.expectedCents !== 0) ?? []
  const otherDiff = otherMethods.some((m) => others[m.method] != null && others[m.method] !== m.expectedCents)
  const needsNotes = (diff !== null && diff !== 0) || otherDiff

  const close = async () => {
    if (counted === null) return setError('Informe o dinheiro contado na gaveta.')
    setSaving(true)
    setError(null)
    try {
      const countedByMethod = Object.fromEntries(Object.entries(others).filter(([, v]) => v !== null && v !== undefined))
      const r = await call(api.cash.close({ sessionId, countedCashCents: counted, countedByMethod, notes }))
      setClosed(r)
      toast.success(`Caixa #${sessionId} fechado.`)
      onClosed()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (closed) {
    return (
      <Modal
        open
        size="lg"
        title={`Caixa #${sessionId} fechado`}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" loading={report.busy} onClick={() => void report.pdf(sessionId)}>
              Salvar PDF
            </Button>
            <Button onClick={() => void report.print(sessionId).then(onClose)}>Imprimir relatório</Button>
          </>
        }
      >
        <CashSummaryTable summary={closed.summary} />
        {closed.differenceCents !== 0 && (
          <p className="mt-3 text-sm text-ink-2">
            Diferença em dinheiro: <strong className={closed.differenceCents! > 0 ? 'text-success' : 'text-danger'}>{formatMoney(closed.differenceCents ?? 0)}</strong> — {closed.notes}
          </p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open
      size="lg"
      title={`Fechar caixa #${sessionId}`}
      description="Conte o dinheiro da gaveta. O sistema compara com o valor esperado."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={counted === null || (needsNotes && notes.trim().length < 3)} onClick={() => void close()}>
            Confirmar fechamento
          </Button>
        </>
      }
    >
      {!summary.data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          <CashSummaryTable summary={summary.data} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_240px]">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-medium text-ink-2">Dinheiro contado</p>
                <Button size="sm" variant="ghost" icon={<Calculator className="size-4" />} onClick={() => setUseCounter((u) => !u)}>
                  {useCounter ? 'Informar total' : 'Contar cédulas e moedas'}
                </Button>
              </div>
              {useCounter ? (
                <div className="grid grid-cols-4 gap-2">
                  {DENOMINATIONS.map((d) => (
                    <label key={d} className="flex flex-col gap-1 text-xs text-muted">
                      {formatMoney(d)}
                      <input
                        inputMode="numeric"
                        aria-label={`Quantidade de ${formatMoney(d)}`}
                        value={counts[d] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') })}
                        className="tabular h-8 rounded-md border border-line-strong bg-surface px-2 text-right text-sm text-ink"
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <MoneyField label="Total em dinheiro na gaveta" nullable value={typed} onChange={setTyped} />
              )}
              {otherMethods.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-medium text-ink-2">Conferência das demais formas (opcional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    {otherMethods.map((m) => (
                      <MoneyField
                        key={m.method}
                        label={`${PAYMENT_METHOD_LABELS[m.method]} (esperado ${formatMoney(m.expectedCents)})`}
                        nullable
                        value={others[m.method] ?? null}
                        onChange={(v) => setOthers({ ...others, [m.method]: v })}
                        hint="Conforme relatório da maquininha/banco"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <dl className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 text-sm">
              <div className="flex justify-between text-ink-2">
                <dt>Esperado</dt>
                <dd className="tabular font-medium text-ink">{formatMoney(expected)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>Contado</dt>
                <dd className="tabular">{counted === null ? '—' : formatMoney(counted)}</dd>
              </div>
              <div className="mt-2 border-t border-line pt-3">
                <dt className="text-ink-2">Diferença</dt>
                <dd
                  aria-label="Diferença de caixa"
                  className={`tabular text-2xl font-semibold ${diff === null || diff === 0 ? 'text-ink' : diff > 0 ? 'text-success' : 'text-danger'}`}
                >
                  {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatMoney(diff)}`}
                </dd>
                {diff !== null && diff !== 0 && <p className="text-xs text-muted">{diff > 0 ? 'Sobra' : 'Falta'} no caixa</p>}
              </div>
            </dl>
          </div>
          <TextField
            label={needsNotes ? 'Justificativa da diferença' : 'Observações'}
            required={needsNotes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            hint={needsNotes ? 'Obrigatória quando há diferença.' : undefined}
          />
        </div>
      )}
    </Modal>
  )
}
