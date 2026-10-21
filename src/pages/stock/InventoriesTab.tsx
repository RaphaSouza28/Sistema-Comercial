import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, ClipboardCheck, Plus, Save, ScanBarcode } from 'lucide-react'
import type { InventoryDetail } from '@shared/api'
import { formatDateTime, formatQuantity } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

const STATUS = {
  OPEN: <Badge tone="primary">Em andamento</Badge>,
  APPLIED: <Badge tone="success">Aplicado</Badge>,
  CANCELLED: <Badge>Cancelado</Badge>
}

export function InventoriesTab({ onChanged }: { onChanged(): void }) {
  const { can } = useAuth()
  const canManage = can('stock.manage')
  const { data, error, loading, reload } = useAsync(() => call(api.inventories.list()))
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  if (openId !== null) {
    return (
      <InventoryView
        id={openId}
        canManage={canManage}
        onBack={() => {
          setOpenId(null)
          void reload()
        }}
        onChanged={onChanged}
      />
    )
  }

  return (
    <Card>
      <CardHeader
        title="Inventários"
        description="Contagem física do estoque. A diferença entre o contado e o sistema é lançada ao aplicar."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={!!data?.some((i) => i.status === 'OPEN')}>
              Novo inventário
            </Button>
          )
        }
      />
      {error && (
        <div className="px-5 pb-4">
          <ErrorState message={error} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.length === 0 && <EmptyState icon={<ClipboardCheck />} title="Nenhum inventário realizado" />}
      {data && data.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
              <th className="px-5 py-2.5 font-medium">Inventário</th>
              <th className="px-3 py-2.5 font-medium">Escopo</th>
              <th className="px-3 py-2.5 text-right font-medium">Contados</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
              <th className="px-3 py-2.5 font-medium">Criado</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5 font-medium text-ink">{i.name}</td>
                <td className="px-3 py-2.5 text-ink-2">{i.categoryName ?? 'Todo o estoque'}</td>
                <td className="tabular px-3 py-2.5 text-right text-ink-2">
                  {i.countedCount} de {i.itemCount}
                </td>
                <td className="px-3 py-2.5">{STATUS[i.status]}</td>
                <td className="px-3 py-2.5 text-ink-2">
                  {formatDateTime(i.createdAt)}
                  <span className="block text-xs text-muted">{i.createdByName}</span>
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Button size="sm" variant={i.status === 'OPEN' ? 'primary' : 'ghost'} onClick={() => setOpenId(i.id)}>
                    {i.status === 'OPEN' && canManage ? 'Continuar contagem' : 'Ver'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CreateInventoryModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          setOpenId(id)
        }}
      />
    </Card>
  )
}

function CreateInventoryModal({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(id: number): void }) {
  const toast = useToast()
  const categories = useAsync(() => (open ? call(api.categories.list()) : Promise.resolve([])), [open])
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setName(`Inventário ${new Date().toLocaleDateString('pt-BR')}`)
      setCategoryId(null)
      setErrors({})
    }
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const inv = await call(api.inventories.create({ name, categoryId }))
      toast.success(`Inventário iniciado com ${inv.itemCount} item(ns).`)
      onCreated(inv.id)
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      size="sm"
      onClose={onClose}
      locked={saving}
      title="Novo inventário"
      description="A lista é gerada com os produtos ativos e o saldo atual do sistema."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="inventory-form" loading={saving}>
            Iniciar contagem
          </Button>
        </>
      }
    >
      <form id="inventory-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Descrição" required value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Escopo"
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: 'Todo o estoque' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} › ${c.name}` : c.name }))
          ]}
        />
      </form>
    </Modal>
  )
}

function InventoryView({ id, canManage, onBack, onChanged }: { id: number; canManage: boolean; onBack(): void; onChanged(): void }) {
  const toast = useToast()
  const { data, error, loading, setData } = useAsync(() => call(api.inventories.get({ inventoryId: id })), [id])
  const [counts, setCounts] = useState<Record<number, number | null>>({})
  const [onlyPending, setOnlyPending] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [scan, setScan] = useState('')
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null)

  useEffect(() => {
    if (data) setCounts(Object.fromEntries(data.items.map((i) => [i.id, i.countedMilli])))
  }, [data])

  const editable = canManage && data?.status === 'OPEN'
  const dirtyItems = useMemo(() => (data ? data.items.filter((i) => counts[i.id] !== i.countedMilli) : []), [data, counts])

  if (error) return <ErrorState message={error} />
  if (!data || loading) return <Spinner />

  const rows = data.items
    .map((i) => {
      const counted = counts[i.id] ?? null
      return { ...i, counted, diff: counted === null ? null : counted - i.currentMilli }
    })
    .filter((i) => (!onlyPending || i.counted === null) && (!onlyDiff || (i.diff !== null && i.diff !== 0)))

  const save = async (): Promise<InventoryDetail | null> => {
    if (dirtyItems.length === 0) return data
    setSaving(true)
    try {
      const updated = await call(api.inventories.saveCounts({ inventoryId: id, counts: dirtyItems.map((i) => ({ itemId: i.id, countedMilli: counts[i.id] ?? null })) }))
      setData(updated)
      toast.success('Contagem salva.')
      return updated
    } catch (e) {
      toast.error(errorMessage(e))
      return null
    } finally {
      setSaving(false)
    }
  }

  const onScan = (e: FormEvent) => {
    e.preventDefault()
    const code = scan.trim()
    if (!code) return
    const item = data.items.find((i) => i.barcode === code || i.internalCode === code)
    if (!item) {
      setScanMessage(`Código "${code}" não está neste inventário.`)
    } else {
      setCounts((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1000 }))
      setHighlight(item.id)
      setScanMessage(`+1 ${item.name}${item.variantName ? ' — ' + item.variantName : ''}`)
    }
    setScan('')
  }

  const pendingDiffs = data.items.filter((i) => counts[i.id] !== null && counts[i.id] !== undefined && counts[i.id] !== i.currentMilli).length
  const countedCount = Object.values(counts).filter((v) => v !== null).length

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Inventários
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {data.name} {STATUS[data.status]}
          </h2>
          <p className="text-xs text-muted">
            {data.categoryName ?? 'Todo o estoque'} · {countedCount} de {data.itemCount} contados
            {data.appliedAt && ` · aplicado em ${formatDateTime(data.appliedAt)} por ${data.appliedByName}`}
          </p>
        </div>
        {editable && (
          <>
            <Button variant="ghost" onClick={() => setConfirm('cancel')}>
              Cancelar inventário
            </Button>
            <Button variant="secondary" icon={<Save className="size-4" />} loading={saving} disabled={dirtyItems.length === 0} onClick={() => void save()}>
              Salvar contagem
            </Button>
            <Button disabled={countedCount === 0} onClick={() => setConfirm('apply')}>
              Aplicar inventário
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3">
        {editable && (
          <form onSubmit={onScan} className="relative w-80">
            <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Ler código de barras (+1 a cada leitura)"
              aria-label="Ler código de barras"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </form>
        )}
        {scanMessage && <span className="text-sm text-ink-2" role="status">{scanMessage}</span>}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="accent-[var(--primary)]" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Só não contados
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="accent-[var(--primary)]" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Só com diferença
        </label>
      </div>

      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="text-left text-[12px] tracking-wide text-muted uppercase">
              <th className="px-5 py-2.5 font-medium">Produto</th>
              <th className="px-3 py-2.5 text-right font-medium">No início</th>
              <th className="px-3 py-2.5 text-right font-medium">Sistema agora</th>
              <th className="w-44 px-3 py-2.5 font-medium">Contado</th>
              <th className="px-5 py-2.5 text-right font-medium">{data.status === 'APPLIED' ? 'Lançado' : 'Diferença'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const label = `${i.name}${i.variantName ? ' — ' + i.variantName : ''}`
              const shown = data.status === 'APPLIED' ? i.appliedDeltaMilli : i.diff
              return (
                <tr key={i.id} className={`border-t border-line ${highlight === i.id ? 'bg-primary-soft' : ''}`}>
                  <td className="px-5 py-2 text-ink">
                    {label}
                    <span className="block text-xs text-muted">
                      #{i.internalCode}
                      {i.barcode && ` · ${i.barcode}`}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-muted">{formatQuantity(i.expectedMilli)}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">
                    {formatQuantity(i.currentMilli)} <span className="text-xs text-muted">{i.unit}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {editable ? (
                      <QuantityField
                        label={`Contado ${label}`}
                        nullable
                        unit={i.unit}
                        placeholder="Não contado"
                        value={counts[i.id] ?? null}
                        onChange={(v) => setCounts((c) => ({ ...c, [i.id]: v }))}
                        containerClassName="[&_label]:sr-only"
                      />
                    ) : (
                      <span className="tabular text-ink">{i.countedMilli === null ? '—' : formatQuantity(i.countedMilli)}</span>
                    )}
                  </td>
                  <td className={`tabular px-5 py-2 text-right font-medium ${!shown ? 'text-muted' : shown > 0 ? 'text-success' : 'text-danger'}`}>
                    {shown === null || shown === undefined ? '—' : `${shown > 0 ? '+' : ''}${formatQuantity(shown)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title="Nenhum item com este filtro" />}
      </div>

      <ConfirmModal
        open={confirm === 'apply'}
        title="Aplicar inventário"
        confirmLabel="Aplicar"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const saved = await save()
          if (!saved) return
          try {
            const applied = await call(api.inventories.apply({ inventoryId: id }))
            setData(applied)
            setConfirm(null)
            toast.success('Inventário aplicado. As diferenças foram lançadas no estoque.')
            onChanged()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        <p>
          {countedCount} item(ns) contado(s), <strong className="text-ink">{pendingDiffs} com diferença</strong> em relação ao estoque
          atual. Cada diferença gera uma movimentação de inventário. Itens não contados não são alterados.
        </p>
        <p className="mt-2 text-muted">Esta operação não pode ser desfeita (apenas corrigida com ajustes).</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === 'cancel'}
        danger
        title="Cancelar inventário"
        confirmLabel="Cancelar inventário"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await call(api.inventories.cancel({ inventoryId: id }))
            setConfirm(null)
            toast.success('Inventário cancelado. O estoque não foi alterado.')
            onBack()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        As contagens serão descartadas e o estoque não será alterado.
      </ConfirmModal>
    </Card>
  )
}
