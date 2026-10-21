import { useEffect, useState, type FormEvent } from 'react'
import type { CategoryDto } from '@shared/api'
import { formatPercentBps } from '@shared/format'
import { analyzePrice } from '@shared/pricing'
import { UNITS } from '@shared/units'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { MoneyField, QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

const empty = { name: '', categoryId: null as number | null, unit: 'UN', costCents: 0, salePriceCents: 0, initialStockMilli: 0 }

/** Cadastro rápido: nome, categoria, custo, preço e quantidade inicial. O restante pode ser completado depois. */
export function QuickCreateModal({
  open,
  categories,
  onClose,
  onCreated
}: {
  open: boolean
  categories: CategoryDto[]
  onClose(): void
  onCreated(): void
}) {
  const { can } = useAuth()
  const toast = useToast()
  const canCost = can('products.cost')
  const [form, setForm] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(empty)
      setErrors({})
    }
  }, [open])

  const margin = canCost && form.costCents > 0 && form.salePriceCents > 0 ? analyzePrice({ costCents: form.costCents }, form.salePriceCents).grossMarginBps : null

  const submit = async (e: FormEvent, keepOpen = false) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const p = await call(
        api.products.quickCreate({
          name: form.name,
          categoryId: form.categoryId,
          unit: form.unit as 'UN',
          salePriceCents: form.salePriceCents,
          initialStockMilli: form.initialStockMilli,
          ...(canCost ? { costCents: form.costCents } : {})
        })
      )
      toast.success(`Produto "${p.name}" cadastrado (código ${p.internalCode}).`)
      onCreated()
      if (keepOpen) setForm({ ...empty, categoryId: form.categoryId, unit: form.unit })
      else onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const topLevel = categories.filter((c) => c.parentId === null && c.active)

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title="Cadastro rápido"
      description="Cadastre o essencial agora e complete as demais informações depois."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="secondary" disabled={saving} onClick={(e) => void submit(e, true)}>
            Salvar e cadastrar outro
          </Button>
          <Button type="submit" form="quick-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="quick-form" onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-4" noValidate>
        <TextField label="Nome do produto" required containerClassName="col-span-2" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <SelectField
          label="Categoria"
          value={form.categoryId ?? ''}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: 'Sem categoria' }, ...topLevel.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <SelectField label="Unidade" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} options={UNITS.map((u) => ({ value: u.code, label: `${u.code} — ${u.label}` }))} />
        {canCost && <MoneyField label="Custo" value={form.costCents} onChange={(v) => setForm({ ...form, costCents: v ?? 0 })} error={errors.costCents} />}
        <MoneyField
          label="Preço de venda"
          required
          value={form.salePriceCents}
          onChange={(v) => setForm({ ...form, salePriceCents: v ?? 0 })}
          error={errors.salePriceCents}
          hint={margin !== null ? `Margem bruta: ${formatPercentBps(margin)}` : undefined}
        />
        <QuantityField
          label="Quantidade inicial em estoque"
          unit={form.unit}
          value={form.initialStockMilli}
          onChange={(v) => setForm({ ...form, initialStockMilli: v ?? 0 })}
          error={errors.initialStockMilli}
          hint="Gera uma movimentação de estoque inicial."
        />
      </form>
    </Modal>
  )
}
