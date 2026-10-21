import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, Pencil, Plus, Search, ShieldOff, Trash2, Users } from 'lucide-react'
import type { CustomerDetail, CustomerDto } from '@shared/api'
import { ORDER_STATUS, QUOTE_STATUS } from '@shared/commerceSchemas'
import { formatDocument, formatPhone } from '@shared/documents'
import { formatDate, formatDateTime, formatMoney } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField } from '@/components/ui/NumberFields'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

type Status = 'active' | 'inactive' | 'all'

export function CustomersPage() {
  const { can } = useAuth()
  const canManage = can('customers.manage')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status>('active')
  const [withOpenBalance, setWithOpenBalance] = useState(false)
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useAsync(
    () => call(api.customers.list({ search: debounced || undefined, status, withOpenBalance: withOpenBalance || undefined, page, pageSize: 50 })),
    [debounced, status, withOpenBalance, page]
  )
  const [editing, setEditing] = useState<CustomerDto | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="animate-in">
      <PageHeader
        title="Clientes"
        description="Cadastro, histórico de compras e dados pessoais (LGPD)."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Novo cliente
            </Button>
          )
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
              placeholder="Buscar por nome, CPF/CNPJ, telefone, e-mail ou cidade…"
              aria-label="Buscar clientes"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <SelectField
            label="Situação"
            containerClassName="w-40"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status)
              setPage(1)
            }}
            options={[
              { value: 'active', label: 'Ativos' },
              { value: 'inactive', label: 'Inativos' },
              { value: 'all', label: 'Todos' }
            ]}
          />
          <div className="pb-2">
            <Checkbox label="Com saldo em aberto" checked={withOpenBalance} onChange={(v) => { setWithOpenBalance(v); setPage(1) }} />
          </div>
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.items.length === 0 && <EmptyState icon={<Users />} title={debounced ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'} />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">CPF/CNPJ</th>
                  <th className="px-3 py-2.5 font-medium">Contato</th>
                  <th className="px-3 py-2.5 text-right font-medium">Compras</th>
                  <th className="px-3 py-2.5 font-medium">Última compra</th>
                  <th className="px-3 py-2.5 text-right font-medium">Em aberto</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className="ml-2">
                        {c.anonymized ? <Badge>Anonimizado</Badge> : !c.active && <Badge>Inativo</Badge>}
                      </span>
                      {(c.city || c.state) && <span className="block text-xs text-muted">{[c.city, c.state].filter(Boolean).join(' / ')}</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-ink-2">{c.document ? formatDocument(c.document) : '—'}</td>
                    <td className="px-3 py-2.5 text-ink-2">{[formatPhone(c.phone), c.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">
                      {formatMoney(c.salesTotalCents)}
                      <span className="block text-xs text-muted">{c.salesCount} venda(s)</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : '—'}</td>
                    <td className={`tabular px-3 py-2.5 text-right ${c.openBalanceCents > 0 ? 'font-medium text-warning' : 'text-muted'}`}>{formatMoney(c.openBalanceCents)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setViewing(c.id)}>
                          Abrir
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
            <span>{data.total} cliente(s)</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" aria-label="Página anterior" disabled={page <= 1} icon={<ChevronLeft className="size-4" />} onClick={() => setPage(page - 1)} />
              <span>
                {page} de {pages}
              </span>
              <Button size="sm" variant="ghost" aria-label="Próxima página" disabled={page >= pages} icon={<ChevronRight className="size-4" />} onClick={() => setPage(page + 1)} />
            </div>
          </div>
        )}
      </Card>

      {editing && (
        <CustomerFormModal
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null)
            void reload()
            setViewing(c.id)
          }}
        />
      )}
      {viewing !== null && (
        <CustomerDetailModal
          id={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onEdit={(c) => {
            setViewing(null)
            setEditing(c)
          }}
          onChanged={() => void reload()}
        />
      )}
    </div>
  )
}

const fields = ['name', 'document', 'phone', 'email', 'zipCode', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes'] as const

function CustomerFormModal({ customer, onClose, onSaved }: { customer: CustomerDto | null; onClose(): void; onSaved(c: CustomerDto): void }) {
  const toast = useToast()
  const { can } = useAuth()
  // Limite de crediário: só quem gerencia Contas a receber altera (o servidor também confere)
  const canCredit = can('finance.receivables')
  const [creditLimit, setCreditLimit] = useState<number | null>(customer?.creditLimitCents ?? null)
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, customer?.[f] ?? ''])))
  const [active, setActive] = useState(customer?.active ?? true)
  const [consent, setConsent] = useState(!!customer?.consentAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const field = (key: (typeof fields)[number]) => ({
    value: form[key],
    error: errors[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const saved = customer
        ? await call(api.customers.update({ ...form, name: form.name, id: customer.id, active, consent, ...(canCredit ? { creditLimitCents: creditLimit } : {}) }))
        : await call(api.customers.create({ ...form, name: form.name, consent, ...(canCredit ? { creditLimitCents: creditLimit } : {}) }))
      toast.success(customer ? 'Cliente atualizado.' : 'Cliente cadastrado.')
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
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="customer-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="grid grid-cols-6 gap-4" noValidate>
        <TextField label="Nome completo ou razão social" required containerClassName="col-span-6 md:col-span-4" {...field('name')} />
        <TextField label="CPF ou CNPJ" inputMode="numeric" containerClassName="col-span-6 md:col-span-2" {...field('document')} />
        <TextField label="Telefone" inputMode="tel" containerClassName="col-span-3 md:col-span-2" {...field('phone')} />
        <TextField label="E-mail" type="email" containerClassName="col-span-3 md:col-span-4" {...field('email')} />
        <TextField label="CEP" inputMode="numeric" containerClassName="col-span-2 md:col-span-1" {...field('zipCode')} />
        <TextField label="Endereço" containerClassName="col-span-4 md:col-span-3" {...field('street')} />
        <TextField label="Número" containerClassName="col-span-2 md:col-span-1" {...field('number')} />
        <TextField label="Complemento" containerClassName="col-span-4 md:col-span-1" {...field('complement')} />
        <TextField label="Bairro" containerClassName="col-span-6 md:col-span-3" {...field('district')} />
        <TextField label="Cidade" containerClassName="col-span-4 md:col-span-2" {...field('city')} />
        <TextField label="UF" maxLength={2} containerClassName="col-span-2 md:col-span-1" {...field('state')} />
        <TextField label="Observações" containerClassName="col-span-6 md:col-span-4" {...field('notes')} />
        <MoneyField
          label="Limite de crediário"
          nullable
          containerClassName="col-span-6 md:col-span-2"
          value={creditLimit}
          onChange={setCreditLimit}
          disabled={!canCredit}
          error={errors.creditLimitCents}
          hint={canCredit ? 'Vazio = não compra no crediário' : 'Definido pelo financeiro'}
        />
        <div className="col-span-6 flex flex-col gap-3 rounded-lg bg-surface-2 p-3">
          <Checkbox
            label="O cliente autorizou o uso dos dados para cadastro e contato (LGPD)"
            description="Os dados são usados somente para vendas, entregas, cobranças e contato sobre pedidos. O cliente pode pedir a exportação ou a anonimização a qualquer momento."
            checked={consent}
            onChange={setConsent}
          />
          {customer && <Checkbox label="Cliente ativo" checked={active} onChange={setActive} />}
        </div>
      </form>
    </Modal>
  )
}

type DetailTab = 'data' | 'sales' | 'orders' | 'quotes'

function CustomerDetailModal({
  id,
  canManage,
  onClose,
  onEdit,
  onChanged
}: {
  id: number
  canManage: boolean
  onClose(): void
  onEdit(c: CustomerDto): void
  onChanged(): void
}) {
  const toast = useToast()
  const { data, error, reload } = useAsync(() => call(api.customers.get({ id })), [id])
  const [tab, setTab] = useState<DetailTab>('data')
  const [confirm, setConfirm] = useState<'anonymize' | 'remove' | null>(null)

  const exportData = async () => {
    try {
      const r = await call(api.customers.exportData({ id }))
      if (r) toast.success(`Dados exportados para ${r.path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Modal open size="lg" title={data?.name ?? 'Cliente'} onClose={onClose}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total comprado" value={formatMoney(data.salesTotalCents)} />
            <Stat label="Vendas" value={String(data.salesCount)} />
            <Stat label="Última compra" value={data.lastPurchaseAt ? formatDate(data.lastPurchaseAt) : '—'} />
            <Stat
              label={data.creditLimitCents !== null ? `Em aberto · limite ${formatMoney(data.creditLimitCents)}` : 'Saldo em aberto'}
              value={formatMoney(data.openBalanceCents)}
            />
          </div>
          <Tabs<DetailTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'data', label: 'Dados' },
              { key: 'sales', label: `Compras (${data.sales.length})` },
              { key: 'orders', label: `Pedidos (${data.orders.length})` },
              { key: 'quotes', label: `Orçamentos (${data.quotes.length})` }
            ]}
          />
          {tab === 'data' && <CustomerData c={data} />}
          {tab === 'sales' && (
            <MiniTable
              empty="Nenhuma compra registrada."
              head={['Venda', 'Data', 'Pagamento', 'Total']}
              rows={data.sales.map((s) => [`#${s.id}${s.status === 'CANCELLED' ? ' (cancelada)' : ''}`, formatDateTime(s.createdAt), s.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(', '), formatMoney(s.totalCents)])}
            />
          )}
          {tab === 'orders' && (
            <MiniTable
              empty="Nenhum pedido."
              head={['Pedido', 'Data', 'Situação', 'Total']}
              rows={data.orders.map((o) => [`#${o.id}`, formatDateTime(o.createdAt), ORDER_STATUS[o.status], formatMoney(o.totalCents)])}
            />
          )}
          {tab === 'quotes' && (
            <MiniTable
              empty="Nenhum orçamento."
              head={['Orçamento', 'Data', 'Situação', 'Total']}
              rows={data.quotes.map((q) => [`#${q.id}`, formatDateTime(q.createdAt), QUOTE_STATUS[q.status], formatMoney(q.totalCents)])}
            />
          )}
          {canManage && (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              {!data.anonymizedAt && (
                <>
                  <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportData()}>
                    Exportar dados (LGPD)
                  </Button>
                  <Button variant="secondary" icon={<ShieldOff className="size-4" />} onClick={() => setConfirm('anonymize')}>
                    Anonimizar
                  </Button>
                  <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(data)}>
                    Editar
                  </Button>
                </>
              )}
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('remove')}>
                Excluir
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={confirm === 'anonymize'}
        danger
        title="Anonimizar cliente"
        confirmLabel="Anonimizar"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await call(api.customers.anonymize({ id }))
            toast.success('Dados pessoais removidos. O histórico de vendas foi mantido.')
            setConfirm(null)
            onChanged()
            void reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        Nome, documento, telefone, e-mail e endereço de <strong className="text-ink">{data?.name}</strong> serão apagados
        definitivamente. As vendas continuam registradas, sem identificar a pessoa. Esta ação não pode ser desfeita.
      </ConfirmModal>
      <ConfirmModal
        open={confirm === 'remove'}
        danger
        title="Excluir cliente"
        confirmLabel="Excluir"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await call(api.customers.remove({ id }))
            toast.success('Cliente excluído.')
            onChanged()
            onClose()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        Excluir <strong className="text-ink">{data?.name}</strong>? O cliente deixa de aparecer nas listas, mas vendas,
        pedidos e orçamentos já registrados continuam vinculados a ele.
      </ConfirmModal>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

function CustomerData({ c }: { c: CustomerDetail }) {
  const address = [[c.street, c.number].filter(Boolean).join(', '), c.complement, c.district, [c.city, c.state].filter(Boolean).join(' / '), c.zipCode]
    .filter(Boolean)
    .join(' · ')
  const rows: [string, string][] = [
    ['CPF/CNPJ', c.document ? formatDocument(c.document) : '—'],
    ['Telefone', formatPhone(c.phone) || '—'],
    ['E-mail', c.email ?? '—'],
    ['Endereço', address || '—'],
    ['Observações', c.notes ?? '—'],
    ['Cadastro', formatDateTime(c.createdAt)],
    ['Consentimento LGPD', c.consentAt ? `Autorizado em ${formatDateTime(c.consentAt)}` : 'Não registrado'],
    ...(c.anonymizedAt ? ([['Anonimizado em', formatDateTime(c.anonymizedAt)]] as [string, string][]) : [])
  ]
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function MiniTable({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-left text-[12px] text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i === head.length - 1 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === r.length - 1 ? 'tabular text-right text-ink' : 'text-ink-2'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
