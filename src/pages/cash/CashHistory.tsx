import { useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, Lock, Printer } from 'lucide-react'
import { formatDateTime, formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call } from '@/services/api'
import { CashCloseModal } from './CashCloseModal'
import { useCashReport } from './useCashReport'
import { CashSummaryTable } from './CashSummaryTable'

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  SALE: 'Venda',
  SALE_CANCEL: 'Cancelamento',
  RETURN_REFUND: 'Reembolso',
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
  OTHER_IN: 'Outra entrada',
  OTHER_OUT: 'Outra saída',
  RECEIVABLE: 'Recebimento',
  PAYABLE: 'Pagamento'
}

const PAGE_SIZE = 50
const inputClass = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

export function DifferenceBadge({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="text-muted">—</span>
  if (cents === 0) return <Badge tone="success">Sem diferença</Badge>
  return <Badge tone={cents > 0 ? 'warning' : 'danger'}>{`${cents > 0 ? 'Sobra' : 'Falta'} ${formatMoney(Math.abs(cents))}`}</Badge>
}

export function CashHistory() {
  const [status, setStatus] = useState<'' | 'OPEN' | 'CLOSED'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const query = { status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }
  const { data, error, loading, reload } = useAsync(() => call(api.cash.history(query)), [JSON.stringify(query)])
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <select aria-label="Situação do caixa" className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1) }}>
          <option value="">Todos</option>
          <option value="OPEN">Abertos</option>
          <option value="CLOSED">Fechados</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          De <input type="date" aria-label="Data inicial" className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          até <input type="date" aria-label="Data final" className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
        </label>
      </div>
      {error && (
        <div className="p-4">
          <ErrorState message={error} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title="Nenhum caixa encontrado" />}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                <th className="px-5 py-2.5 font-medium">Caixa</th>
                <th className="px-3 py-2.5 font-medium">Operador</th>
                <th className="px-3 py-2.5 font-medium">Abertura</th>
                <th className="px-3 py-2.5 font-medium">Fechamento</th>
                <th className="px-3 py-2.5 text-right font-medium">Vendas</th>
                <th className="px-3 py-2.5 text-right font-medium">Esperado</th>
                <th className="px-3 py-2.5 text-right font-medium">Contado</th>
                <th className="px-5 py-2.5 font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-hover/60" onClick={() => setOpenId(s.id)}>
                  <td className="px-5 py-2.5">
                    <button type="button" className="font-medium text-ink hover:text-primary" onClick={() => setOpenId(s.id)}>
                      #{s.id}
                    </button>{' '}
                    {s.status === 'OPEN' && <Badge tone="primary">Aberto</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{s.userName}</td>
                  <td className="tabular px-3 py-2.5 text-ink-2">{formatDateTime(s.openedAt)}</td>
                  <td className="tabular px-3 py-2.5 text-ink-2">
                    {s.closedAt ? formatDateTime(s.closedAt) : '—'}
                    {s.closedByName && s.closedByName !== s.userName && <span className="block text-xs text-muted">por {s.closedByName}</span>}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{formatMoney(s.salesTotalCents)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{s.expectedCents === null ? '—' : formatMoney(s.expectedCents)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-2">{s.countedCents === null ? '—' : formatMoney(s.countedCents)}</td>
                  <td className="px-5 py-2.5">
                    <DifferenceBadge cents={s.differenceCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} de {data.total}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Próxima <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      {openId !== null && <CashDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </Card>
  )
}

function CashDetailModal({ id, onClose, onChanged }: { id: number; onClose(): void; onChanged(): void }) {
  const { user, can } = useAuth()
  const report = useCashReport()
  const { data, error, loading, reload } = useAsync(() => call(api.cash.get({ sessionId: id })), [id])
  const [closing, setClosing] = useState(false)
  const canClose = data?.status === 'OPEN' && (data.userId === user?.id || can('cash.manage'))

  if (closing) {
    return (
      <CashCloseModal
        sessionId={id}
        onClose={() => {
          setClosing(false)
          void reload()
        }}
        onClosed={onChanged}
      />
    )
  }

  return (
    <Modal
      open
      size="lg"
      title={`Caixa #${id}`}
      description={data ? `${data.userName} · aberto em ${formatDateTime(data.openedAt)}${data.closedAt ? ` · fechado em ${formatDateTime(data.closedAt)}` : ''}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" icon={<Printer className="size-4" />} loading={report.busy} onClick={() => void report.print(id)}>
            Imprimir
          </Button>
          <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={report.busy} onClick={() => void report.pdf(id)}>
            PDF
          </Button>
          {canClose && (
            <Button icon={<Lock className="size-4" />} onClick={() => setClosing(true)}>
              Fechar caixa
            </Button>
          )}
        </>
      }
    >
      {error && <ErrorState message={error} />}
      {!data && loading && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <CashSummaryTable summary={data.summary} />
          {data.notes && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">Observações: {data.notes}</p>}
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Forma</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Usuário</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="tabular px-3 py-1.5 text-ink-2">{formatDateTime(m.createdAt)}</td>
                    <td className="px-3 py-1.5 text-ink">{MOVEMENT_TYPE_LABEL[m.type] ?? m.type}</td>
                    <td className="px-3 py-1.5 text-ink-2">{PAYMENT_METHOD_LABELS[m.method]}</td>
                    <td className="px-3 py-1.5 text-ink-2">{m.description}</td>
                    <td className="px-3 py-1.5 text-ink-2">{m.userName}</td>
                    <td className={`tabular px-3 py-1.5 text-right ${m.amountCents >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(m.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
