import { useEffect, useState } from 'react'
import { Calculator } from 'lucide-react'
import type { CategoryPricingPreview } from '@shared/api'
import { formatMoney, formatPercentBps } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SelectField } from '@/components/ui/Field'
import { EmptyState, ErrorState } from '@/components/ui/Feedback'
import { PercentField } from '@/components/ui/NumberFields'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'

/**
 * Precificação por categoria: calcula o preço sugerido de cada produto a partir da
 * margem informada e só altera os produtos que o usuário marcar e confirmar.
 */
export function CategoryPricingTab() {
  const toast = useToast()
  const categories = useAsync(() => call(api.categories.list()))
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [marginBps, setMarginBps] = useState<number | null>(null)
  const [preview, setPreview] = useState<CategoryPricingPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const c = categories.data?.find((x) => x.id === categoryId)
    setMarginBps(c?.defaultMarginBps ?? null)
    setPreview(null)
  }, [categoryId, categories.data])

  const calculate = async () => {
    if (!categoryId) return
    setLoading(true)
    setError(null)
    try {
      const p = await call(api.products.categoryPricingPreview({ categoryId, marginBps: marginBps ?? undefined }))
      setPreview(p)
      setMarginBps(p.marginBps)
      setSelected(new Set(p.items.filter((i) => i.suggestedPriceCents !== null && i.suggestedPriceCents !== i.currentPriceCents).map((i) => i.productId)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    try {
      const r = await call(api.products.categoryPricingApply({ categoryId: preview.categoryId, marginBps: preview.marginBps, productIds: [...selected] }))
      toast.success(`${r.updated} preço(s) atualizado(s). As alterações estão no histórico de preços.`)
      setConfirming(false)
      await calculate()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const selectable = preview?.items.filter((i) => i.suggestedPriceCents !== null) ?? []

  return (
    <Card>
      <CardHeader
        title="Precificação por categoria"
        description="Calcula o preço sugerido (custo total ÷ (1 − margem − taxas do produto)). Nenhum preço muda sem a sua confirmação."
      />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-4">
        <SelectField
          label="Categoria"
          containerClassName="w-72"
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: 'Selecione…' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} › ${c.name}` : c.name }))
          ]}
        />
        <PercentField label="Margem desejada" containerClassName="w-40" nullable value={marginBps} onChange={setMarginBps} />
        <Button icon={<Calculator className="size-4" />} onClick={() => void calculate()} loading={loading} disabled={!categoryId}>
          Calcular prévia
        </Button>
      </div>
      {error && (
        <div className="px-5 pb-4">
          <ErrorState message={error} />
        </div>
      )}
      {preview && preview.items.length === 0 && <EmptyState title="Nenhum produto nesta categoria" />}
      {preview && preview.items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="w-10 px-5 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      className="accent-[var(--primary)]"
                      checked={selectable.length > 0 && selectable.every((i) => selected.has(i.productId))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((i) => i.productId)) : new Set())}
                    />
                  </th>
                  <th className="px-2 py-2.5 font-medium">Produto</th>
                  <th className="px-3 py-2.5 text-right font-medium">Custo total</th>
                  <th className="px-3 py-2.5 text-right font-medium">Preço atual</th>
                  <th className="px-3 py-2.5 text-right font-medium">Margem atual</th>
                  <th className="px-3 py-2.5 text-right font-medium">Preço sugerido</th>
                  <th className="px-5 py-2.5 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((i) => {
                  const diff = i.suggestedPriceCents !== null ? i.suggestedPriceCents - i.currentPriceCents : null
                  return (
                    <tr key={i.productId} className="border-b border-line last:border-0">
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Aplicar em ${i.name}`}
                          className="accent-[var(--primary)]"
                          disabled={i.suggestedPriceCents === null}
                          checked={selected.has(i.productId)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = new Set(s)
                              if (e.target.checked) n.add(i.productId)
                              else n.delete(i.productId)
                              return n
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-ink">
                        {i.name}
                        <span className="block text-xs text-muted">#{i.internalCode}</span>
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink-2">{formatMoney(i.totalCostCents)}</td>
                      <td className="tabular px-3 py-2 text-right text-ink-2">{formatMoney(i.currentPriceCents)}</td>
                      <td className="tabular px-3 py-2 text-right text-ink-2">{i.currentMarginBps !== null ? formatPercentBps(i.currentMarginBps) : '—'}</td>
                      <td className="tabular px-3 py-2 text-right font-medium text-ink">
                        {i.suggestedPriceCents !== null ? formatMoney(i.suggestedPriceCents) : <span className="text-xs font-normal text-warning">{i.problem}</span>}
                      </td>
                      <td className={`tabular px-5 py-2 text-right ${diff === null ? 'text-muted' : diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted'}`}>
                        {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatMoney(diff)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
            <span className="text-sm text-muted">{selected.size} produto(s) selecionado(s)</span>
            <Button disabled={selected.size === 0} onClick={() => setConfirming(true)}>
              Aplicar preços sugeridos
            </Button>
          </div>
        </>
      )}
      <ConfirmModal open={confirming} title="Aplicar novos preços" confirmLabel="Aplicar" onClose={() => setConfirming(false)} onConfirm={apply}>
        O preço de venda de <strong className="text-ink">{selected.size} produto(s)</strong> da categoria{' '}
        <strong className="text-ink">{preview?.categoryName}</strong> será alterado para o preço sugerido com margem de{' '}
        {preview && formatPercentBps(preview.marginBps)}. Cada alteração fica registrada no histórico de preços.
      </ConfirmModal>
    </Card>
  )
}
