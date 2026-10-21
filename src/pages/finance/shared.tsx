import { useState } from 'react'
import { AlarmClock, CalendarClock, CalendarDays, CircleCheck } from 'lucide-react'
import type { DueSummary } from '@shared/api'
import { PAYABLE_STATUS, RECEIVABLE_STATUS } from '@shared/financeSchemas'
import { formatMoney } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Badge } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { errorMessage } from '@/services/api'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
const TONES: Record<string, Tone> = { OPEN: 'primary', PARTIAL: 'warning', OVERDUE: 'danger', PAID: 'success', CANCELLED: 'neutral' }

export function FinanceStatusBadge({ kind, status, daysOverdue }: { kind: 'payable' | 'receivable'; status: string; daysOverdue: number }) {
  const labels: Record<string, string> = kind === 'payable' ? PAYABLE_STATUS : RECEIVABLE_STATUS
  return (
    <Badge tone={TONES[status] ?? 'neutral'}>
      {labels[status] ?? status}
      {status === 'OVERDUE' && daysOverdue > 0 && ` · ${daysOverdue} dia${daysOverdue > 1 ? 's' : ''}`}
    </Badge>
  )
}

/** Cartões de alerta de vencimento (atrasadas, hoje, 7 dias, liquidado no mês). */
export function DueCards({ summary, settledLabel, onPick }: { summary: DueSummary | null; settledLabel: string; onPick?(status: 'OVERDUE' | 'PENDING'): void }) {
  const items = [
    { key: 'overdue', label: 'Atrasadas', icon: AlarmClock, count: summary?.overdueCount, cents: summary?.overdueCents, tone: 'text-danger', pick: 'OVERDUE' as const },
    { key: 'today', label: 'Vencem hoje', icon: CalendarClock, count: summary?.dueTodayCount, cents: summary?.dueTodayCents, tone: 'text-warning', pick: 'PENDING' as const },
    { key: 'next7', label: 'Próximos 7 dias', icon: CalendarDays, count: summary?.next7Count, cents: summary?.next7Cents, tone: 'text-primary', pick: 'PENDING' as const },
    { key: 'settled', label: settledLabel, icon: CircleCheck, count: null, cents: summary?.settledMonthCents, tone: 'text-success', pick: null }
  ]
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ key, label, icon: Icon, count, cents, tone, pick }) => {
        const body = (
          <>
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Icon className={`size-4 ${tone}`} aria-hidden /> {label}
            </span>
            <span className="tabular mt-1 block text-xl font-semibold text-ink">{summary ? formatMoney(cents ?? 0) : '—'}</span>
            {count !== null && <span className="text-xs text-muted">{summary ? `${count} conta(s)` : ''}</span>}
          </>
        )
        return (
          <Card key={key} className="p-4">
            {pick && onPick ? (
              <button type="button" className="w-full text-left" onClick={() => onPick(pick)} aria-label={`${label}: ${formatMoney(cents ?? 0)}`}>
                {body}
              </button>
            ) : (
              body
            )}
          </Card>
        )
      })}
    </div>
  )
}

/** Confirmação com motivo obrigatório (estorno, cancelamento). */
export function ReasonModal({
  title,
  description,
  label,
  confirmLabel,
  onClose,
  onConfirm
}: {
  title: string
  description?: string
  label: string
  confirmLabel: string
  onClose(): void
  onConfirm(reason: string): Promise<void>
}) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title={title}
      description={description}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={saving}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setSaving(true)
              try {
                await onConfirm(reason.trim())
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <TextField label={label} required value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  )
}

export const inputDate = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'
