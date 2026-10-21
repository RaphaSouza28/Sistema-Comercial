import { Plus, Trash2, Wand2 } from 'lucide-react'
import { formatQuantity } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { MoneyField, QuantityField } from '@/components/ui/NumberFields'

export interface OptionRow {
  name: string
  valuesText: string
}

export interface VariantRow {
  key: string
  id: number | null
  attributes: Record<string, string>
  sku: string
  barcode: string
  costCents: number | null
  salePriceCents: number | null
  minStockMilli: number
  initialStockMilli: number
  stockMilli: number
  active: boolean
}

export const optionValues = (o: OptionRow) =>
  [...new Set(o.valuesText.split(',').map((v) => v.trim()).filter(Boolean))]

let keySeq = 0
export const newVariantKey = () => `new-${++keySeq}`

const cellInput = 'h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink'

/** Tipos de variação (até 3) e a grade de variações com SKU, código, preço e estoque próprios. */
export function VariantsEditor({
  options,
  variants,
  unit,
  costVisible,
  canPrice,
  productPriceCents,
  onOptions,
  onVariants
}: {
  options: OptionRow[]
  variants: VariantRow[]
  unit: string
  costVisible: boolean
  canPrice: boolean
  productPriceCents: number
  onOptions(o: OptionRow[]): void
  onVariants(v: VariantRow[]): void
}) {
  const named = options.filter((o) => o.name.trim() && optionValues(o).length)

  const generate = () => {
    const combos = named.reduce<Record<string, string>[]>(
      (acc, o) => acc.flatMap((c) => optionValues(o).map((v) => ({ ...c, [o.name.trim()]: v }))),
      [{}]
    )
    const keyOf = (a: Record<string, string>) => named.map((o) => a[o.name.trim()]).join('|')
    const existing = new Set(variants.map((v) => keyOf(v.attributes)))
    const added = combos
      .filter((c) => !existing.has(keyOf(c)))
      .map<VariantRow>((attributes) => ({
        key: newVariantKey(),
        id: null,
        attributes,
        sku: '',
        barcode: '',
        costCents: null,
        salePriceCents: null,
        minStockMilli: 0,
        initialStockMilli: 0,
        stockMilli: 0,
        active: true
      }))
    onVariants([...variants, ...added])
  }

  const update = (key: string, patch: Partial<VariantRow>) => onVariants(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {options.map((o, i) => (
          <div key={i} className="grid grid-cols-[180px_1fr_auto] items-end gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
              Tipo de variação
              <input className={cellInput} placeholder="Ex.: Cor" value={o.name} onChange={(e) => onOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
              Valores (separados por vírgula)
              <input className={cellInput} placeholder="Ex.: Azul, Preto, Branco" value={o.valuesText} onChange={(e) => onOptions(options.map((x, j) => (j === i ? { ...x, valuesText: e.target.value } : x)))} />
            </label>
            <Button variant="ghost" size="sm" aria-label={`Remover tipo ${o.name || i + 1}`} icon={<Trash2 className="size-4 text-danger" />} onClick={() => onOptions(options.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div className="flex gap-2">
          {options.length < 3 && (
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => onOptions([...options, { name: '', valuesText: '' }])}>
              Adicionar tipo de variação
            </Button>
          )}
          <Button size="sm" icon={<Wand2 className="size-4" />} disabled={named.length === 0} onClick={generate}>
            Gerar combinações
          </Button>
        </div>
      </div>

      {variants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Variação</th>
                <th className="px-2 py-2 font-medium">SKU</th>
                <th className="px-2 py-2 font-medium">Cód. barras</th>
                {costVisible && <th className="px-2 py-2 font-medium">Custo próprio</th>}
                <th className="px-2 py-2 font-medium">Preço próprio</th>
                <th className="px-2 py-2 font-medium">Estoque mín.</th>
                <th className="px-2 py-2 font-medium">Estoque</th>
                <th className="px-2 py-2 font-medium">Ativa</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const name = named.map((o) => v.attributes[o.name.trim()]).filter(Boolean).join(' / ') || Object.values(v.attributes).join(' / ')
                return (
                  <tr key={v.key} className="border-t border-line">
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap text-ink">{name}</td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`SKU ${name}`} className={cellInput} value={v.sku} onChange={(e) => update(v.key, { sku: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Código de barras ${name}`} className={cellInput} value={v.barcode} onChange={(e) => update(v.key, { barcode: e.target.value })} />
                    </td>
                    {costVisible && (
                      <td className="w-32 px-2 py-1.5">
                        <MoneyField label={`Custo ${name}`} nullable placeholder="Do produto" value={v.costCents} onChange={(c) => update(v.key, { costCents: c })} containerClassName="[&_label]:sr-only" />
                      </td>
                    )}
                    <td className="w-32 px-2 py-1.5">
                      <MoneyField
                        label={`Preço ${name}`}
                        nullable
                        disabled={!canPrice}
                        placeholder={(productPriceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        value={v.salePriceCents}
                        onChange={(c) => update(v.key, { salePriceCents: c })}
                        containerClassName="[&_label]:sr-only"
                      />
                    </td>
                    <td className="w-28 px-2 py-1.5">
                      <QuantityField label={`Estoque mínimo ${name}`} value={v.minStockMilli} onChange={(q) => update(v.key, { minStockMilli: q ?? 0 })} containerClassName="[&_label]:sr-only" />
                    </td>
                    <td className="w-28 px-2 py-1.5">
                      {v.id === null ? (
                        <QuantityField label={`Estoque inicial ${name}`} placeholder="Inicial" value={v.initialStockMilli} onChange={(q) => update(v.key, { initialStockMilli: q ?? 0 })} containerClassName="[&_label]:sr-only" />
                      ) : (
                        <span className="tabular text-ink-2">
                          {formatQuantity(v.stockMilli)} {unit}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" aria-label={`Ativa ${name}`} className="accent-[var(--primary)]" checked={v.active} onChange={(e) => update(v.key, { active: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover variação ${name}`}
                        title={v.stockMilli !== 0 ? 'Variação com estoque: desative em vez de remover' : 'Remover'}
                        disabled={v.stockMilli !== 0}
                        icon={<Trash2 className="size-3.5 text-danger" />}
                        onClick={() => onVariants(variants.filter((x) => x.key !== v.key))}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Campos de preço/custo em branco usam os valores do produto. O estoque inicial de variações novas gera movimentação
        rastreável; depois disso, o estoque muda apenas pelo módulo Estoque (entradas, saídas, ajustes e inventário).
      </p>
    </div>
  )
}
