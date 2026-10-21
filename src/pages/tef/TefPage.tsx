import { useState } from 'react'
import { CheckCheck, CreditCard, Info, Pencil, PlugZap, Undo2 } from 'lucide-react'
import type { ReconciliationRow } from '@shared/api'
import { CARD_BRANDS, RECONCILE_METHODS, TEF_PROVIDERS, type ReconciliationListInput } from '@shared/integrationSchemas'
import { formatDateTime, formatMoney, toDateKey } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { inputDate } from '../finance/shared'

type Tab = 'reconciliation' | 'integration'

export function TefPage() {
  const [tab, setTab] = useState<Tab>('reconciliation')
  return (
    <div className="animate-in">
      <PageHeader title="TEF" description="Cartões e PIX: conciliação com a maquininha/banco e integração com provedor TEF homologado." />
      <Tabs
        tabs={[
          { key: 'reconciliation', label: 'Conciliação', icon: CheckCheck },
          { key: 'integration', label: 'Integração TEF', icon: PlugZap }
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === 'reconciliation' ? <ReconciliationTab /> : <IntegrationTab />}
    </div>
  )
}

function ReconciliationTab() {
  const toast = useToast()
  const [from, setFrom] = useState(toDateKey(new Date(), -6))
  const [to, setTo] = useState(toDateKey())
  const [method, setMethod] = useState<ReconciliationListInput['method'] | ''>('')
  const [status, setStatus] = useState<'all' | 'pending' | 'reconciled'>('pending')
  const { data, error, loading, reload } = useAsync(() => call(api.tef.reconciliation({ from, to, method: method || undefined, status })), [from, to, method, status])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<ReconciliationRow | null>(null)
  const [busy, setBusy] = useState(false)
  const rows = data?.rows ?? []
  const selectable = rows.filter((r) => r.saleStatus === 'COMPLETED')
  const toggle = (id: number) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))

  const mark = async (reconciled: boolean) => {
    setBusy(true)
    try {
      const r = await call(api.tef.reconcile({ paymentIds: [...selected], reconciled }))
      toast.success(reconciled ? `${r.updated} pagamento(s) conferido(s).` : `${r.updated} conferência(s) desfeita(s).`)
      setSelected(new Set())
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Sem TEF integrado, cartões e PIX são registrados manualmente no PDV. Confira cada pagamento com o extrato da maquininha ou do banco, informe NSU e autorização do comprovante e
          marque como conferido. Números de cartão nunca são gravados.
        </span>
      </div>
      {data && data.byMethod.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.byMethod.map((m) => (
            <Card key={m.method} className="p-4">
              <p className="text-[13px] text-muted">{PAYMENT_METHOD_LABELS[m.method] ?? m.method}</p>
              <p className="tabular text-lg font-semibold text-ink">{formatMoney(m.amountCents)}</p>
              <p className="text-xs text-muted">
                {m.reconciledCount}/{m.count} conferido(s) · {formatMoney(m.reconciledCents)}
              </p>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            De
            <input type="date" aria-label="Data inicial" className={inputDate} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            Até
            <input type="date" aria-label="Data final" className={inputDate} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <SelectField
            label="Forma"
            containerClassName="w-48"
            value={method ?? ''}
            onChange={(e) => setMethod(e.target.value as ReconciliationListInput['method'] | '')}
            options={[{ value: '', label: 'Cartões, PIX e outros' }, ...RECONCILE_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))]}
          />
          <SelectField
            label="Conferência"
            containerClassName="w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: 'pending', label: 'A conferir' },
              { value: 'reconciled', label: 'Conferidos' },
              { value: 'all', label: 'Todos' }
            ]}
          />
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<Undo2 className="size-4" />} disabled={!selected.size || busy} onClick={() => void mark(false)}>
              Desfazer
            </Button>
            <Button icon={<CheckCheck className="size-4" />} disabled={!selected.size || busy} loading={busy} onClick={() => void mark(true)}>
              Marcar como conferido{selected.size ? ` (${selected.size})` : ''}
            </Button>
          </div>
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && rows.length === 0 && <EmptyState icon={<CreditCard />} title="Nenhum pagamento no filtro" />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      className="accent-[var(--primary)]"
                      checked={selectable.length > 0 && selectable.every((r) => selected.has(r.paymentId))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.paymentId)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Venda</th>
                  <th className="px-3 py-2.5 font-medium">Forma</th>
                  <th className="px-3 py-2.5 font-medium">NSU / autorização</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.paymentId} className={`border-b border-line last:border-0 ${r.saleStatus === 'CANCELLED' ? 'text-muted' : ''}`}>
                    <td className="px-4 py-2">
                      {r.saleStatus === 'COMPLETED' && (
                        <input type="checkbox" aria-label={`Selecionar pagamento da venda ${r.saleId}`} className="accent-[var(--primary)]" checked={selected.has(r.paymentId)} onChange={() => toggle(r.paymentId)} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-ink">#{r.saleId}</span>
                      <span className="block text-xs text-muted">
                        {formatDateTime(r.createdAt)} · {r.operatorName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-2">
                      {PAYMENT_METHOD_LABELS[r.method] ?? r.method}
                      {r.installments > 1 && ` ${r.installments}x`}
                      {r.cardBrand && <span className="block text-xs text-muted">{r.cardBrand}</span>}
                    </td>
                    <td className="tabular px-3 py-2 text-ink-2">{[r.nsu, r.authorizationCode].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2">
                      {r.saleStatus === 'CANCELLED' ? <Badge>Venda cancelada (estornar)</Badge> : r.reconciledAt ? <Badge tone="success">Conferido</Badge> : <Badge tone="warning">A conferir</Badge>}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium">{formatMoney(r.amountCents)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Editar comprovante da venda ${r.saleId}`} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <ReferenceModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
    </>
  )
}

function ReferenceModal({ row, onClose, onSaved }: { row: ReconciliationRow; onClose(): void; onSaved(): void }) {
  const toast = useToast()
  const [nsu, setNsu] = useState(row.nsu ?? '')
  const [auth, setAuth] = useState(row.authorizationCode ?? '')
  const [brand, setBrand] = useState(row.cardBrand ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title={`Comprovante da venda #${row.saleId}`}
      description={`${PAYMENT_METHOD_LABELS[row.method]} · ${formatMoney(row.amountCents)}`}
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
              setErrors({})
              try {
                await call(api.tef.updateReference({ paymentId: row.paymentId, nsu: nsu || null, authorizationCode: auth || null, cardBrand: (brand || null) as (typeof CARD_BRANDS)[number] | null }))
                toast.success('Dados do comprovante salvos.')
                onSaved()
              } catch (e) {
                setErrors(fieldErrors(e))
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
      <div className="grid grid-cols-2 gap-3">
        <TextField label="NSU" inputMode="numeric" maxLength={12} hint="Até 12 dígitos" value={nsu} error={errors.nsu} onChange={(e) => setNsu(e.target.value.replace(/\D/g, ''))} />
        <TextField label="Autorização" maxLength={12} value={auth} error={errors.authorizationCode} onChange={(e) => setAuth(e.target.value)} />
        <SelectField label="Bandeira" containerClassName="col-span-2" value={brand} onChange={(e) => setBrand(e.target.value)} options={[{ value: '', label: '—' }, ...CARD_BRANDS.map((b) => ({ value: b, label: b === 'OUTRA' ? 'Outra' : b }))]} />
        <p className="col-span-2 text-xs text-muted">Não digite o número do cartão: o sistema não armazena dados de cartão.</p>
      </div>
    </Modal>
  )
}

function IntegrationTab() {
  const status = useAsync(() => call(api.integrations.status()))
  return (
    <Card>
      <CardHeader title="Provedor TEF" description="Pagamento integrado ao pinpad (débito, crédito e PIX) com aprovação e comprovantes do próprio provedor." />
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm text-ink-2">
        <p>
          Provedor atual: <strong className="text-ink">{status.data ? status.data.tef.label : TEF_PROVIDERS.NONE}</strong>
        </p>
        <p>
          Nenhum provedor TEF está integrado nesta versão. A integração depende de contratar um provedor compatível, das credenciais do estabelecimento e da homologação com a
          adquirente. O sistema já tem o contrato de integração (iniciar pagamento, consultar status, cancelar) e o registro de transações; ele nunca simula aprovações.
        </p>
        <p>Enquanto isso, use a maquininha normalmente e registre o pagamento no PDV; a conferência é feita na aba Conciliação.</p>
      </div>
    </Card>
  )
}
