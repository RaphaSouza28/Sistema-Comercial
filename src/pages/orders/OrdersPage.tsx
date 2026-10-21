import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Eye, Pencil, Plus, Search, ShoppingCart, XCircle } from 'lucide-react'
import type { OrderDetail, OrderListItem } from '@shared/api'
import { ORDER_STATUS, type OrderListInput, type OrderStatus } from '@shared/commerceSchemas'
import { formatDate, formatDateTime, formatMoney, toDateKey } from '@shared/format'
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

const TONES: Record<OrderStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  CONFIRMED: 'primary',
  PICKING: 'primary',
  READY: 'primary',
  DELIVERED: 'success',
  CANCELLED: 'danger'
}
const FLOW: Exclude<OrderStatus, 'CANCELLED'>[] = ['PENDING', 'CONFIRMED', 'PICKING', 'READY', 'DELIVERED']

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONES[status]}>{ORDER_STATUS[status]}</Badge>
}

type StatusFilter = NonNullable<OrderListInput['status']> | ''

export function OrdersPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('OPEN')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useAsync(
    () => call(api.orders.list({ search: debounced || undefined, status: status || undefined, page, pageSize: 50 })),
    [debounced, status, page]
  )
  const [editing, setEditing] = useState<OrderDetail | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)

  return (
    <div className="animate-in">
      <PageHeader
        title="Pedidos"
        description="Encomendas e entregas: acompanhe a situação e venda no PDV quando o cliente pagar."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo pedido
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
              placeholder="Buscar por número ou cliente…"
              aria-label="Buscar pedidos"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <SelectField
            label="Situação"
            containerClassName="w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter)
              setPage(1)
            }}
            options={[{ value: 'OPEN', label: 'Em aberto' }, ...Object.entries(ORDER_STATUS).map(([value, label]) => ({ value, label })), { value: '', label: 'Todos' }]}
          />
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.items.length === 0 && <EmptyState icon={<ClipboardList />} title="Nenhum pedido encontrado" />}
        {data && data.items.length > 0 && <OrdersTable items={data.items} onOpen={setViewing} />}
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} label="pedido(s)" />}
      </Card>

      {editing && (
        <OrderFormModal
          order={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(o) => {
            setEditing(null)
            void reload()
            setViewing(o.id)
          }}
        />
      )}
      {viewing !== null && (
        <OrderDetailModal
          id={viewing}
          onClose={() => setViewing(null)}
          onEdit={(o) => {
            setViewing(null)
            setEditing(o)
          }}
          onChanged={() => void reload()}
        />
      )}
    </div>
  )
}

function OrdersTable({ items, onOpen }: { items: OrderListItem[]; onOpen(id: number): void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
            <th className="px-5 py-2.5 font-medium">Pedido</th>
            <th className="px-3 py-2.5 font-medium">Cliente</th>
            <th className="px-3 py-2.5 font-medium">Entrega prevista</th>
            <th className="px-3 py-2.5 font-medium">Situação</th>
            <th className="px-3 py-2.5 text-right font-medium">Total</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
              <td className="px-5 py-2.5">
                <span className="font-medium text-ink">#{o.id}</span>
                <span className="block text-xs text-muted">
                  {formatDateTime(o.createdAt)} · {o.userName}
                </span>
              </td>
              <td className="px-3 py-2.5 text-ink-2">{o.customerName ?? 'Consumidor'}</td>
              <td className="px-3 py-2.5 text-ink-2">{o.expectedDeliveryAt ? formatDate(o.expectedDeliveryAt) : '—'}</td>
              <td className="px-3 py-2.5">
                <OrderStatusBadge status={o.status} />
                {o.saleId && <span className="ml-2 text-xs text-muted">Venda #{o.saleId}</span>}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium text-ink">{formatMoney(o.totalCents)}</td>
              <td className="px-5 py-2.5">
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" aria-label={`Abrir pedido ${o.id}`} icon={<Eye className="size-3.5" />} onClick={() => onOpen(o.id)}>
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

function OrderFormModal({ order, onClose, onSaved }: { order: OrderDetail | null; onClose(): void; onSaved(o: OrderDetail): void }) {
  const toast = useToast()
  const [delivery, setDelivery] = useState(order?.expectedDeliveryAt ? toDateKey(order.expectedDeliveryAt) : '')
  return (
    <DocumentFormModal
      title={order ? `Editar pedido #${order.id}` : 'Novo pedido'}
      formId="order-form"
      allowFreeText={false}
      initial={{ customer: order?.customer ?? null, lines: order ? linesFromDetail(order.items) : [], discountCents: order?.discountCents ?? 0 }}
      initialNotes={order?.notes ?? null}
      onClose={onClose}
      extra={(_v, errors) => (
        <TextField
          label="Entrega prevista"
          type="date"
          containerClassName="col-span-6 md:col-span-2"
          value={delivery}
          error={errors.expectedDeliveryAt}
          onChange={(e) => setDelivery(e.target.value)}
        />
      )}
      onSubmit={async (base) => {
        const input = { ...base, expectedDeliveryAt: delivery || null }
        const saved = order ? await call(api.orders.update({ ...input, id: order.id })) : await call(api.orders.create(input))
        toast.success(order ? 'Pedido atualizado.' : `Pedido #${saved.id} registrado.`)
        onSaved(saved)
      }}
    />
  )
}

function OrderDetailModal({ id, onClose, onEdit, onChanged }: { id: number; onClose(): void; onEdit(o: OrderDetail): void; onChanged(): void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data, error, reload, setData } = useAsync(() => call(api.orders.get({ id })), [id])
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const setStatus = async (status: Exclude<OrderStatus, 'CANCELLED'>) => {
    setBusy(true)
    try {
      setData(await call(api.orders.setStatus({ id, status })))
      toast.success(`Pedido marcado como "${ORDER_STATUS[status]}".`)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const closed = data?.status === 'CANCELLED' || data?.status === 'DELIVERED'
  const next = data && !closed ? FLOW[FLOW.indexOf(data.status as (typeof FLOW)[number]) + 1] : undefined
  const editable = data && ['PENDING', 'CONFIRMED'].includes(data.status) && !data.saleId

  return (
    <Modal open size="lg" title={data ? `Pedido #${data.id}` : 'Pedido'} onClose={onClose} locked={busy}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoRow label="Situação">
              <OrderStatusBadge status={data.status} />
            </InfoRow>
            <InfoRow label="Cliente">{data.customer?.name ?? 'Consumidor'}</InfoRow>
            <InfoRow label="Entrega prevista">{data.expectedDeliveryAt ? formatDate(data.expectedDeliveryAt) : '—'}</InfoRow>
            <InfoRow label="Registrado">
              {formatDateTime(data.createdAt)} por {data.userName}
            </InfoRow>
            {data.quoteId && <InfoRow label="Orçamento de origem">#{data.quoteId}</InfoRow>}
            {data.saleId && <InfoRow label="Venda">#{data.saleId}</InfoRow>}
            {data.deliveredAt && <InfoRow label="Entregue em">{formatDateTime(data.deliveredAt)}</InfoRow>}
            {data.discountAuthorizedByName && <InfoRow label="Desconto autorizado por">{data.discountAuthorizedByName}</InfoRow>}
          </dl>
          {data.cancelledAt && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Cancelado em {formatDateTime(data.cancelledAt)}: {data.cancelReason}
            </p>
          )}
          <DocumentLinesTable items={data.items} />
          <DocumentTotals subtotalCents={data.subtotalCents} discountCents={data.discountCents} totalCents={data.totalCents} items={data.items} />
          {data.notes && <p className="text-sm whitespace-pre-line text-ink-2">{data.notes}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <PrintButtons print={() => api.orders.print({ id })} savePdf={() => api.orders.savePdf({ id })} />
            {editable && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(data)}>
                Editar
              </Button>
            )}
            {data.status !== 'CANCELLED' && data.status !== 'DELIVERED' && !data.saleId && (
              <Button variant="secondary" icon={<XCircle className="size-4 text-danger" />} onClick={() => setCancelOpen(true)}>
                Cancelar pedido
              </Button>
            )}
            {next && (
              <Button variant="secondary" loading={busy} onClick={() => void setStatus(next)}>
                Marcar como {ORDER_STATUS[next].toLowerCase()}
              </Button>
            )}
            {data.status !== 'CANCELLED' && !data.saleId && can('pdv.sell') && (
              <Button icon={<ShoppingCart className="size-4" />} onClick={() => navigate(`/pdv?pedido=${data.id}`)}>
                Vender no PDV
              </Button>
            )}
          </div>
        </div>
      )}
      {cancelOpen && (
        <CancelReasonModal
          title={`Cancelar pedido #${id}`}
          onClose={() => setCancelOpen(false)}
          onConfirm={async (reason) => {
            setData(await call(api.orders.cancel({ id, reason })))
            toast.success('Pedido cancelado.')
            setCancelOpen(false)
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}

export function CancelReasonModal({ title, onClose, onConfirm }: { title: string; onClose(): void; onConfirm(reason: string): Promise<void> }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title={title}
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
            Confirmar cancelamento
          </Button>
        </>
      }
    >
      <TextField label="Motivo do cancelamento" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  )
}
