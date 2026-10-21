import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, FileCheck2, FileDown, FilePlus2, Info, ListChecks, RefreshCw, Send, Settings2, Trash2, XCircle } from 'lucide-react'
import type { FiscalDocumentDetail } from '@shared/api'
import { FISCAL_PROVIDERS, FISCAL_STATUS, FISCAL_TYPES, type FiscalListInput, type FiscalSettings, type FiscalStatus } from '@shared/integrationSchemas'
import { formatDateTime, formatMoney, formatQuantity } from '@shared/format'
import { PAYMENT_METHOD_LABELS } from '@shared/labels'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'
import { InfoRow, Pager } from '../documents/shared'
import { ReasonModal } from '../finance/shared'

type Tab = 'docs' | 'checklist' | 'config'
const TONES: Record<FiscalStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  PROCESSING: 'primary',
  AUTHORIZED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  ERROR: 'danger',
  DISCARDED: 'neutral'
}

export function FiscalPage() {
  const [tab, setTab] = useState<Tab>('docs')
  const status = useAsync(() => call(api.integrations.status()))
  return (
    <div className="animate-in">
      <PageHeader title="Notas Fiscais" description="NF-e e NFC-e por meio de provedor fiscal homologado. O sistema não simula autorização da SEFAZ." />
      {status.data && !status.data.fiscal.enabled && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft/50 px-4 py-3 text-sm text-ink-2" role="status">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            <strong className="text-ink">Emissão desativada:</strong> nenhum provedor fiscal está integrado. Você pode conferir os cadastros e preparar as notas a partir das vendas; a
            transmissão exige contratar um provedor homologado, o certificado digital A1/A3 da empresa e a validação tributária por um contador.
          </span>
        </div>
      )}
      <Tabs
        tabs={[
          { key: 'docs', label: 'Documentos', icon: FileCheck2 },
          { key: 'checklist', label: 'Pendências de cadastro', icon: ListChecks },
          { key: 'config', label: 'Configuração', icon: Settings2 }
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === 'docs' && <DocumentsTab />}
      {tab === 'checklist' && <ChecklistTab />}
      {tab === 'config' && <ConfigTab onSaved={() => void status.reload()} />}
    </div>
  )
}

function DocumentsTab() {
  const toast = useToast()
  const [status, setStatus] = useState<FiscalStatus | ''>('')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAsync(() => call(api.fiscal.list({ status: (status || undefined) as FiscalListInput['status'], page, pageSize: 50 })), [status, page])
  const [viewing, setViewing] = useState<number | null>(null)
  const [saleId, setSaleId] = useState('')
  const [type, setType] = useState<'NFCE' | 'NFE'>('NFCE')
  const [preparing, setPreparing] = useState(false)

  const prepare = async () => {
    setPreparing(true)
    try {
      const d = await call(api.fiscal.prepare({ saleId: Number(saleId), type }))
      toast.success(d.issues.length ? `Nota preparada com ${d.issues.length} pendência(s).` : 'Nota preparada.')
      setSaleId('')
      void reload()
      setViewing(d.id)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <TextField label="Nº da venda" inputMode="numeric" containerClassName="w-36" value={saleId} onChange={(e) => setSaleId(e.target.value.replace(/\D/g, ''))} />
        <SelectField label="Tipo" containerClassName="w-52" value={type} onChange={(e) => setType(e.target.value as 'NFCE' | 'NFE')} options={Object.entries(FISCAL_TYPES).map(([value, label]) => ({ value, label }))} />
        <Button icon={<FilePlus2 className="size-4" />} disabled={!saleId} loading={preparing} onClick={() => void prepare()}>
          Preparar nota da venda
        </Button>
        <div className="ml-auto">
          <SelectField
            label="Situação"
            containerClassName="w-56"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FiscalStatus | '')
              setPage(1)
            }}
            options={[{ value: '', label: 'Todas' }, ...Object.entries(FISCAL_STATUS).map(([value, label]) => ({ value, label }))]}
          />
        </div>
      </Card>
      <Card>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.items.length === 0 && <EmptyState icon={<FileCheck2 />} title="Nenhum documento fiscal" description="Prepare a nota informando o número da venda." />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">Documento</th>
                  <th className="px-3 py-2.5 font-medium">Venda</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Mensagem</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ink">
                        {FISCAL_TYPES[d.type]} · nº {d.number ?? '—'}
                      </span>
                      <span className="block text-xs text-muted">
                        Registro #{d.id} · {formatDateTime(d.createdAt)} · {d.environment === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">
                      #{d.saleId}
                      {d.customerName && <span className="block text-xs text-muted">{d.customerName}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={TONES[d.status]}>{FISCAL_STATUS[d.status]}</Badge>
                    </td>
                    <td className="max-w-80 px-3 py-2.5 text-xs text-ink-2">{d.message}</td>
                    <td className="tabular px-3 py-2.5 text-right font-medium text-ink">{formatMoney(d.totalCents)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Abrir documento ${d.id}`} onClick={() => setViewing(d.id)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} label="documento(s)" />}
      </Card>
      {viewing !== null && <FiscalDetailModal id={viewing} onClose={() => setViewing(null)} onChanged={() => void reload()} />}
    </>
  )
}

function FiscalDetailModal({ id, onClose, onChanged }: { id: number; onClose(): void; onChanged(): void }) {
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => call(api.fiscal.get({ id })), [id])
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const run = async (label: string, fn: () => Promise<FiscalDocumentDetail | null | { path: string }>, ok: string) => {
    setBusy(label)
    try {
      const r = await fn()
      if (r && 'id' in r) {
        setData(r)
        onChanged()
      }
      if (r && 'path' in r) toast.success(`Arquivo salvo em ${r.path}`)
      else if (r && ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
      void reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open size="lg" title={data ? `${FISCAL_TYPES[data.type]} — venda #${data.saleId}` : 'Documento fiscal'} onClose={onClose} locked={!!busy}>
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoRow label="Situação">
              <Badge tone={TONES[data.status]}>{FISCAL_STATUS[data.status]}</Badge>
            </InfoRow>
            <InfoRow label="Provedor">{FISCAL_PROVIDERS[(data.provider ?? 'NONE') as keyof typeof FISCAL_PROVIDERS] ?? data.provider}</InfoRow>
            <InfoRow label="Série / número">
              {data.series ?? '—'} / {data.number ?? '—'}
            </InfoRow>
            <InfoRow label="Total">{formatMoney(data.totalCents)}</InfoRow>
            {data.accessKey && <InfoRow label="Chave de acesso">{data.accessKey}</InfoRow>}
            {data.protocol && <InfoRow label="Protocolo">{data.protocol}</InfoRow>}
          </dl>
          {data.message && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">{data.message}</p>}
          {data.issues.length > 0 ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft/50 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-danger">
                <CircleAlert className="size-4" aria-hidden /> Pendências que impedem a emissão
              </p>
              <ul className="list-disc pl-5 text-sm text-ink-2">
                {data.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Corrija os cadastros, descarte este rascunho e prepare a nota novamente.</p>
            </div>
          ) : (
            data.status === 'PENDING' && (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CircleCheck className="size-4" aria-hidden /> Dados completos para a transmissão.
              </p>
            )
          )}
          {data.payload && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">NCM</th>
                    <th className="px-2 py-2 font-medium">CFOP</th>
                    <th className="px-2 py-2 font-medium">Orig.</th>
                    <th className="px-2 py-2 font-medium">CST/CSOSN</th>
                    <th className="px-2 py-2 text-right font-medium">Qtd.</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payload.items.map((i, n) => (
                    <tr key={n} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">{i.description}</td>
                      {[i.ncm, i.cfop, i.origin, i.taxCode].map((v, k) => (
                        <td key={k} className={`px-2 py-2 ${v ? 'text-ink-2' : 'font-medium text-danger'}`}>
                          {v ?? 'falta'}
                        </td>
                      ))}
                      <td className="tabular px-2 py-2 text-right text-ink-2">
                        {formatQuantity(i.quantityMilli)} {i.unit}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink">{formatMoney(i.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-3 py-2 text-xs text-muted">
                Pagamentos: {data.payload.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method] ?? p.method} (tPag ${p.code}) ${formatMoney(p.amountCents)}`).join(' · ')}
                {data.payload.recipient?.document ? ` · Destinatário: ${data.payload.recipient.name ?? ''} ${data.payload.recipient.document}` : ' · Consumidor não identificado'}
              </p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {data.hasXml && (
              <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={!!busy} onClick={() => void run('xml', () => call(api.fiscal.saveXml({ id })), '')}>
                XML
              </Button>
            )}
            {data.hasDanfe && (
              <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={!!busy} onClick={() => void run('danfe', () => call(api.fiscal.saveDanfe({ id })), '')}>
                DANFE
              </Button>
            )}
            {(data.status === 'PENDING' || data.status === 'REJECTED') && (
              <Button variant="secondary" icon={<Trash2 className="size-4 text-danger" />} disabled={!!busy} loading={busy === 'discard'} onClick={() => void run('discard', () => call(api.fiscal.discard({ id })), 'Rascunho descartado.')}>
                Descartar
              </Button>
            )}
            {(data.status === 'PROCESSING' || data.status === 'ERROR') && (
              <Button variant="secondary" icon={<RefreshCw className="size-4" />} disabled={!!busy} loading={busy === 'query'} onClick={() => void run('query', () => call(api.fiscal.query({ id })), 'Situação atualizada.')}>
                Consultar situação
              </Button>
            )}
            {data.status === 'AUTHORIZED' && (
              <Button variant="secondary" icon={<XCircle className="size-4 text-danger" />} disabled={!!busy} onClick={() => setCancelling(true)}>
                Cancelar nota
              </Button>
            )}
            {['PENDING', 'REJECTED', 'ERROR'].includes(data.status) && (
              <Button icon={<Send className="size-4" />} disabled={!!busy} loading={busy === 'transmit'} onClick={() => void run('transmit', () => call(api.fiscal.transmit({ id })), 'Documento enviado ao provedor.')}>
                Transmitir
              </Button>
            )}
          </div>
        </div>
      )}
      {cancelling && (
        <ReasonModal
          title="Cancelar nota fiscal"
          description="O cancelamento é enviado à SEFAZ pelo provedor e só é aceito dentro do prazo legal."
          label="Justificativa (mínimo 15 caracteres)"
          confirmLabel="Solicitar cancelamento"
          onClose={() => setCancelling(false)}
          onConfirm={async (reason) => {
            setData(await call(api.fiscal.cancel({ id, reason })))
            setCancelling(false)
            toast.success('Nota cancelada.')
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}

function ChecklistTab() {
  const { data, error, loading, reload } = useAsync(() => call(api.fiscal.checklist()))
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />
  if (!data || loading) return <Spinner />
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Empresa" description="Dados do emitente (Configurações → Empresa)." />
        <div className="px-5 pb-5">
          {data.company.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CircleCheck className="size-4" aria-hidden /> Cadastro da empresa completo.
            </p>
          ) : (
            <ul className="list-disc pl-5 text-sm text-ink-2">
              {data.company.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title={`Produtos com dados fiscais incompletos (${data.productsWithIssues})`} description="NCM, CFOP, origem e CST/CSOSN no cadastro de cada produto. Confirme os códigos com o contador." />
        <div className="max-h-96 overflow-auto px-5 pb-5">
          {data.products.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CircleCheck className="size-4" aria-hidden /> Todos os produtos ativos têm os dados fiscais preenchidos.
            </p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.products.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-1.5">
                  <a href={`#/produtos/${p.id}`} className="text-ink hover:underline">
                    #{p.internalCode} {p.name}
                  </a>
                  <span className="text-xs text-danger">falta {p.missing.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}

function ConfigTab({ onSaved }: { onSaved(): void }) {
  const toast = useToast()
  const { data, setData } = useAsync(() => call(api.fiscal.settings()))
  const [form, setForm] = useState<FiscalSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => setForm(data), [data])
  if (!form) return <Spinner />
  return (
    <Card>
      <CardHeader title="Configuração fiscal" description="Certificado digital, CSC (NFC-e) e credenciais são cadastrados no provedor fiscal contratado." />
      <div className="grid grid-cols-1 gap-4 px-5 pb-5 md:grid-cols-4">
        <SelectField label="Provedor fiscal" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as FiscalSettings['provider'] })} options={Object.entries(FISCAL_PROVIDERS).map(([value, label]) => ({ value, label }))} />
        <SelectField
          label="Ambiente"
          value={form.environment}
          onChange={(e) => setForm({ ...form, environment: e.target.value as FiscalSettings['environment'] })}
          options={[
            { value: 'HOMOLOGACAO', label: 'Homologação (testes, sem valor fiscal)' },
            { value: 'PRODUCAO', label: 'Produção' }
          ]}
        />
        <TextField label="Série da NFC-e" type="number" min={1} max={999} value={form.nfceSeries} onChange={(e) => setForm({ ...form, nfceSeries: Number(e.target.value) })} />
        <TextField label="Série da NF-e" type="number" min={1} max={999} value={form.nfeSeries} onChange={(e) => setForm({ ...form, nfeSeries: Number(e.target.value) })} />
        <p className="text-xs text-muted md:col-span-3">
          Nenhum provedor está integrado nesta versão. A integração usa um contrato pronto no código (emitir, consultar e cancelar); o XML autorizado e o DANFE devolvidos pelo provedor
          ficam guardados na pasta de dados do sistema.
        </p>
        <div className="flex justify-end">
          <Button
            loading={saving}
            disabled={JSON.stringify(form) === JSON.stringify(data)}
            onClick={async () => {
              setSaving(true)
              try {
                setData(await call(api.fiscal.updateSettings(form)))
                toast.success('Configuração fiscal salva.')
                onSaved()
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Card>
  )
}
