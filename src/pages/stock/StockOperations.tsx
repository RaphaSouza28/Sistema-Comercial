import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { StockItem, StockOperationResult } from '@shared/api'
import { formatMoney, formatQuantity } from '@shared/format'
import { EXIT_REASONS, type ExitReason } from '@shared/stockSchemas'
import { StockItemPicker, stockItemLabel } from '@/components/StockItemPicker'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { MoneyField, QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

interface Line {
  item: StockItem
  quantityMilli: number
  unitCostCents: number | null
}

const keyOf = (i: StockItem) => `${i.productId}:${i.variantId ?? ''}`

function useOperation(open: boolean) {
  const toast = useToast()
  // Um identificador por abertura do formulário: reenviar (duplo clique, falha de rede) não duplica.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setRequestId(crypto.randomUUID())
      setError(null)
      setErrors({})
    }
  }, [open])
  const run = async (fn: () => Promise<StockOperationResult>, success: string, onDone: () => void) => {
    setSaving(true)
    setError(null)
    setErrors({})
    try {
      const r = await fn()
      toast.success(r.movements ? success : r.warnings[0] ?? success)
      if (r.movements) r.warnings.forEach((w) => toast.warning(w))
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setErrors(fieldErrors(e))
    } finally {
      setSaving(false)
    }
  }
  return { requestId, saving, error, errors, run }
}

function LinesTable({
  lines,
  setLines,
  showCost,
  exit
}: {
  lines: Line[]
  setLines(l: Line[]): void
  showCost: boolean
  exit?: boolean
}) {
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (keyOf(l.item) === key ? { ...l, ...patch } : l)))
  if (lines.length === 0) return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nenhum item adicionado.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-[12px] text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Produto</th>
            <th className="px-2 py-2 text-right font-medium">Estoque atual</th>
            <th className="w-36 px-2 py-2 font-medium">Quantidade</th>
            {showCost && <th className="w-36 px-2 py-2 font-medium">Custo unitário</th>}
            {showCost && <th className="px-2 py-2 text-right font-medium">Total</th>}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const key = keyOf(l.item)
            const label = stockItemLabel(l.item)
            const insufficient = exit && l.quantityMilli > l.item.stockMilli && !l.item.allowNegativeStock
            return (
              <tr key={key} className="border-t border-line">
                <td className="px-3 py-1.5 text-ink">
                  {label}
                  <span className="block text-xs text-muted">#{l.item.internalCode}</span>
                </td>
                <td className={`tabular px-2 py-1.5 text-right ${insufficient ? 'text-danger' : 'text-ink-2'}`}>
                  {formatQuantity(l.item.stockMilli)} {l.item.unit}
                </td>
                <td className="px-2 py-1.5">
                  <QuantityField label={`Quantidade ${label}`} unit={l.item.unit} value={l.quantityMilli} onChange={(v) => update(key, { quantityMilli: v ?? 0 })} containerClassName="[&_label]:sr-only" />
                </td>
                {showCost && (
                  <td className="px-2 py-1.5">
                    <MoneyField label={`Custo ${label}`} nullable value={l.unitCostCents} onChange={(v) => update(key, { unitCostCents: v })} containerClassName="[&_label]:sr-only" />
                  </td>
                )}
                {showCost && (
                  <td className="tabular px-2 py-1.5 text-right text-ink-2">
                    {l.unitCostCents !== null ? formatMoney(Math.round((l.unitCostCents * l.quantityMilli) / 1000)) : '—'}
                  </td>
                )}
                <td className="px-1">
                  <Button size="sm" variant="ghost" aria-label={`Remover ${label}`} icon={<Trash2 className="size-3.5 text-danger" />} onClick={() => setLines(lines.filter((x) => keyOf(x.item) !== key))} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function addLine(lines: Line[], item: StockItem, defaultCost: boolean): Line[] {
  const key = keyOf(item)
  if (lines.some((l) => keyOf(l.item) === key)) {
    // Ler o mesmo código de novo soma 1 unidade
    return lines.map((l) => (keyOf(l.item) === key ? { ...l, quantityMilli: l.quantityMilli + 1000 } : l))
  }
  return [...lines, { item, quantityMilli: 1000, unitCostCents: defaultCost ? item.unitCostCents : null }]
}

export function EntryModal({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const { can } = useAuth()
  const canCost = can('products.cost')
  const op = useOperation(open)
  const suppliers = useAsync(() => (open && can('suppliers.manage', 'products.manage') ? call(api.suppliers.list({})) : Promise.resolve([])), [open])
  const [lines, setLines] = useState<Line[]>([])
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [documentNumber, setDocumentNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [costUpdate, setCostUpdate] = useState<'none' | 'last' | 'average'>('none')

  useEffect(() => {
    if (open) {
      setLines([])
      setSupplierId(null)
      setDocumentNumber('')
      setNotes('')
      setCostUpdate('none')
    }
  }, [open])

  const total = lines.reduce((acc, l) => acc + (l.unitCostCents !== null ? Math.round((l.unitCostCents * l.quantityMilli) / 1000) : 0), 0)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void op.run(
      () =>
        call(
          api.stock.entry({
            requestId: op.requestId,
            supplierId,
            documentNumber,
            notes,
            costUpdate,
            items: lines.map((l) => ({
              productId: l.item.productId,
              variantId: l.item.variantId,
              quantityMilli: l.quantityMilli,
              unitCostCents: canCost ? l.unitCostCents : null
            }))
          })
        ),
      `Entrada registrada: ${lines.length} item(ns).`,
      () => {
        onDone()
        onClose()
      }
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={op.saving}
      size="lg"
      title="Entrada de mercadorias"
      description="Recebimento de compras ou reposição. Cada item gera uma movimentação de entrada."
      footer={
        <>
          {canCost && total > 0 && <span className="mr-auto self-center text-sm text-ink-2">Total da entrada: <strong className="tabular text-ink">{formatMoney(total)}</strong></span>}
          <Button variant="secondary" onClick={onClose} disabled={op.saving}>
            Cancelar
          </Button>
          <Button type="submit" form="entry-form" loading={op.saving} disabled={lines.length === 0}>
            Registrar entrada
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {op.error && <ErrorState message={op.error} />}
        <div className="grid grid-cols-3 gap-4">
          <SelectField
            label="Fornecedor"
            value={supplierId ?? ''}
            onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: '', label: 'Não informado' }, ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
          <TextField label="Nº da nota / documento" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} error={op.errors.documentNumber} />
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <StockItemPicker autoFocus onSelect={(item) => setLines((l) => addLine(l, item, canCost))} />
        <LinesTable lines={lines} setLines={setLines} showCost={canCost} />
        {canCost && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">Custo dos produtos</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(
                [
                  ['none', 'Manter o custo atual'],
                  ['last', 'Usar o custo desta entrada'],
                  ['average', 'Custo médio ponderado']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={costUpdate === value}
                  onClick={() => setCostUpdate(value)}
                  className={`rounded-md border px-3 py-1.5 text-[13px] ${costUpdate === value ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink-2 hover:bg-surface-hover'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">Preços de venda não são alterados automaticamente. Mudanças de custo ficam no histórico de preços.</p>
          </fieldset>
        )}
      </form>
    </Modal>
  )
}

export function ExitModal({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const op = useOperation(open)
  const [lines, setLines] = useState<Line[]>([])
  const [reason, setReason] = useState<ExitReason>('LOSS')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (open) {
      setLines([])
      setReason('LOSS')
      setNotes('')
    }
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void op.run(
      () =>
        call(
          api.stock.exit({
            requestId: op.requestId,
            reason,
            notes,
            items: lines.map((l) => ({ productId: l.item.productId, variantId: l.item.variantId, quantityMilli: l.quantityMilli }))
          })
        ),
      `Saída registrada: ${lines.length} item(ns).`,
      () => {
        onDone()
        onClose()
      }
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={op.saving}
      size="lg"
      title="Saída de mercadorias"
      description="Perdas, avarias, consumo interno ou devoluções ao fornecedor. Vendas baixam o estoque automaticamente pelo PDV."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={op.saving}>
            Cancelar
          </Button>
          <Button type="submit" form="exit-form" loading={op.saving} disabled={lines.length === 0}>
            Registrar saída
          </Button>
        </>
      }
    >
      <form id="exit-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {op.error && <ErrorState message={op.error} />}
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Motivo"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value as ExitReason)}
            options={Object.entries(EXIT_REASONS).map(([value, label]) => ({ value, label }))}
          />
          <TextField label={reason === 'OTHER' ? 'Descrição do motivo' : 'Observações'} required={reason === 'OTHER'} value={notes} onChange={(e) => setNotes(e.target.value)} error={op.errors.notes} />
        </div>
        <StockItemPicker autoFocus onSelect={(item) => setLines((l) => addLine(l, item, false))} />
        <LinesTable lines={lines} setLines={setLines} showCost={false} exit />
      </form>
    </Modal>
  )
}

export function AdjustModal({ item, onClose, onDone }: { item: StockItem | null | 'pick'; onClose(): void; onDone(): void }) {
  const open = item !== null
  const op = useOperation(open)
  const [selected, setSelected] = useState<StockItem | null>(null)
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (item && item !== 'pick') {
      setSelected(item)
      setQuantity(Math.max(item.stockMilli, 0))
    } else setSelected(null)
    setReason('')
  }, [item])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    void op.run(
      () =>
        call(
          api.stock.adjust({
            requestId: op.requestId,
            productId: selected.productId,
            variantId: selected.variantId,
            newQuantityMilli: quantity,
            reason
          })
        ),
      'Estoque ajustado.',
      () => {
        onDone()
        onClose()
      }
    )
  }

  const delta = selected ? quantity - selected.stockMilli : 0
  return (
    <Modal
      open={open}
      size="sm"
      onClose={onClose}
      locked={op.saving}
      title="Ajustar estoque"
      description="Informe a quantidade correta. A diferença é registrada como movimentação de ajuste."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={op.saving}>
            Cancelar
          </Button>
          <Button type="submit" form="adjust-form" loading={op.saving} disabled={!selected || delta === 0}>
            Ajustar
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {op.error && <ErrorState message={op.error} />}
        {selected ? (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="font-medium text-ink">{stockItemLabel(selected)}</span>
            <span className="block text-xs text-muted">
              Estoque atual: {formatQuantity(selected.stockMilli)} {selected.unit}
            </span>
          </div>
        ) : (
          <StockItemPicker
            autoFocus
            label="Produto"
            onSelect={(i) => {
              setSelected(i)
              setQuantity(Math.max(i.stockMilli, 0))
            }}
          />
        )}
        {selected && (
          <>
            <QuantityField
              label="Quantidade correta em estoque"
              unit={selected.unit}
              value={quantity}
              onChange={(v) => setQuantity(v ?? 0)}
              error={op.errors.newQuantityMilli}
              hint={delta !== 0 ? `Diferença: ${delta > 0 ? '+' : ''}${formatQuantity(delta)} ${selected.unit}` : 'Sem diferença'}
            />
            <TextField label="Motivo do ajuste" required value={reason} onChange={(e) => setReason(e.target.value)} error={op.errors.reason} placeholder="Ex.: conferência do balcão" />
          </>
        )}
      </form>
    </Modal>
  )
}
