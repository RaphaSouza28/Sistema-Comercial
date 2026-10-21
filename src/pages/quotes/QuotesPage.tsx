import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ClipboardList, Eye, FileText, Pencil, Plus, Search, Send, ShoppingCart, Undo2, XCircle } from 'lucide-react'
import type { QuoteDetail, QuoteListItem } from '@shared/api'
import { QUOTE_STATUS, type QuoteStatus } from '@shared/commerceSchemas'
import { formatPhone } from '@shared/documents'
import { formatDateKey, formatDateTime, formatMoney, toDateKey } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'
import { DocumentFormModal } from '../documents/DocumentFormModal'
import { DocumentLinesTable, DocumentTotals, InfoRow, Pager, PrintButtons, linesFromDetail } from '../documents/shared'

const TONES: Record<QuoteStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'primary',
  APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning'
}

function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={TONES[status]}>{QUOTE_STATUS[status]}</Badge>
}

export function QuotesPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<QuoteStatus | ''>('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useAsync(
    () => call(api.quotes.list({ search: debounced || undefined, status: status || undefined, page, pageSize: 50 })),
    [debounced, status, page]
  )
  const [editing, setEditing] = useState<QuoteDetail | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)

  return (
    <div className="animate-in">
      <PageHeader
        title="Orçamentos"
        description="Propostas com validade, impressão em PDF e conversão em pedido ou venda."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo orçamento
          </Button>
        }
      />
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
              placeholder="Buscar por número, cliente ou contato…"
              aria-label="Buscar orçamentos"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <SelectField
            label="Situação"
            containerClassName="w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as QuoteStatus | '')
              setPage(1)
            }}
            options={[{ value: '', label: 'Todos' }, ...Object.entries(QUOTE_STATUS).map(([value, label]) => ({ value, label }))]}
          />
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.items.length === 0 && <EmptyState icon={<FileText />} title="Nenhum orçamento encontrado" />}
        {data && data.items.length > 0 && <QuotesTable items={data.items} onOpen={setViewing} />}
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} label="orçamento(s)" />}
      </Card>

      {editing && (
        <QuoteFormModal
          quote={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(q) => {
            setEditing(null)
            void reload()
            setViewing(q.id)
          }}
        />
      )}
      {viewing !== null && (
        <QuoteDetailModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={(q) => {
            setViewing(null)
            setEditing(q)
          }}
          onChanged={() => void reload()}
        />
      )}
    </div>
  )
}

function QuotesTable({ items, onOpen }: { items: QuoteListItem[]; onOpen(id: number): void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
            <th className="px-5 py-2.5 font-medium">Orçamento</th>
            <th className="px-3 py-2.5 font-medium">Cliente</th>
            <th className="px-3 py-2.5 font-medium">Validade</th>
            <th className="px-3 py-2.5 font-medium">Situação</th>
            <th className="px-3 py-2.5 text-right font-medium">Total</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
              <td className="px-5 py-2.5">
                <span className="font-medium text-ink">#{q.id}</span>
                <span className="block text-xs text-muted">
                  {formatDateTime(q.createdAt)} · {q.userName}
                </span>
              </td>
              <td className="px-3 py-2.5 text-ink-2">{q.customerName ?? '—'}</td>
              <td className="px-3 py-2.5 text-ink-2">{formatDateKey(q.validUntil)}</td>
              <td className="px-3 py-2.5">
                <QuoteStatusBadge status={q.status} />
                {q.orderId && <span className="ml-2 text-xs text-muted">Pedido #{q.orderId}</span>}
                {q.saleId && <span className="ml-2 text-xs text-muted">Venda #{q.saleId}</span>}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium text-ink">{formatMoney(q.totalCents)}</td>
              <td className="px-5 py-2.5">
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" aria-label={`Abrir orçamento ${q.id}`} icon={<Eye className="size-3.5" />} onClick={() => onOpen(q.id)}>
                    Abrir
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QuoteFormModal({ quote, onClose, onSaved }: { quote: QuoteDetail | null; onClose(): void; onSaved(q: QuoteDetail): void }) {
  const toast = useToast()
  const [validUntil, setValidUntil] = useState(quote ? quote.validUntil : toDateKey(new Date(), 7))
  const [contactName, setContactName] = useState(quote?.contactName ?? '')
  const [contactPhone, setContactPhone] = useState(quote?.contactPhone ?? '')
  return (
    <DocumentFormModal
      title={quote ? `Editar orçamento #${quote.id}` : 'Novo orçamento'}
      formId="quote-form"
      allowFreeText
      initial={{ customer: quote?.customer ?? null, lines: quote ? linesFromDetail(quote.items) : [], discountCents: quote?.discountCents ?? 0 }}
      initialNotes={quote?.notes ?? null}
      onClose={onClose}
      extra={(v, errors) => (
        <>
          <TextField label="Válido até" type="date" required min={toDateKey()} containerClassName="col-span-6 md:col-span-2" value={validUntil} error={errors.validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          {!v.customer && (
            <>
              <TextField label="Nome do contato" hint="Sem cliente cadastrado" containerClassName="col-span-3 md:col-span-2" value={contactName} error={errors.contactName} onChange={(e) => setContactName(e.target.value)} />
              <TextField label="Telefone do contato" inputMode="tel" containerClassName="col-span-3 md:col-span-2" value={contactPhone} error={errors.contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </>
          )}
        </>
      )}
      onSubmit={async (base) => {
        const input = { ...base, validUntil, contactName: base.customerId ? null : contactName || null, contactPhone: base.customerId ? null : contactPhone || null }
        const saved = quote ? await call(api.quotes.update({ ...input, id: quote.id })) : await call(api.quotes.create(input))
        toast.success(quote ? 'Orçamento atualizado.' : `Orçamento #${saved.id} criado.`)
        onSaved(saved)
      }}
    />
  )
}

function QuoteDetailModal({ id, onClose, onEdit, onChanged }: { id: number; onClose(): void; onEdit(q: QuoteDetail): void; onChanged(): void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data, error, reload, setData } = useAsync(() => call(api.quotes.get({ id })), [id])
  const [busy, setBusy] = useState(false)
  const [toOrderOpen, setToOrderOpen] = useState(false)

  const setStatus = async (status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED') => {
    setBusy(true)
    try {
      setData(await call(api.quotes.setStatus({ id, status })))
      toast.success(`Orçamento marcado como "${QUOTE_STATUS[status]}".`)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const converted = !!(data?.orderId || data?.saleId)
  const open = data && !converted
  const convertible = open && !data.hasFreeLines && data.status !== 'REJECTED' && data.status !== 'EXPIRED'

  return (
    <Modal open size="lg" title={data ? `Orçamento #${data.id}` : 'Orçamento'} onClose={onClose} locked={busy}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoRow label="Situação">
              <QuoteStatusBadge status={data.status} />
            </InfoRow>
            <InfoRow label="Cliente">
              {data.customer?.name ?? data.contactName ?? '—'}
              {!data.customer && data.contactPhone && <span className="block text-xs text-muted">{formatPhone(data.contactPhone)}</span>}
            </InfoRow>
            <InfoRow label="Válido até">{formatDateKey(data.validUntil)}</InfoRow>
            <InfoRow label="Criado">
              {formatDateTime(data.createdAt)} por {data.userName}
            </InfoRow>
            {data.sentAt && <InfoRow label="Enviado em">{formatDateTime(data.sentAt)}</InfoRow>}
            {data.decidedAt && <InfoRow label="Decidido em">{formatDateTime(data.decidedAt)}</InfoRow>}
            {data.orderId && <InfoRow label="Pedido">#{data.orderId}</InfoRow>}
            {data.saleId && <InfoRow label="Venda">#{data.saleId}</InfoRow>}
            {data.discountAuthorizedByName && <InfoRow label="Desconto autorizado por">{data.discountAuthorizedByName}</InfoRow>}
          </dl>
          {data.status === 'EXPIRED' && open && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Orçamento vencido. Edite e altere a validade para reabri-lo.</p>
          )}
          {data.hasFreeLines && open && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
              Este orçamento tem itens de texto livre. Para convertê-lo em pedido ou venda, substitua-os por produtos cadastrados.
            </p>
          )}
          <DocumentLinesTable items={data.items} />
          <DocumentTotals subtotalCents={data.subtotalCents} discountCents={data.discountCents} totalCents={data.totalCents} items={data.items} />
          {data.notes && <p className="text-sm whitespace-pre-line text-ink-2">{data.notes}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <PrintButtons print={() => api.quotes.print({ id })} savePdf={() => api.quotes.savePdf({ id })} />
            {open && data.status !== 'APPROVED' && data.status !== 'REJECTED' && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(data)}>
                Editar
              </Button>
            )}
            {open && (data.status === 'APPROVED' || data.status === 'REJECTED') && (
              <Button variant="secondary" icon={<Undo2 className="size-4" />} loading={busy} onClick={() => void setStatus('DRAFT')}>
                Voltar para rascunho
              </Button>
            )}
            {open && data.status === 'DRAFT' && (
              <Button variant="secondary" icon={<Send className="size-4" />} loading={busy} onClick={() => void setStatus('SENT')}>
                Marcar como enviado
              </Button>
            )}
            {open && (data.status === 'DRAFT' || data.status === 'SENT') && (
              <>
                <Button variant="secondary" icon={<XCircle className="size-4 text-danger" />} loading={busy} onClick={() => void setStatus('REJECTED')}>
                  Recusado
                </Button>
                <Button variant="secondary" icon={<CheckCircle2 className="size-4 text-success" />} loading={busy} onClick={() => void setStatus('APPROVED')}>
                  Aprovado
                </Button>
              </>
            )}
            {convertible && can('orders.manage') && (
              <Button variant="secondary" icon={<ClipboardList className="size-4" />} onClick={() => setToOrderOpen(true)}>
                Gerar pedido
              </Button>
            )}
            {convertible && can('pdv.sell') && (
              <Button icon={<ShoppingCart className="size-4" />} onClick={() => navigate(`/pdv?orcamento=${data.id}`)}>
                Vender no PDV
              </Button>
            )}
          </div>
        </div>
      )}
      {toOrderOpen && (
        <ToOrderModal
          id={id}
          onClose={() => setToOrderOpen(false)}
          onDone={(orderId) => {
            setToOrderOpen(false)
            toast.success(`Pedido #${orderId} gerado a partir do orçamento.`)
            onChanged()
            void reload()
          }}
        />
      )}
    </Modal>
  )
}

function ToOrderModal({ id, onClose, onDone }: { id: number; onClose(): void; onDone(orderId: number): void }) {
  const toast = useToast()
  const [delivery, setDelivery] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title={`Gerar pedido do orçamento #${id}`}
      description="Itens, preços e descontos são copiados do orçamento, que fica aprovado."
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
                const o = await call(api.quotes.toOrder({ id, expectedDeliveryAt: delivery || null }))
                onDone(o.id)
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            Gerar pedido
          </Button>
        </>
      }
    >
      <TextField label="Entrega prevista (opcional)" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
    </Modal>
  )
}
